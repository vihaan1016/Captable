export const BID_STATES = {
  0: { name: "NONE", actions: [] },
  1: { name: "PLACED", actions: ["exit"] },
  2: { name: "EXITED", actions: [] },
  3: { name: "CLAIMABLE", actions: ["settle"] },
  4: { name: "HELD", actions: ["executeHold"] },
  5: { name: "SETTLED", actions: [] },
  6: { name: "HOLD_EXPIRED", actions: ["settle"] },
  7: { name: "REFUNDED_INELIGIBLE", actions: [] },
} as const;

export type BidStateCode = keyof typeof BID_STATES;
export type BidStateName = (typeof BID_STATES)[BidStateCode]["name"];
export type BidAction = "exit" | "settle" | "executeHold";

export const ACTION_LABELS: Record<BidAction, string> = {
  exit: "Exit bid",
  settle: "Settle",
  executeHold: "Execute hold",
};

export function actionsFor(state: BidStateCode): readonly BidAction[] {
  return BID_STATES[state].actions as readonly BidAction[];
}

export type ChipTone = "pending" | "success" | "refusal" | "warning" | "neutral";

export const STATE_TONE: Record<BidStateName, ChipTone> = {
  NONE: "neutral",
  PLACED: "pending",
  EXITED: "neutral",
  CLAIMABLE: "warning",
  HELD: "warning",
  SETTLED: "success",
  HOLD_EXPIRED: "warning",
  REFUNDED_INELIGIBLE: "refusal",
};
