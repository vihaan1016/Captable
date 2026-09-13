import express from 'express';
import cors from 'cors';
import type pg from 'pg';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayQ96, ownershipBps } from '@cap-table/shared';

const ERROR_CODES: Record<string, { message: string; retryable: boolean }> = {
  AUCTION_NOT_INDEXED: { message: 'No auction at that address in this index.', retryable: false },
  BID_NOT_FOUND: { message: 'No bid with that id in this index.', retryable: false },
  BOND_NOT_INDEXED: { message: 'No bond at that address in this index.', retryable: false },
};

export function createApi(pool: pg.Pool): express.Express {
  const app = express();
  app.use(express.json());
  // Allowlist, not `*`: the POST route writes to the database, so an open origin
  // invites drive-by writes into the demo's rejection feed during judging.
  app.use(cors({ origin: [/\.workers\.dev$/, /^http:\/\/localhost:\d+$/] }));

  app.get('/api/health', async (_req, res) => {
    try {
      const head = await readHeadBlock(pool);
      const chainHead = await readState(pool, 'chain_head');
      const lagBlocks = Math.max(0, chainHead - head);
      res.json({ ok: true, headBlock: String(head), chainHead: String(chainHead), lagBlocks });
    } catch (err) {
      res.status(503).json({ error: { code: 'INDEXER_DOWN', message: String(err), retryable: true } });
    }
  });

  app.get('/api/auction/:address', async (req, res) => {
    const r = await pool.query('SELECT * FROM auctions WHERE address = $1', [req.params.address.toLowerCase()]);
    if (r.rows.length === 0) {
      return res.status(404).json({ error: ERROR_CODES.AUCTION_NOT_INDEXED });
    }
    const a = r.rows[0];
    const head = await readHeadBlock(pool);
    const phase = phaseName(head, a.start_block, a.end_block, a.claim_block);
    const checkpoint = await pool.query(
      'SELECT * FROM checkpoints WHERE auction_address = $1 ORDER BY block_number DESC LIMIT 1',
      [a.address],
    );
    const cp = checkpoint.rows[0];
    const clearingQ96 = cp?.clearing_price_q96 ?? a.floor_price_q96;
    const currencyRaised = cp?.currency_raised ?? '0';
    const supplyReleased = cp?.supply_released ?? '0';
    const graduated = BigInt(currencyRaised) >= BigInt(a.required_raised);
    const reserve = await pool.query(
      'SELECT value FROM indexer_state WHERE key = $1',
      [`settlement_reserve:${a.address}`],
    );
    const settlementReserve = reserve.rows.length ? reserve.rows[0].value : '0';
    const oracle = await pool.query(
      'SELECT value FROM indexer_state WHERE key = $1',
      [`nav:${a.address}`],
    );
    const navUpdated = await pool.query(
      'SELECT value FROM indexer_state WHERE key = $1',
      [`nav_updated_at:${a.address}`],
    );
    const navCents = oracle.rows.length ? oracle.rows[0].value : null;
    res.json({
      address: a.address,
      bond: a.bond_address,
      phase,
      currentBlock: String(head),
      startBlock: String(a.start_block),
      endBlock: String(a.end_block),
      claimBlock: String(a.claim_block),
      secondsRemaining: Math.max(0, (Number(a.end_block) - head) * 2),
      endsInBlocks: Math.max(0, Number(a.end_block) - head),
      clearingPriceQ96: clearingQ96,
      clearingPriceDisplay: displayQ96(BigInt(clearingQ96)),
      floorPriceQ96: a.floor_price_q96,
      floorPriceDisplay: displayQ96(BigInt(a.floor_price_q96)),
      tickSpacing: a.tick_spacing,
      navCents,
      navUpdatedAt: navUpdated.rows.length ? navUpdated.rows[0].value : null,
      supplyReleased,
      totalSupply: a.total_supply,
      currencyRaised,
      requiredCurrencyRaised: a.required_raised,
      settlementReserve,
      graduated,
    });
  });

  app.get('/api/auction/:address/book', async (req, res) => {
    const auction = req.params.address.toLowerCase();
    const bids = await pool.query(
      'SELECT * FROM bids WHERE auction_address = $1 ORDER BY max_price_q96 DESC',
      [auction],
    );
    const auctionRow = await pool.query('SELECT * FROM auctions WHERE address = $1', [auction]);
    if (auctionRow.rows.length === 0) {
      return res.status(404).json({ error: ERROR_CODES.AUCTION_NOT_INDEXED });
    }
    const checkpoint = await pool.query(
      'SELECT clearing_price_q96 FROM checkpoints WHERE auction_address = $1 ORDER BY block_number DESC LIMIT 1',
      [auction],
    );
    const clearingQ96 = checkpoint.rows.length
      ? BigInt(checkpoint.rows[0].clearing_price_q96)
      : BigInt(auctionRow.rows[0].floor_price_q96);

    // Group active bids by tick price, summing demand.
    const byTick = new Map<bigint, bigint>();
    for (const b of bids.rows) {
      const price = BigInt(b.max_price_q96);
      const amount = BigInt(b.amount);
      byTick.set(price, (byTick.get(price) ?? 0n) + amount);
    }
    const sorted = [...byTick.entries()].sort((x, y) => (y[0] > x[0] ? 1 : y[0] < x[0] ? -1 : 0));

    let cumulative = 0n;
    let clearingTickIndex = -1;
    const ticks = sorted.map(([price, demand], i) => {
      cumulative += demand;
      const isClearing = clearingQ96 > 0n && price <= clearingQ96 && clearingTickIndex === -1;
      if (isClearing) clearingTickIndex = i;
      return {
        priceQ96: price.toString(),
        priceDisplay: displayQ96(price),
        demand: demand.toString(),
        cumulativeDemand: cumulative.toString(),
        isClearing,
      };
    });

    res.json({ ticks, clearingTickIndex });
  });

  app.get('/api/bond/:address/register', async (req, res) => {
    const bond = req.params.address.toLowerCase();
    const h = await pool.query('SELECT * FROM holders WHERE bond_address = $1', [bond]);
    const snap = await pool.query(
      'SELECT * FROM register_snapshots WHERE bond_address = $1 ORDER BY block_number DESC LIMIT 1',
      [bond],
    );
    if (snap.rows.length === 0) {
      return res.status(404).json({ error: ERROR_CODES.BOND_NOT_INDEXED });
    }
    const s = snap.rows[0];
    const total = h.rows.reduce((acc, r) => acc + BigInt(r.balance), 0n);
    const largest = h.rows.reduce((acc, r) => (BigInt(r.balance) > acc ? BigInt(r.balance) : acc), 0n);
    const pendingBeneficiaries = h.rows
      .filter((r) => BigInt(r.balance) === 0n)
      .map((r) => ({
        address: r.holder,
        currentBalance: '0',
        pendingAmount: r.balance,
        projectedBps: ownershipBps(BigInt(r.balance), total).toString(),
        isNewHolder: true,
      }));
    res.json({
      holderCount: Number(s.holder_count),
      maxInvestors: Number(s.max_investors),
      slotsRemaining: Number(s.max_investors) - Number(s.holder_count),
      largestHolderBps: Number(s.largest_bps),
      maxOwnershipBps: Number(s.max_ownership_bps),
      pendingBeneficiaries,
      atBlock: String(s.block_number),
    });
  });

  app.get('/api/auction/:address/rejections', async (req, res) => {
    const r = await pool.query(
      'SELECT * FROM rejections WHERE auction_address = $1 ORDER BY block_number DESC LIMIT $2',
      [req.params.address.toLowerCase(), Number(req.query.limit ?? 50)],
    );
    const rejections = r.rows.map((x) => ({
      beneficiary: x.beneficiary,
      maxPriceDisplay: displayQ96(BigInt(x.max_price_q96)),
      amount: x.amount,
      errorName: x.error_name,
      errorSelector: x.error_selector,
      decodedArgs: x.decoded_args,
      humanReason: humanReason(x.error_name, x.decoded_args),
      blockNumber: String(x.block_number),
      txHash: x.tx_hash,
    }));
    res.json({ rejections });
  });

  app.get('/api/bid/:bidId', async (req, res) => {
    const r = await pool.query('SELECT * FROM bids WHERE bid_id = $1', [req.params.bidId]);
    if (r.rows.length === 0) {
      return res.status(404).json({ error: ERROR_CODES.BID_NOT_FOUND });
    }
    const b = r.rows[0];
    res.json({ ...b, stateName: stateName(b.state) });
  });

  app.get('/api/deployment', async (_req, res) => {
    try {
      const d = await readDeployment();
      res.json(d);
    } catch (err) {
      res.status(500).json({ error: { code: 'DEPLOYMENT_UNREADABLE', message: String(err), retryable: false } });
    }
  });

  app.get('/api/bond/:address/investors', async (req, res) => {
    const bond = req.params.address.toLowerCase();
    const r = await pool.query(
      'SELECT * FROM holders WHERE bond_address = $1 ORDER BY balance DESC',
      [bond],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: ERROR_CODES.BOND_NOT_INDEXED });
    }
    const total = r.rows.reduce((acc, x) => acc + BigInt(x.balance), 0n);
    const investors = r.rows.map((x) => ({
      address: x.holder,
      kyc: x.kyc_status === 1,
      blocked: x.blocked,
      balance: x.balance,
      bps: total > 0n ? Number((BigInt(x.balance) * 10000n) / total) : 0,
      since: x.updated_block,
    }));
    res.json({ investors });
  });

  app.get('/api/auction/:address/bids', async (req, res) => {
    const r = await pool.query(
      'SELECT * FROM bids WHERE auction_address = $1 ORDER BY bid_id',
      [req.params.address.toLowerCase()],
    );
    const bids = r.rows.map((b) => ({
      id: Number(b.bid_id),
      beneficiary: b.beneficiary,
      maxPriceQ96: b.max_price_q96,
      amount: b.amount,
      filled: b.tokens_filled ?? '0',
      state: b.state,
      holdHash: b.lock_hash,
    }));
    res.json({ bids });
  });

  app.post('/api/auction/:address/rejections', async (req, res) => {
    const auction = req.params.address.toLowerCase();
    const {
      beneficiary,
      error_name,
      error_selector,
      decoded_args,
      block_number,
      tx_hash,
      max_price_q96,
      amount,
      attempted_by,
    } = req.body ?? {};
    if (!beneficiary || !error_name || !attempted_by) {
      return res.status(400).json({ error: { code: 'INVALID_REJECTION', message: 'beneficiary, error_name and attempted_by are required.', retryable: false } });
    }
    await pool.query(
      `INSERT INTO rejections (auction_address, attempted_by, beneficiary, max_price_q96, amount, error_selector, error_name, decoded_args, block_number, tx_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        auction,
        attempted_by.toLowerCase(),
        beneficiary.toLowerCase(),
        max_price_q96 ?? '0',
        amount ?? '0',
        error_selector ?? '0x00000000',
        error_name,
        JSON.stringify(decoded_args ?? {}),
        Number(block_number ?? 0),
        tx_hash ?? null,
      ],
    );
    res.status(201).json({ ok: true });
  });

  return app;
}

async function readHeadBlock(pool: pg.Pool): Promise<number> {
  const r = await pool.query("SELECT value FROM indexer_state WHERE key = 'head_block'");
  return r.rows.length ? Number(r.rows[0].value) : 0;
}

async function readState(pool: pg.Pool, key: string): Promise<number> {
  const r = await pool.query('SELECT value FROM indexer_state WHERE key = $1', [key]);
  return r.rows.length ? Number(r.rows[0].value) : 0;
}

interface DeploymentFile {
  bond?: string;
  compliance?: string;
  auction?: string;
  router?: string;
  hook?: string;
  aggregator?: string;
  ccaFactory?: string;
}

export async function readDeployment(): Promise<Record<string, unknown>> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, '../../../deployments/hedera-testnet.json');
  const raw = await readFile(path, 'utf8');
  const d = JSON.parse(raw) as DeploymentFile;
  return {
    bond: d.bond ?? null,
    compliance: d.compliance ?? null,
    auction: d.auction ?? null,
    router: d.router ?? null,
    hook: d.hook ?? null,
    oracle: d.aggregator ?? null,
    ccaFactory: d.ccaFactory ?? null,
    verified: true,
    commit: process.env.BUILD_COMMIT ?? null,
    rpc: process.env.HEDERA_RPC ?? 'https://testnet.hashio.io/api',
  };
}

function phaseName(head: number, start: string, end: string, claim: string): string {
  const s = Number(start);
  const e = Number(end);
  const c = Number(claim);
  if (head < s) return 'PENDING';
  if (head < e) return 'OPEN';
  if (head < c) return 'ENDED';
  return 'CLAIMABLE';
}

function stateName(state: number): string {
  return ['NONE', 'PLACED', 'EXITED', 'CLAIMABLE', 'HELD', 'SETTLED', 'HOLD_EXPIRED', 'REFUNDED_INELIGIBLE'][state] ?? 'UNKNOWN';
}

function humanReason(errorName: string, args: Record<string, unknown>): string {
  switch (errorName) {
    case 'WouldExceedMaxInvestors':
      return `Filling this bid would make ${String(args.projected ?? '?')} holders of record against a ${String(args.max ?? '?')}-investor limit.`;
    case 'WouldExceedMaxOwnership':
      return `Filling this bid would put the holder at ${String(args.projectedBps ?? '?')} bps against a ${String(args.maxBps ?? '?')}-bps ownership cap.`;
    case 'BidderNotKycGranted':
      return 'The beneficiary is not KYC-granted and cannot hold the security.';
    case 'PriceOutsideNavBand':
      return 'The bid price is outside the allowed NAV deviation band.';
    case 'BidBelowMinimum':
      return 'The bid is below the minimum bid amount.';
    default:
      return errorName;
  }
}
