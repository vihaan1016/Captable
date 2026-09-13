import type express from 'express';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const rpc = process.env.HEDERA_RPC ?? 'https://testnet.hashio.io/api';

const hederaTestnet = defineChain({
  id: 296,
  name: 'Hedera Testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});

const KYC_ABI = [
  {
    type: 'function',
    name: 'grantKyc',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'vcId', type: 'string' },
      { name: 'validFrom', type: 'uint256' },
      { name: 'validTo', type: 'uint256' },
      { name: 'issuer', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getKycStatusFor',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

// In-memory rate limiting. Bounded by the demo's single process; the controls
// that actually matter are the on-chain idempotence check and the global cap.
const hour = 3_600_000;
let globalGrants: number[] = [];
const perIp: Record<string, number[]> = {};

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  globalGrants = globalGrants.filter((t) => now - t < hour);
  perIp[ip] = (perIp[ip] ?? []).filter((t) => now - t < hour);
  return globalGrants.length >= 20 || perIp[ip]!.length >= 5;
}

function recordGrant(ip: string): void {
  const now = Date.now();
  globalGrants.push(now);
  (perIp[ip] ??= []).push(now);
}

/**
 * Self-serve demo KYC. The issuer key is testnet-only and is an ATS issuer on a
 * single demo bond: it can grant KYC, nothing else. One function, one argument.
 */
export function mountFaucet(app: express.Express, bond: string): void {
  app.post('/api/faucet/kyc', async (req, res) => {
    if (process.env.FAUCET_ENABLED !== 'true') {
      return res.status(404).json({
        error: { code: 'FAUCET_DISABLED', message: 'Demo KYC faucet is disabled.', retryable: false },
      });
    }

    const address = String(req.body?.address ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      return res.status(400).json({
        error: { code: 'INVALID_ADDRESS', message: 'address is required.', retryable: false },
      });
    }

    if (isRateLimited(req.ip ?? 'unknown')) {
      return res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many KYC grants. Try again later.', retryable: true },
      });
    }

    const key = process.env.ISSUER_PRIVATE_KEY;
    if (!key) {
      return res.status(503).json({
        error: { code: 'FAUCET_UNCONFIGURED', message: 'Issuer key not configured.', retryable: false },
      });
    }

    try {
      const publicClient = createPublicClient({ chain: hederaTestnet, transport: http(rpc) });

      // Idempotent + cheap: refuse if already KYC'd before spending gas.
      const status = await publicClient.readContract({
        address: bond as `0x${string}`,
        abi: KYC_ABI,
        functionName: 'getKycStatusFor',
        args: [address as `0x${string}`],
      });
      if (Number(status) !== 0) {
        return res.status(200).json({ ok: true, alreadyGranted: true });
      }

      const account = privateKeyToAccount(key as `0x${string}`);
      const wallet = createWalletClient({ chain: hederaTestnet, transport: http(rpc), account });
      const now = BigInt(Math.floor(Date.now() / 1000));
      const hash = await wallet.writeContract({
        address: bond as `0x${string}`,
        abi: KYC_ABI,
        functionName: 'grantKyc',
        args: [address as `0x${string}`, 'demo', now, now + 31_536_000n, account.address],
      });

      recordGrant(req.ip ?? 'unknown');
      return res.status(201).json({ ok: true, tx: hash, address });
    } catch (err) {
      console.error('[faucet]', err);
      return res.status(502).json({
        error: { code: 'FAUCET_FAILED', message: String(err), retryable: true },
      });
    }
  });
}
