import { encodeAbiParameters, keccak256 } from "viem";

/**
 * Hand-authored typed ABIs for the Cap Table contracts. The deployment
 * addresses are resolved from GET /api/deployment, never hardcoded.
 */

export const ROUTER_ABI = [
  {
    type: "function",
    name: "placeBid",
    stateMutability: "payable",
    inputs: [
      { name: "maxPriceQ96", type: "uint256" },
      { name: "amount", type: "uint128" },
      { name: "prevTickPriceQ96", type: "uint256" },
    ],
    outputs: [{ name: "bidId", type: "uint256" }],
  },
  {
    type: "function",
    name: "exitBid",
    stateMutability: "nonpayable",
    inputs: [{ name: "bidId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [{ name: "bidId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "executeHold",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bidId", type: "uint256" },
      { name: "secret", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fundReserve",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "settlementReserve",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingAmountFor",
    stateMutability: "view",
    inputs: [{ name: "beneficiary", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isPendingBeneficiary",
    stateMutability: "view",
    inputs: [{ name: "beneficiary", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "pendingNewBeneficiaryCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const HOOK_ABI = [
  {
    type: "function",
    name: "previewValidate",
    stateMutability: "view",
    inputs: [
      { name: "maxPrice", type: "uint256" },
      { name: "amount", type: "uint128" },
      { name: "beneficialOwner", type: "address" },
    ],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "reason", type: "bytes4" },
    ],
  },
  {
    type: "function",
    name: "registerState",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "holders", type: "uint256" },
      { name: "maxInvestors", type: "uint256" },
      { name: "largestBps", type: "uint256" },
      { name: "maxOwnershipBps", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "bandBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxStaleness",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const COMPLIANCE_ABI = [
  {
    type: "function",
    name: "setRules",
    stateMutability: "nonpayable",
    inputs: [
      { name: "maxInvestors", type: "uint32" },
      { name: "maxOwnershipBps", type: "uint16" },
      { name: "active", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "maxInvestors",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxOwnershipBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const ORACLE_ABI = [
  {
    type: "function",
    name: "setNav",
    stateMutability: "nonpayable",
    inputs: [{ name: "answer", type: "int256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

export const KYC_ABI = [
  {
    type: "function",
    name: "grantKyc",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "vcId", type: "string" },
      { name: "validFrom", type: "uint256" },
      { name: "validTo", type: "uint256" },
      { name: "issuer", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "revokeKyc",
    stateMutability: "nonpayable",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getKycStatusFor",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const CONTROL_LIST_ABI = [
  {
    type: "function",
    name: "addToControlList",
    stateMutability: "nonpayable",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "removeFromControlList",
    stateMutability: "nonpayable",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
  },
] as const;

export const BOND_VIEW_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getHeldAmountFor",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getLockedAmountFor",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const AUCTION_VIEW_ABI = [
  {
    type: "function",
    name: "tokensRecipient",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** Coupon facet (`setCoupon` selector 0xb16fd0cc). Field order is load-bearing. */
export const COUPON_ABI = [
  {
    type: "function",
    name: "setCoupon",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "newCoupon",
        type: "tuple",
        components: [
          { name: "recordDate", type: "uint256" },
          { name: "executionDate", type: "uint256" },
          { name: "startDate", type: "uint256" },
          { name: "endDate", type: "uint256" },
          { name: "fixingDate", type: "uint256" },
          { name: "rate", type: "uint256" },
          { name: "rateDecimals", type: "uint8" },
          { name: "rateStatus", type: "uint8" },
        ],
      },
    ],
    outputs: [{ name: "couponID_", type: "uint256" }],
  },
  {
    type: "function",
    name: "getCouponCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface CouponParams {
  recordDate: bigint;
  executionDate: bigint;
  startDate: bigint;
  endDate: bigint;
  fixingDate: bigint;
  rate: bigint;
  rateDecimals: number;
  rateStatus: number;
}

/** Matches SettlementRouter.SALT ("captable", left-padded to 32 bytes). */
const HOLD_SALT =
  "0x6361707461626c65000000000000000000000000000000000000000000000000" as const;

/**
 * Recompute the DvP secret for a held bid. The router stores only `lockHash`,
 * so the frontend must reproduce `secret = keccak256(abi.encode(beneficiary,
 * tokensFilled, chainId, SALT))` with the same SALT.
 */
export function computeHoldSecret(
  beneficiary: `0x${string}`,
  tokensFilled: bigint,
  chainId: number,
): `0x${string}` {
  const encoded = encodeAbiParameters(
    [
      { name: "beneficiary", type: "address" },
      { name: "tokensFilled", type: "uint256" },
      { name: "chainId", type: "uint256" },
      { name: "salt", type: "bytes32" },
    ],
    [beneficiary, tokensFilled, BigInt(chainId), HOLD_SALT],
  );
  return keccak256(encoded);
}
