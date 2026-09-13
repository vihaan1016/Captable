import type pg from 'pg';
import { decodeAbiParameters, decodeEventLog, type PublicClient } from 'viem';
import {
  ABI,
  AUCTION_ABI,
  AUCTION_PARAMETERS_ABI,
  BOND_ABI,
  COMPLIANCE_ABI,
  HOOK_ABI,
  ORACLE_ABI,
  ROUTER_ABI,
  backoff,
  createChainClient,
  sleep,
} from './chain.js';

const START_BLOCK = Number(process.env.INDEXER_START_BLOCK ?? 0);

type EventLog = {
  address: string;
  blockNumber: bigint | null;
  transactionHash: string | null;
  eventName: string | null;
  args: Record<string, unknown>;
};

export async function runIndexer(pool: pg.Pool): Promise<void> {
  const client = createChainClient();

  // A checkpoint wins. Otherwise honour INDEXER_START_BLOCK when set, else start
  // 32 blocks behind head. The old `Math.max(START_BLOCK, head - 32)` made the
  // env var a floor (it could only move the start forward), which is what made
  // backfill impossible.
  const cp = await readCheckpoint(pool);
  let last = cp ?? (START_BLOCK > 0 ? START_BLOCK : Number(await client.getBlockNumber()) - 32);
  console.log(`[indexer] resuming from block ${last}`);

  for (;;) {
    let attempt = 0;
    for (;;) {
      try {
        const head = Number(await client.getBlockNumber());
        await writeState(pool, 'chain_head', String(head));
        if (head > last) {
          // Chunk getLogs so a public RPC does not refuse a large span, and
          // checkpoint inside the loop so a mid-backfill crash resumes rather
          // than restarting from zero.
          const CHUNK = 1000;
          for (let from = last + 1; from <= head; from += CHUNK) {
            const to = Math.min(from + CHUNK - 1, head);
            await indexRange(pool, client, BigInt(from), BigInt(to));
            await writeCheckpoint(pool, to);
          }
          last = head;
        }
        await enrichRegisters(pool, client, last);
        await enrichAuctionState(pool, client);
        break;
      } catch (err) {
        attempt++;
        const wait = backoff(attempt);
        console.error(`[indexer] RPC error (attempt ${attempt}), retrying in ${wait}ms`, err);
        await sleep(wait);
        if (attempt >= 5) throw err;
      }
    }
    await sleep(2000);
  }
}

async function readCheckpoint(pool: pg.Pool): Promise<number | null> {
  const r = await pool.query("SELECT value FROM indexer_state WHERE key = 'head_block'");
  if (r.rows.length === 0) return null;
  return Number(r.rows[0].value);
}

async function writeCheckpoint(pool: pg.Pool, block: number): Promise<void> {
  await writeState(pool, 'head_block', String(block));
}

async function writeState(pool: pg.Pool, key: string, value: string): Promise<void> {
  await pool.query(
    "INSERT INTO indexer_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, value],
  );
}

