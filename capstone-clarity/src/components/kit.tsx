import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { truncateAddress } from "@/lib/units";

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono tabular-nums", className)}>{children}</span>;
}

/**
 * A live value that flashes on change, the way a trading terminal marks a
 * print. Remounting on a key restarts the CSS animation; a transition would
 * only fire on the first change and then sit at the end state.
 */
export function Tick({
  value,
  direction = "up",
  className,
}: {
  value: string | number;
  /** Which semantic color the flash starts from. */
  direction?: "up" | "down";
  className?: string;
}) {
  const [beat, setBeat] = useState(0);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setBeat((b) => b + 1);
  }, [value]);

  return (
    <span
      key={beat}
      className={cn(
        "font-mono tabular-nums",
        beat > 0 && (direction === "down" ? "tick-flash-down" : "tick-flash"),
        className,
      )}
    >
      {value}
    </span>
  );
}

/**
 * Reveals text a couple of characters at a time. Used for revert output so a
 * refusal reads as something the venue just returned, not as static copy.
 */
export function Typed({
  text,
  totalMs = 150,
  className,
}: {
  text: string;
  totalMs?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    setShown(0);
    if (!text) return;
    const step = Math.max(1, Math.ceil(text.length / (totalMs / 12)));
    let i = 0;
    const id = setInterval(() => {
      i += step;
      setShown(i);
      if (i >= text.length) clearInterval(id);
    }, 12);
    return () => clearInterval(id);
  }, [text, totalMs]);

  const done = shown >= text.length;
  return (
    <span className={className}>
      {text.slice(0, shown)}
      {!done && <span className="caret">_</span>}
    </span>
  );
}

type Tone = "pending" | "success" | "refusal" | "warning" | "neutral" | "primary";

/**
 * Semantic tag. A 10% wash and a 20% hairline, never a solid fill: the tag has
 * to read as data at a glance without becoming a container.
 */
const TONE_CLASS: Record<Tone, string> = {
  pending: "border-warning/20 bg-warning/10 text-warning",
  warning: "border-warning/20 bg-warning/10 text-warning",
  success: "border-success/20 bg-success/10 text-success",
  refusal: "border-refusal/25 bg-refusal/10 text-refusal",
  neutral: "border-border bg-transparent text-muted-foreground",
  primary: "border-foreground/20 bg-foreground/10 text-foreground",
};

export function Tag({
  tone = "neutral",
  children,
  dot = false,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] uppercase leading-[1.5] tracking-[0.1em]",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot && <span className="pulse-dot size-1.5 bg-current" />}
      {children}
    </span>
  );
}

/** Section label. `// NAME` is the only heading form the workspace uses. */
export function SectionLabel({
  children,
  right,
  className,
}: {
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex h-12 shrink-0 items-center gap-3 border-b border-border px-6", className)}
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        // {children}
      </span>
      {right && <div className="ml-auto flex items-center gap-3">{right}</div>}
    </div>
  );
}

export function AddressCell({
  address,
  href,
  dim = true,
  className,
}: {
  address: string;
  href?: string;
  /** Addresses are reference data, so they sit back from the values. */
  dim?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <Mono className={cn("text-[12.5px]", dim ? "text-muted-foreground" : "text-foreground")}>
        {truncateAddress(address)}
      </Mono>
      <button
        type="button"
        aria-label="Copy address"
        onClick={() => {
          void navigator.clipboard?.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="text-disabled-foreground transition-colors hover:text-foreground"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label="View on HashScan"
          className="text-disabled-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </span>
  );
}

export function hashscan(address: string) {
  return `https://hashscan.io/testnet/address/${address}`;
}

export function hashscanTx(hash: string) {
  return `https://hashscan.io/testnet/transaction/${hash}`;
}

export function InlineCode({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[12px] text-success">{children}</code>;
}

export function LiquidLoader({ className }: { className?: string }) {
  return <span className={cn("liquid-loader inline-block size-2", className)} aria-hidden />;
}

export function DrawnCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-3", className)} aria-hidden>
      <path
        d="M4 12.5l5 5L20 6.5"
        fill="none"
        stroke="var(--success)"
        strokeWidth="3"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="font-mono text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-sm font-mono text-[12.5px] leading-relaxed text-disabled-foreground">
        {body}
      </p>
    </div>
  );
}

export function DesktopOnlyGate() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-8 lg:hidden">
      <div className="max-w-sm text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          // viewport
        </p>
        <h2 className="mt-3 font-mono text-sm uppercase tracking-[0.12em]">
          Open this on a wider screen
        </h2>
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-disabled-foreground">
          The venue is a multi-pane workspace built for 1440x900 and up. Expand the window to see
          the register, composer and refusal ledger together.
        </p>
      </div>
    </div>
  );
}
