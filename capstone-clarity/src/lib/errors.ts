export type ErrorArgs = Record<string, string | number>;

export interface AppError {
  name: string;
  selector: string;
  args: ErrorArgs;
  sentence: string;
  hint?: string | undefined;
  severity: "identity" | "register" | "settlement" | "unknown";
  /** Set when a forced write was mined and reverted: the real tx hash. */
  txHash?: string | undefined;
}

type Builder = (args: ErrorArgs) => AppError;

const mk =
  (
    name: string,
    selector: string,
    severity: AppError["severity"],
    sentence: (a: ErrorArgs) => string,
    hint?: string,
  ): Builder =>
  (args) => ({ name, selector, args, sentence: sentence(args), hint, severity });

/**
 * Real Solidity custom-error selectors, taken from
 * contracts/src/CapTableValidationHook.sol and
 * contracts/src/interfaces/ISettlementRouter.sol. `previewValidate` returns
 * these as its `bytes4 reason`, so the UI must decode them exactly.
 */
export const ERROR_REGISTRY: Record<string, Builder> = {
  // Hook — identity
  "0xff3c09d5": mk(
    "BidderNotKycGranted",
    "0xff3c09d5",
    "identity",
    (a) => `The beneficiary ${a["account"] ?? "?"} has no KYC grant and cannot hold the security.`,
    "Grant KYC from console §3 before bidding.",
  ),
  "0xa608dbef": mk(
    "BidderBlocked",
    "0xa608dbef",
    "identity",
    (a) => `The beneficiary ${a["account"] ?? "?"} is on the control list and cannot receive the security.`,
    "Remove the address from the control list in console §3.",
  ),
  "0xaebf4ec4": mk(
    "TransferWouldFailCompliance",
    "0xaebf4ec4",
    "identity",
    () => "The transfer would fail the issuer's compliance rules.",
  ),
  "0xc78bc3cb": mk(
    "ZeroBeneficialOwner",
    "0xc78bc3cb",
    "identity",
    () => "The beneficial owner must be a non-zero address.",
  ),

  // Hook — register projection
  "0xf94e2d7c": mk(
    "WouldExceedMaxInvestors",
    "0xf94e2d7c",
    "register",
    (a) =>
      `Filling this bid would make ${a["projected"] ?? "?"} holders of record against a ${a["max"] ?? "?"}-investor limit.`,
    "Use an existing holder as beneficiary, or raise maxInvestors in console §2 — the hook reads the live cap.",
  ),
  "0x840308b8": mk(
    "WouldExceedMaxOwnership",
    "0x840308b8",
    "register",
    (a) =>
      `This fill would give the beneficiary ${a["projectedBps"] ?? "?"} bps against a ${a["maxBps"] ?? "?"} bps concentration cap.`,
    "Split the order across beneficiaries, or relax maxOwnershipBps in console §2.",
  ),
  "0xf7ea5440": mk(
    "BidBelowMinimum",
    "0xf7ea5440",
    "register",
    (a) => `Bids below ${a["minBid"] ?? "?"} raw units are refused to stop dust holders.`,
  ),

  // Hook — oracle
  "0xf08edadc": mk(
    "PriceOutsideNavBand",
    "0xf08edadc",
    "settlement",
    (a) => `Price sits outside the NAV band of ${a["lo"] ?? "?"} to ${a["hi"] ?? "?"}.`,
    "Move the price toward live NAV, or push a fresh NAV from console §5.",
  ),

  // Router
  "0xd2ade556": mk(
    "IncorrectValue",
    "0xd2ade556",
    "settlement",
    () => "The native HBAR sent does not match the bid amount.",
  ),
  "0xf54e1807": mk(
    "ReserveUnderfunded",
    "0xf54e1807",
    "settlement",
    (a) =>
      `The settlement reserve holds ${a["have"] ?? "?"} against ${a["needed"] ?? "?"} required for this refund.`,
    "Fund the reserve as SELLER before settling.",
  ),
  "0x6b46fcbe": mk(
    "InvalidStateTransition",
    "0x6b46fcbe",
    "settlement",
    () => "This bid is not in the state required for that operation.",
  ),
  "0x560ff900": mk(
    "AlreadySettled",
    "0x560ff900",
    "settlement",
    () => "This bid has already been settled or refunded.",
  ),
  "0x0f5bb4ec": mk(
    "BidDoesNotExist",
    "0x0f5bb4ec",
    "settlement",
    () => "No bid exists with that id.",
  ),
};

export function decodeAppError(selector: string, args: ErrorArgs = {}): AppError {
  const build = ERROR_REGISTRY[selector.toLowerCase()];
  if (!build) {
    return {
      name: "UnknownRevert",
      selector,
      args,
      sentence: `The contract reverted with an unrecognised selector ${selector}.`,
      severity: "unknown",
    };
  }
  return build(args);
}

/** Extract the 4-byte selector from a viem/custom revert and decode it. */
export function decodeContractError(err: unknown, args: ErrorArgs = {}): AppError {
  const selector = extractSelector(err);
  return decodeAppError(selector, args);
}

function extractSelector(err: unknown): string {
  if (err instanceof Error) {
    const s = String(err.message ?? err.name);
    const m = /(0x[0-9a-fA-F]{8})/.exec(s);
    if (m) return m[1]!;
  }
  const anyErr = err as { selector?: string; shortMessage?: string; data?: unknown } | null;
  if (anyErr?.selector) return anyErr.selector;
  if (anyErr?.shortMessage) {
    const m = /(0x[0-9a-fA-F]{8})/.exec(anyErr.shortMessage);
    if (m) return m[1]!;
  }
  return "0x00000000";
}

export const SEVERITY_TONE: Record<AppError["severity"], "warning" | "refusal" | "neutral"> = {
  identity: "warning",
  register: "refusal",
  settlement: "refusal",
  unknown: "neutral",
};