async function indexRange(
  pool: pg.Pool,
  client: PublicClient,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<void> {
  const rawLogs = await client.getLogs({
    events: ABI,
    fromBlock,
    toBlock,
  });

  for (const raw of rawLogs) {
    const decoded = decodeEventLog({ abi: ABI, data: raw.data, topics: raw.topics });
    const log: EventLog = {
      address: (raw.address ?? '').toLowerCase(),
      blockNumber: raw.blockNumber ?? null,
      transactionHash: raw.transactionHash ?? null,
      eventName: (decoded.eventName as string | undefined) ?? null,
      args: (decoded.args ?? {}) as Record<string, unknown>,
    };
    await handleLog(pool, log);
  }
}

function num(v: unknown): string {
  return BigInt(v as bigint).toString();
}

async function handleLog(pool: pg.Pool, log: EventLog): Promise<void> {
  const block = log.blockNumber == null ? null : Number(log.blockNumber);
  const tx = log.transactionHash ?? null;

  switch (log.eventName) {
    case 'AuctionCreated': {
      const a = log.args;
      const auction = String(a.auction).toLowerCase();
      const token = String(a.token).toLowerCase();
      const configData = (a.configData as `0x${string}`) ?? '0x';

      // configData is abi.encode(AuctionParameters).
      let params: Record<string, unknown> = {};
      try {
        const [currency, tokensRecipient, fundsRecipient, startBlock, endBlock, claimBlock, tickSpacing, hook, floorPrice, required, ,] =
          decodeParams(configData);
        params = { currency, tokensRecipient, fundsRecipient, startBlock, endBlock, claimBlock, tickSpacing, hook, floorPrice, required };
      } catch (err) {
        console.error(`[indexer] failed to decode AuctionCreated configData: ${String(err)}`);
        params = {};
      }

      await pool.query(
        `INSERT INTO auctions
           (address, bond_address, currency, start_block, end_block, claim_block, tick_spacing,
            floor_price_q96, total_supply, required_raised, validation_hook, created_at_block)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (address) DO UPDATE SET
           validation_hook = EXCLUDED.validation_hook,
           start_block = EXCLUDED.start_block,
           end_block = EXCLUDED.end_block,
           claim_block = EXCLUDED.claim_block`,
        [
          auction,
          token,
          String(params.currency ?? '0x0000000000000000000000000000000000000000').toLowerCase(),
          String(params.startBlock ?? '0'),
          String(params.endBlock ?? '0'),
          String(params.claimBlock ?? '0'),
          num(params.tickSpacing ?? 0),
          num(params.floorPrice ?? 0),
          num(a.amount ?? 0),
          num(params.required ?? 0),
          String(params.hook ?? '0x0000000000000000000000000000000000000000').toLowerCase(),
          block == null ? 0 : block,
        ],
      );
      break;
    }

    case 'BidPlaced': {
      const a = log.args;
      const auction = log.address;
      await pool.query(
        `INSERT INTO bids
           (bid_id, auction_address, beneficiary, max_price_q96, amount, tokens_filled, state,
            placed_block, placed_tx, settled_block, settled_tx, lock_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (bid_id) DO UPDATE SET
           max_price_q96 = EXCLUDED.max_price_q96,
           amount = EXCLUDED.amount`,
        [
          Number(a.bidId),
          auction,
          String(a.beneficiary).toLowerCase(),
          num(a.maxPriceQ96),
          num(a.amount),
          '0',
          1, // PLACED
          block ?? 0,
          tx,
          0,
          null,
          null,
        ],
      );
      break;
    }

    case 'BidExited': {
      const a = log.args;
      await pool.query(
        `UPDATE bids SET state = 3, tokens_filled = $2, settled_block = $3, settled_tx = $4
         WHERE bid_id = $1`,
        [Number(a.bidId), num(a.tokensFilled), block ?? 0, tx],
      );
      break;
    }

    case 'Settled': {
      const a = log.args;
      const path = Number(a.path);
      const state = path === 7 ? 7 : 4;
      await pool.query(
        `UPDATE bids SET state = $2, tokens_filled = $3, settled_block = $4, settled_tx = $5
         WHERE bid_id = $1`,
        [Number(a.bidId), state, num(a.tokensFilled), block ?? 0, tx],
      );
      break;
    }

    case 'RefundedIneligible': {
      const a = log.args;
      await pool.query(
        `UPDATE bids SET state = 7, tokens_filled = $2, settled_block = $3, settled_tx = $4
         WHERE bid_id = $1`,
        [Number(a.bidId), num(a.tokensFilled), block ?? 0, tx],
      );
      break;
    }

    case 'HoldCreated': {
      const a = log.args;
      await pool.query(
        `UPDATE bids SET state = 4, lock_hash = $2 WHERE bid_id = $1`,
        [Number(a.bidId), String(a.lockHash)],
      );
      break;
    }

    case 'CheckpointUpdated': {
      const a = log.args;
      const clearingQ96 = BigInt(a.clearingPriceQ96 as bigint);
      // cumulativeMps is ten-millionths of total supply (1e7 = 100%).
      const totalSupply = await readAuctionTotalSupply(pool, log.address);
      const supplyReleased = (totalSupply * BigInt(a.cumulativeMps as bigint)) / 10_000_000n;
      // currency raised = clearing price × tokens released (native HBAR, 18dp).
      const currencyRaised = (clearingQ96 * supplyReleased) >> 96n;
      await pool.query(
        `INSERT INTO checkpoints (auction_address, block_number, clearing_price_q96, supply_released, currency_raised)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (auction_address, block_number) DO NOTHING`,
        [log.address, Number(a.blockNumber), num(clearingQ96), supplyReleased.toString(), currencyRaised.toString()],
      );
      break;
    }

    case 'TokensReceived': {
      // No-op: the auction row already carries total supply from AuctionCreated.
      break;
    }

    case 'BidSubmitted':
    case 'TokensClaimed':
      break;

    default:
      console.log(`[indexer] ${block ?? '?'} ${log.eventName ?? 'unknown'} ${log.address}`);
  }
}

function decodeParams(configData: `0x${string}`): readonly (string | bigint)[] {
  // The factory emits `abi.encode(AuctionParameters)` — a single dynamic struct
  // argument, so the bytes start with a 0x20 offset to the struct head. Decode
  // as a one-element tuple of the struct, then return the fields in the order
  // the consumer destructures them.
  const [p] = decodeAbiParameters([{ type: 'tuple', components: AUCTION_PARAMETERS_ABI }], configData) as unknown as [
    Record<string, string | bigint>,
  ];
  return [
    p.currency,
    p.tokensRecipient,
    p.fundsRecipient,
    p.startBlock,
    p.endBlock,
    p.claimBlock,
    p.tickSpacing,
    p.validationHook,
    p.floorPrice,
    p.requiredCurrencyRaised,
    p.auctionStepsData,
  ];
}

async function readAuctionTotalSupply(pool: pg.Pool, auction: string): Promise<bigint> {
  const r = await pool.query('SELECT total_supply FROM auctions WHERE address = $1', [auction.toLowerCase()]);
  if (r.rows.length === 0) return 0n;
  return BigInt(r.rows[0].total_supply);
}

async function enrichAuctionState(pool: pg.Pool, client: PublicClient): Promise<void> {
  const auctions = await pool.query('SELECT address, validation_hook FROM auctions');
  for (const { address, validation_hook } of auctions.rows) {
    try {
      const router = await client.readContract({
        address: validation_hook as `0x${string}`,
        abi: HOOK_ABI,
        functionName: 'SETTLEMENT_ROUTER',
      }).catch(() => null);
      if (router) {
        const reserve = await client.readContract({
          address: router as `0x${string}`,
          abi: ROUTER_ABI,
          functionName: 'settlementReserve',
        });
        await pool.query(
          "INSERT INTO indexer_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
          [`settlement_reserve:${address}`, reserve.toString()],
        );
      }

      const oracle = await client.readContract({
        address: validation_hook as `0x${string}`,
        abi: HOOK_ABI,
        functionName: 'AGGREGATOR',
      }).catch(() => null);
      if (oracle && oracle !== '0x0000000000000000000000000000000000000000') {
        const [, answer, , updatedAt] = (await client.readContract({
          address: oracle as `0x${string}`,
          abi: ORACLE_ABI,
          functionName: 'latestRoundData',
        })) as [unknown, bigint, unknown, bigint, unknown];
        await pool.query(
          "INSERT INTO indexer_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
          [`nav:${address}`, answer.toString()],
        );
        await pool.query(
          "INSERT INTO indexer_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
          [`nav_updated_at:${address}`, updatedAt.toString()],
        );
      }
    } catch (err) {
      console.error(`[indexer] auction-state enrichment failed for ${address}`, err);
    }
  }
}

async function enrichRegisters(pool: pg.Pool, client: PublicClient, blockNumber: number): Promise<void> {
  const bonds = await pool.query('SELECT DISTINCT bond_address FROM auctions');
  for (const { bond_address } of bonds.rows) {
    try {
      await enrichRegister(pool, client, bond_address, blockNumber);
    } catch (err) {
      console.error(`[indexer] register enrichment failed for ${bond_address}`, err);
    }
  }
}

async function enrichRegister(
  pool: pg.Pool,
  client: PublicClient,
  bond: string,
  blockNumber: number,
): Promise<void> {
  const holderCount = Number(await client.readContract({
    address: bond as `0x${string}`,
    abi: BOND_ABI,
    functionName: 'getTotalSecurityHolders',
  }));

  // Page through holders, 500 at a time (matching the on-chain page convention).
  const holders: { address: string; balance: bigint; kyc: number; blocked: boolean }[] = [];
  const pageLength = 500;
  for (let page = 0; page * pageLength < holderCount; page++) {
    const addrs = (await client.readContract({
      address: bond as `0x${string}`,
      abi: BOND_ABI,
      functionName: 'getSecurityHolders',
      args: [BigInt(page), BigInt(pageLength)],
    })) as `0x${string}`[];
    for (const address of addrs) {
      // Total = available + held + locked, mirroring AtsBalance.totalOf (F-13):
      // `balanceOf` is available-only, so a fully-held holder would read as 0.
      const [balance, held, locked] = await Promise.all([
        client.readContract({
          address: bond as `0x${string}`,
          abi: BOND_ABI,
          functionName: 'balanceOf',
          args: [address],
        }),
        client.readContract({
          address: bond as `0x${string}`,
          abi: BOND_ABI,
          functionName: 'getHeldAmountFor',
          args: [address],
        }).catch(() => 0n),
        client.readContract({
          address: bond as `0x${string}`,
          abi: BOND_ABI,
          functionName: 'getLockedAmountFor',
          args: [address],
        }).catch(() => 0n),
      ]);
      const kyc = Number(await client.readContract({
        address: bond as `0x${string}`,
        abi: BOND_ABI,
        functionName: 'getKycStatusFor',
        args: [address],
      }));
      holders.push({ address: address.toLowerCase(), balance: balance + held + locked, kyc, blocked: false });
    }
  }

  // Control-list membership (only for current holders; this is the roster read).
  const isWhiteList = await client.readContract({
    address: bond as `0x${string}`,
    abi: BOND_ABI,
    functionName: 'getControlListType',
  });
  for (const h of holders) {
    const inList = await client.readContract({
      address: bond as `0x${string}`,
      abi: BOND_ABI,
      functionName: 'isInControlList',
      args: [h.address as `0x${string}`],
    });
    h.blocked = isWhiteList ? !inList : inList;
  }

  const totalSupply = await client.readContract({
    address: bond as `0x${string}`,
    abi: BOND_ABI,
    functionName: 'totalSupply',
  });

  // Compliance caps via the compliance module attached to the bond.
  let maxInvestors = 0n;
  let maxOwnershipBps = 0n;
  const compliance = (await client.readContract({
    address: bond as `0x${string}`,
    abi: BOND_ABI,
    functionName: 'compliance',
  })) as `0x${string}`;
  if (compliance && compliance !== '0x0000000000000000000000000000000000000000') {
    maxInvestors = await client.readContract({
      address: compliance,
      abi: COMPLIANCE_ABI,
      functionName: 'maxInvestors',
    });
    maxOwnershipBps = await client.readContract({
      address: compliance,
      abi: COMPLIANCE_ABI,
      functionName: 'maxOwnershipBps',
    });
  }

  let largestBps = 0n;
  for (const h of holders) {
    await pool.query(
      `INSERT INTO holders (bond_address, holder, balance, kyc_status, blocked, updated_block)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (bond_address, holder) DO UPDATE SET
         balance = EXCLUDED.balance,
         kyc_status = EXCLUDED.kyc_status,
         blocked = EXCLUDED.blocked,
         updated_block = EXCLUDED.updated_block`,
      [bond.toLowerCase(), h.address, h.balance.toString(), h.kyc, h.blocked, blockNumber],
    );
    const bps = totalSupply > 0n ? (h.balance * 10_000n) / totalSupply : 0n;
    if (bps > largestBps) largestBps = bps;
  }

  await pool.query(
    `INSERT INTO register_snapshots (bond_address, block_number, holder_count, max_investors, largest_bps, max_ownership_bps)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (bond_address, block_number) DO UPDATE SET
       holder_count = EXCLUDED.holder_count,
       max_investors = EXCLUDED.max_investors,
       largest_bps = EXCLUDED.largest_bps,
       max_ownership_bps = EXCLUDED.max_ownership_bps`,
    [bond.toLowerCase(), blockNumber, holderCount, maxInvestors.toString(), largestBps.toString(), maxOwnershipBps.toString()],
  );
}
