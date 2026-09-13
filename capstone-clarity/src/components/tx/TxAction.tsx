import { useState } from "react";
import { cn } from "@/lib/utils";
import { decodeContractError, type AppError } from "@/lib/errors";
import { DrawnCheck, LiquidLoader, Typed, hashscanTx } from "@/components/kit";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type TxPhase = "idle" | "simulating" | "signing" | "pending" | "success" | "reverted";

export interface TxActionProps {
  label: string;
  pendingLabel?: string;
  /**
   * Return null when the call would succeed. Return a decoded `AppError` (or a
   * bare selector, which is decoded without arguments) to block the write and
   * show the revert.
   */
  simulate?: () => Promise<AppError | string | null>;
  /** Write path. Returns a transaction hash, or throws with a decoded reason. */
  write: () => Promise<string> | string;
  disabledReason?: string | undefined;
  destructive?: boolean;
  /** `verb` is the bare `[ SETTLE ]` form used inside data rows. */
  variant?: "primary" | "ghost" | "verb";
  className?: string;
  onSuccess?: () => void;
  /** Called when `simulate` blocks the write, so the caller can log it. */
  onRevert?: (error: AppError) => void;
}

export function TxAction({
  label,
  pendingLabel = "Confirming",
  simulate,
  write,
  disabledReason,
  destructive = false,
  variant = "primary",
  className,
  onSuccess,
  onRevert,
}: TxActionProps) {
  const [phase, setPhase] = useState<TxPhase>("idle");
  const [error, setError] = useState<AppError | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const disabled = Boolean(disabledReason);
  const busy = phase === "simulating" || phase === "signing" || phase === "pending";

  async function run() {
    if (disabled || busy) return;
    setError(null);
    setHash(null);
    if (simulate) {
      setPhase("simulating");
      const revert = await simulate();
      if (revert) {
        const decoded = typeof revert === "string" ? decodeContractError(revert) : revert;
        setError(decoded);
        setPhase("reverted");
        onRevert?.(decoded);
        return;
      }
    }
    setPhase("signing");
    try {
      const tx = await write();
      setHash(typeof tx === "string" ? tx : null);
      setPhase("success");
      onSuccess?.();
      setTimeout(() => setPhase("idle"), 4000);
    } catch (err) {
      // A forced write (e.g. "Submit anyway") throws the AppError it already
      // holds, including its decoded args and the mined tx hash — pass it
      // through instead of re-decoding from a bare error message.
      const decoded = isAppError(err) ? err : decodeContractError(err);
      setError(decoded);
      setPhase("reverted");
      onRevert?.(decoded);
    }
  }

  const text =
    phase === "simulating"
      ? "Simulating"
      : phase === "signing"
        ? "Sign in wallet"
        : phase === "pending"
          ? pendingLabel
          : phase === "success"
            ? "Confirmed"
            : phase === "reverted"
              ? "Reverted"
              : label;

  const button = (
    <button
      type="button"
      onClick={() => void run()}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 font-mono uppercase tracking-[0.12em] transition-colors duration-150",
        variant === "verb" && "text-[10px]",
        variant !== "verb" && "border px-4 py-2 text-[11px]",
        variant === "primary" &&
          !destructive &&
          "border-foreground bg-foreground text-primary-foreground hover:bg-transparent hover:text-foreground",
        variant === "ghost" &&
          "border-border bg-transparent text-foreground/85 hover:border-ring hover:text-foreground",
        variant === "verb" &&
          (destructive
            ? "text-refusal/70 hover:text-refusal"
            : "text-muted-foreground hover:text-foreground"),
        variant !== "verb" &&
          destructive &&
          "border-refusal/40 bg-transparent text-refusal hover:bg-refusal hover:text-destructive-foreground",
        disabled &&
          "cursor-not-allowed text-disabled-foreground hover:text-disabled-foreground " +
            (variant === "verb"
              ? ""
              : "border-dashed border-border bg-transparent hover:bg-transparent"),
        phase === "reverted" &&
          variant !== "verb" &&
          "shake border-refusal bg-refusal/10 text-refusal",
        className,
      )}
    >
      {busy && variant !== "verb" && <LiquidLoader />}
      {phase === "success" && variant !== "verb" && <DrawnCheck />}
      <span>{variant === "verb" ? `[ ${text} ]` : text}</span>
    </button>
  );

  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      {disabledReason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{button}</span>
          </TooltipTrigger>
          <TooltipContent className="border border-border bg-background font-mono text-[10px] uppercase tracking-[0.1em]">
            {disabledReason}
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}

      {phase === "reverted" && error && variant !== "verb" && (
        <span className="block max-w-sm space-y-1 font-mono text-[11px] leading-snug">
          <Typed text={`> revert ${error.selector} ${error.name}`} className="block text-refusal" />
          <span className="block text-foreground/80">{error.sentence}</span>
          {error.hint && <span className="block text-muted-foreground">{error.hint}</span>}
        </span>
      )}

      {phase !== "idle" && (hash ?? (phase === "reverted" ? error?.txHash ?? null : null)) && variant !== "verb" && (
        <a
          href={hashscanTx(hash ?? error?.txHash ?? "")}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {(hash ?? error?.txHash ?? "").slice(0, 18)}... on HashScan
        </a>
      )}
    </span>
  );
}

/** True when the thrown value is already a decoded AppError (forced writes). */
function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    "selector" in e &&
    "sentence" in e &&
    "severity" in e &&
    "name" in e
  );
}
