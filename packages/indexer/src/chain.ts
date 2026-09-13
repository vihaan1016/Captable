import { createPublicClient, http, parseAbi, type PublicClient } from 'viem';

const rpc = process.env.HEDERA_RPC ?? 'https://testnet.hashio.io/api';
const fallback = process.env.HEDERA_RPC_FALLBACK;

export function createChainClient(): PublicClient {
  // The Hedera JSON-RPC relay rejects `eth_getLogs` inside batched requests
  // ("not permitted as part of batch requests"), so batching must stay off.
  return createPublicClient({
    transport: http(rpc),
  });
}

export function createFallbackClient(): PublicClient {
  return createPublicClient({
    transport: http(fallback ?? rpc),
  });
}

export const ABI = parseAbi([
  // CCA factory
  'event AuctionCreated(address indexed auction, address indexed token, uint256 amount, bytes configData)',
  // CCA
  'event BidSubmitted(uint256 indexed id, address indexed owner, uint256 priceQ96, uint128 amount)',
  'event BidExited(uint256 indexed bidId, address indexed owner, uint256 tokensFilled, uint256 currencyRefunded)',
  'event TokensClaimed(uint256 indexed bidId, address indexed owner, uint256 tokensFilled)',
  'event CheckpointUpdated(uint256 blockNumber, uint256 clearingPriceQ96, uint24 cumulativeMps)',
  'event TokensReceived(uint128 totalSupply)',
  // SettlementRouter
  'event BidPlaced(uint256 indexed bidId, address indexed beneficiary, uint256 maxPriceQ96, uint128 amount)',
  'event Settled(uint256 indexed bidId, address indexed beneficiary, uint128 tokensFilled, uint8 path)',
  'event RefundedIneligible(uint256 indexed bidId, address indexed beneficiary, uint128 tokensFilled, uint256 refundValue)',
  'event HoldCreated(uint256 indexed bidId, uint256 indexed holdId, bytes32 lockHash, uint256 expiration)',
]);

export const BOND_ABI = parseAbi([
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function compliance() view returns (address)',
  'function getTotalSecurityHolders() view returns (uint256)',
  'function getSecurityHolders(uint256,uint256) view returns (address[])',
  'function getKycStatusFor(address) view returns (uint8)',
  'function isInControlList(address) view returns (bool)',
  'function getControlListType() view returns (bool)',
  // Held/locked complete the total picture: ATS `balanceOf` returns AVAILABLE
  // only (F-13), so the register would under-count fully-held holders.
  'function getHeldAmountFor(address) view returns (uint256)',
  'function getLockedAmountFor(address) view returns (uint256)',
]);

export const COMPLIANCE_ABI = parseAbi([
  'function maxInvestors() view returns (uint256)',
  'function maxOwnershipBps() view returns (uint256)',
]);

export const AUCTION_ABI = parseAbi([
  'function clearingPrice() view returns (uint256)',
  'function currencyRaised() view returns (uint256)',
  'function totalCleared() view returns (uint256)',
  'function remainingSupply() view returns (uint256)',
  'function isGraduated() view returns (bool)',
  'function token() view returns (address)',
]);

export const ROUTER_ABI = parseAbi([
  'function settlementReserve() view returns (uint256)',
]);

export const HOOK_ABI = parseAbi([
  'function SETTLEMENT_ROUTER() view returns (address)',
  'function AGGREGATOR() view returns (address)',
]);

export const ORACLE_ABI = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
]);

export const AUCTION_PARAMETERS_ABI = [
  { name: 'currency', type: 'address' },
  { name: 'tokensRecipient', type: 'address' },
  { name: 'fundsRecipient', type: 'address' },
  { name: 'startBlock', type: 'uint64' },
  { name: 'endBlock', type: 'uint64' },
  { name: 'claimBlock', type: 'uint64' },
  { name: 'tickSpacing', type: 'uint256' },
  { name: 'validationHook', type: 'address' },
  { name: 'floorPrice', type: 'uint256' },
  { name: 'requiredCurrencyRaised', type: 'uint128' },
  { name: 'auctionStepsData', type: 'bytes' },
] as const;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function backoff(attempt: number, baseMs = 500): number {
  const jitter = Math.random() * 200;
  return Math.min(baseMs * 2 ** attempt + jitter, 30_000);
}
