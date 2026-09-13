import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Shell } from "@/components/Shell";
import {
  AddressCell,
  EmptyState,
  InlineCode,
  Mono,
  SectionLabel,
  Tag,
  Tick,
  Typed,
  hashscan,
  hashscanTx,
} from "@/components/kit";
import { TxAction } from "@/components/tx/TxAction";
import { useChain, useHydrated, type PreflightResult } from "@/lib/chain-context";
import { BID_STATES, STATE_TONE, actionsFor, ACTION_LABELS } from "@/lib/bidState";
import { SEVERITY_TONE, type AppError } from "@/lib/errors";
import {
  asRawBond,
  blocksToSeconds,
  formatBond,
  formatBps,
  formatCents,
  formatDuration,
  formatInt,
  fromQ96,
  snapToTick,
  toQ96,
} from "@/lib/units";

const TITLE = "Venue - live bond auction book | Cap Table";
const DESC =
  "Place identity-checked bids, watch the clearing price form, and read every refusal with the exact compliance rule that caused it.";

export const Route = createFileRoute("/venue")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
    ],
  }),
  component: Venue,
});

/** A pane. Hairline outline, titled rail, content sized to its own data. */
function Pane({
  title,
  right,
  children,
  className,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={"border border-border " + (className ?? "")}>
      <SectionLabel right={right}>{title}</SectionLabel>
      {children}
    </section>
  );
}

/**
 * Stat cell. The wrapper paints the hairline and the cells sit on the canvas,
 * so the row reads as one ruled block instead of six adjacent boxes with
 * doubled borders between them.
 */
function Stat({
  k,
  v,
  tone,
  live = false,
}: {
  k: string;
  v: string;
  tone?: "success" | "refusal" | "warning" | undefined;
  live?: boolean;
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "refusal"
        ? "text-refusal"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="bg-background px-6 py-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{k}</p>
      {live ? (
        <Tick value={v} className={"mt-2 block text-[22px] leading-none " + color} />
      ) : (
        <Mono className={"mt-2 block text-[22px] leading-none " + color}>{v}</Mono>
      )}
    </div>
  );
}

function Venue() {
  const { state, roles, preflight, actions, clearingQ96 } = useChain();
  const hydrated = useHydrated();

  const [beneficiary, setBeneficiary] = useState(state.actingAs);
  const [priceInput, setPriceInput] = useState("101.25");
  const [amountInput, setAmountInput] = useState("50000");
  const [pf, setPf] = useState<PreflightResult | null>(null);

  const tickQ96 = toQ96(state.tickCents);
  const rawCents = BigInt(Math.round((Number(priceInput) || 0) * 100));
  const snapped = fromQ96(snapToTick(toQ96(rawCents), tickQ96));
  const offTick = snapped.cents !== rawCents;
  const amount = asRawBond(BigInt(Math.max(0, Math.round(Number(amountInput) || 0))) * 100n);

  useEffect(() => {
    let active = true;
    if (beneficiary && amount > 0n) {
      void preflight(beneficiary, snapped.cents, amount).then((r) => {
        if (active) setPf(r);
      });
    } else {
      setPf(null);
    }
    return () => {
      active = false;
    };
  }, [preflight, beneficiary, snapped.cents, amount]);

  const holders = state.investors.filter((i) => i.balance > 0n).length;
  const costCents = (snapped.cents * (amount as bigint)) / 100n;

  const book = useMemo(
    () => [...state.bids].sort((a, b) => Number(b.priceCents - a.priceCents)),
    [state.bids],
  );
  const peak = Math.max(1, ...book.map((b) => Number(b.amount)));
  const claimable = state.bids.filter((b) => b.state === 3 || b.state === 6);

  const connectedKyc =
    state.investors.find((i) => i.address === (state.connected ?? "").toLowerCase())?.kyc ?? false;
  const needsKyc = roles.isConnected && !connectedKyc;
  const [kycPending, setKycPending] = useState(false);

  async function requestKyc() {
    if (!state.connected) return;
    setKycPending(true);
    try {
      await actions.requestKyc(state.connected);
      toast.success("Demo KYC granted", { description: "You can now place bids." });
    } catch (e) {
      toast.error("KYC request failed", { description: String(e) });
    } finally {
      setKycPending(false);
    }
  }

  async function placeBid(): Promise<string> {
    const hash = await actions.placeBid(toQ96(snapped.cents), amount as bigint);
    toast.success("Bid placed", {
      description: `${formatBond(amount)} bonds at $${snapped.display}`,
    });
    return hash;
  }

  /**
   * A blocked simulation is still evidence. Submitting anyway writes the
   * decoded reason into the ledger rather than swallowing it at the button.
   */
  function recordRefusal(error: AppError) {
    void actions.recordRefusal({
      beneficiary,
      priceCents: snapped.cents,
      amountRaw: amount as bigint,
      error,
      block: state.lastBlock,
    });
    toast.error(error.name, { description: error.sentence });
  }

  return (
    <Shell gate>
      <div className="mx-auto max-w-[1720px] px-8 py-8 2xl:px-12">
        {/* Page header */}
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-[26px] font-semibold tracking-tight">Venue</h1>
              <Tag
                tone={state.phase === "OPEN" ? "success" : "warning"}
                dot={state.phase === "OPEN"}
              >
                {state.phase}
              </Tag>
            </div>
            <p className="mt-2 max-w-2xl font-sans text-[14px] leading-relaxed text-muted-foreground">
              Single-price auction. Every order is simulated against identity claims and
              concentration caps before it is signed.
            </p>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                head
              </p>
              <Tick
                value={formatInt(state.lastBlock)}
                className="mt-1.5 block text-[15px] text-foreground"
              />
            </div>
            {needsKyc && (
              <button
                type="button"
                onClick={() => void requestKyc()}
                disabled={kycPending}
                className="border border-success px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-success transition-colors hover:bg-success/10 disabled:opacity-50"
              >
                {kycPending ? "Requesting…" : "Get demo KYC"}
              </button>
            )}
            <TxAction
              label={`Settle claimable (${claimable.length})`}
              variant="ghost"
              disabledReason={
                !roles.isSeller
                  ? "Requires SELLER role."
                  : claimable.length === 0
                    ? "No claimable bids."
                    : undefined
              }
              write={async () => {
                let last = "";
                for (const b of claimable) {
                  last = await actions.settle(b.id);
                }
                toast.success(`Settled ${claimable.length} bids`);
                return last;
              }}
            />
          </div>
        </header>

        {/* Stat row */}
        <div className="mt-8 grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
          <Stat k="clearing" v={`$${formatCents(state.clearingCents)}`} tone="success" live />
          <Stat
            k="ends in"
            v={hydrated ? formatDuration(blocksToSeconds(state.endsInBlocks)) : "--:--:--"}
            live
          />
          <Stat k="nav" v={`$${formatCents(state.navCents)}`} live />
          <Stat
            k="holders"
            v={`${holders}/${state.maxInvestors}`}
            tone={holders >= state.maxInvestors ? "warning" : undefined}
          />
          <Stat k="ownership cap" v={formatBps(state.maxOwnershipBps)} />
          <Stat
            k="refusals"
            v={formatInt(state.refusals.length)}
            tone={state.refusals.length > 0 ? "refusal" : undefined}
            live
          />
        </div>

        {/* Workspace */}
        {/*
          Two independent columns rather than a row-based grid. With grid rows,
          a short pane beside a tall one leaves the next pane in its column
          stranded below the taller row, so the vertical gaps come out uneven
          from column to column. Stacking each column separately keeps every
          gap the same 24px.
        */}
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="flex flex-col gap-6 xl:col-span-5">
            <Pane
              title="Bid composer"
              right={
                <Mono className="text-[11px] text-disabled-foreground">staticcall preflight</Mono>
              }
            >
              <label className="block border-b border-border px-6 py-4">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  Beneficiary
                </span>
                <select
                  value={beneficiary}
                  onChange={(e) => setBeneficiary(e.target.value)}
                  className="mt-1.5 w-full cursor-pointer bg-transparent font-mono text-[13px] text-foreground outline-none"
                >
                  {state.investors.map((i) => (
                    <option key={i.address} value={i.address} className="bg-background">
                      {i.address} {i.blocked ? "/ blocked" : i.kyc ? "/ kyc" : "/ no kyc"}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2">
                <label className="block border-b border-r border-border px-6 py-4">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      Max price (USD)
                    </span>
                    {offTick && (
                      <span className="font-mono text-[11px] text-warning">
                        snaps {snapped.display}
                      </span>
                    )}
                  </span>
                  <input
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    inputMode="decimal"
                    className="mt-1.5 w-full bg-transparent font-mono text-[15px] tabular-nums outline-none"
                  />
                </label>
                <label className="block border-b border-border px-6 py-4">
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    Amount (bonds)
                  </span>
                  <input
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    inputMode="numeric"
                    className="mt-1.5 w-full bg-transparent font-mono text-[15px] tabular-nums outline-none"
                  />
                </label>
              </div>

              <div className="bg-terminal px-6 py-5 font-mono text-[12.5px] leading-[1.9]">
                <Line k="beneficiary" v={beneficiary} />
                <Line k="priceQ96" v={snapped.raw} />
                <Line k="amountRaw" v={(amount as bigint).toString()} />
                <Line k="costUsd" v={`$${formatCents(costCents)}`} />
                <Line
                  k="holders"
                  v={pf ? `${pf.projected.holders} -> ${pf.projected.holdersAfter} / ${pf.projected.maxInvestors}` : "-"}
                  bad={pf ? pf.projected.holdersAfter > pf.projected.maxInvestors : false}
                />
                <Line
                  k="ownershipBps"
                  v={pf ? `${pf.projected.beneficiaryBpsAfter} / ${pf.projected.maxOwnershipBps}` : "-"}
                  bad={pf ? pf.projected.beneficiaryBpsAfter > pf.projected.maxOwnershipBps : false}
                />
                <div className="mt-3">
                  {!pf ? (
                    <span className="text-muted-foreground">{"> checking on-chain…"}</span>
                  ) : pf.ok ? (
                    <span className="text-success">{"> simulation passed, safe to sign"}</span>
                  ) : pf.error ? (
                    <div className="space-y-1.5">
                      <Typed
                        key={pf.error.selector + beneficiary}
                        text={`> revert ${pf.error.selector} ${pf.error.name}`}
                        className="block text-refusal"
                      />
                      <p className="text-foreground/80">{pf.error.sentence}</p>
                      {pf.error.hint && <p className="text-muted-foreground">{pf.error.hint}</p>}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">{"> enter a price and amount"}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 border-t border-border px-6 py-5">
                <TxAction
                  label={pf?.ok ? "Place bid" : "Submit anyway"}
                  pendingLabel="Placing bid"
                  destructive={!pf?.ok}
                  disabledReason={
                    !roles.isConnected
                      ? "Connect a wallet to sign transactions."
                      : state.phase !== "OPEN"
                        ? "The auction is not open for new orders."
                        : amount <= 0n
                          ? "Enter an amount greater than zero."
                          : undefined
                  }
                  simulate={async () => (pf?.ok ? null : (pf?.error ?? null))}
                  onRevert={recordRefusal}
                  write={() => placeBid()}
                />
                <p className="ml-auto font-mono text-[11px] text-disabled-foreground">
                  <InlineCode>Q96</InlineCode> / tick ${formatCents(state.tickCents)}
                </p>
              </div>
            </Pane>

            <Pane
              title="Register"
              right={
                <Mono className="text-[11px] text-disabled-foreground">
                  {holders} of {state.maxInvestors} slots
                </Mono>
              }
            >
              <table className="w-full border-collapse font-mono text-[13px] tabular-nums">
                <Head
                  cols={["holder", "claim", "vs cap", "share", "balance"]}
                  align={[0, 0, 0, 1, 1]}
                />
                <tbody>
                  {state.investors.map((i) => {
                    const pct = Math.min(
                      100,
                      ((i.bps as number) / Math.max(1, state.maxOwnershipBps as number)) * 100,
                    );
                    const hot = (i.bps as number) > (state.maxOwnershipBps as number) * 0.85;
                    return (
                      <tr
                        key={i.address}
                        className="cursor-crosshair border-b border-border transition-colors last:border-0 hover:bg-accent"
                      >
                        <td className="px-6 py-3.5">
                          <AddressCell address={i.address} href={hashscan(i.address)} />
                        </td>
                        <td className="px-6 py-3.5">
                          {i.blocked ? (
                            <Tag tone="refusal">blocked</Tag>
                          ) : i.kyc ? (
                            <Tag tone="success">kyc</Tag>
                          ) : (
                            <Tag tone="warning">no kyc</Tag>
                          )}
                        </td>
                        <td className="w-28 px-6 py-3.5">
                          <div className="h-1.5 w-full bg-foreground/10">
                            <div
                              className={
                                "h-full transition-[width] duration-500 ease-out " +
                                (hot ? "bg-refusal" : "bg-success")
                              }
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                        <td
                          className={
                            "px-6 py-3.5 text-right " + (hot ? "text-refusal" : "text-foreground")
                          }
                        >
                          {formatBps(i.bps)}
                        </td>
                        <td className="px-6 py-3.5 text-right text-foreground">
                          {formatBond(i.balance)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Pane>
          </div>

          <div className="flex flex-col gap-6 xl:col-span-7">
            <Pane
              title="Order book"
              right={
                <Mono className="text-[12px] text-success">
                  clearing ${fromQ96(clearingQ96).display}
                </Mono>
              }
            >
              <table className="w-full border-collapse font-mono text-[13px] tabular-nums">
                <Head cols={["price", "depth", "size", "filled"]} align={[1, 0, 1, 1]} />
                <tbody>
                  {book.map((b) => {
                    const atClearing = b.priceCents === state.clearingCents;
                    return (
                      <tr
                        key={b.id}
                        title={`priceQ96 ${toQ96(b.priceCents).toString()}`}
                        className={
                          "cursor-crosshair border-b border-border transition-colors last:border-0 hover:bg-accent " +
                          (atClearing ? "!border-y !border-success" : "")
                        }
                      >
                        <td
                          className={
                            "px-6 py-3.5 text-right " +
                            (atClearing ? "text-success" : "text-foreground")
                          }
                        >
                          ${formatCents(b.priceCents)}
                        </td>
                        <td className="w-[38%] px-3 py-3.5">
                          <div
                            className={"h-3 " + (atClearing ? "bg-success/60" : "bg-foreground/15")}
                            style={{ width: `${(Number(b.amount) / peak) * 100}%` }}
                          />
                        </td>
                        <td className="px-6 py-3.5 text-right text-foreground">
                          {formatBond(b.amount)}
                        </td>
                        <td className="px-6 py-3.5 text-right text-muted-foreground">
                          {formatBond(b.filled)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Pane>

            <Pane title="Bids and settlement">
              <table className="w-full border-collapse font-mono text-[13px] tabular-nums">
                <Head
                  cols={["#", "beneficiary", "size", "state", "action"]}
                  align={[0, 0, 1, 0, 1]}
                />
                <tbody>
                  {state.bids.map((b) => {
                    const name = BID_STATES[b.state].name;
                    const acts = actionsFor(b.state);
                    return (
                      <tr
                        key={b.id}
                        className="cursor-crosshair border-b border-border transition-colors last:border-0 hover:bg-accent"
                      >
                        <td className="px-6 py-3.5 text-disabled-foreground">{b.id}</td>
                        <td className="py-3.5">
                          <AddressCell address={b.beneficiary} href={hashscan(b.beneficiary)} />
                        </td>
                        <td className="px-6 py-3.5 text-right text-foreground">
                          {formatBond(b.amount)}
                        </td>
                        <td className="px-6 py-3.5">
                          <Tag tone={STATE_TONE[name]}>{name}</Tag>
                          {b.state === 4 && b.holdExpiresAt !== undefined && (
                            <span className="mt-1 block text-[11px] text-warning">
                              hold {b.holdExpiresAt} blk
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-right">
                          {acts.length === 0 ? (
                            <span className="text-[11px] uppercase tracking-[0.12em] text-disabled-foreground">
                              terminal
                            </span>
                          ) : (
                            <span className="flex justify-end gap-4">
                              {acts.map((action) => (
                                <TxAction
                                  key={action}
                                  label={ACTION_LABELS[action]}
                                  variant="verb"
                                  destructive={action === "exit"}
                                  disabledReason={
                                    !roles.isConnected ? "Connect a wallet to sign." : undefined
                                  }
                                  write={async () => {
                                    let hash: string;
                                    if (action === "exit") {
                                      hash = await actions.exitBid(b.id);
                                    } else if (action === "settle") {
                                      hash = await actions.settle(b.id);
                                    } else {
                                      hash = await actions.executeHold(
                                        b.id,
                                        b.beneficiary,
                                        b.filled as bigint,
                                      );
                                    }
                                    toast.success(`${ACTION_LABELS[action]} / bid ${b.id}`);
                                    return hash;
                                  }}
                                />
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Pane>

            <Pane
              title="Refusal ledger"
              right={
                <Mono className="text-[11px] text-disabled-foreground">hover a row to decode</Mono>
              }
            >
              {state.refusals.length === 0 ? (
                <EmptyState
                  title="No refusals yet"
                  body="When compliance stops an order, the decoded reason and its transaction land here."
                />
              ) : (
                state.refusals.map((r) => <RefusalRow key={r.id} refusal={r} />)
              )}
            </Pane>
          </div>
        </div>
      </div>
    </Shell>
  );
}

/**
 * Hovering opens a borderless inline accordion. The 0fr/1fr grid trick
 * animates to the content's own height without measuring it in JS.
 */
function RefusalRow({
  refusal: r,
}: {
  refusal: {
    id: number;
    beneficiary: string;
    priceCents: bigint;
    amount: import("@/lib/units").RawBond;
    error: AppError;
    block: number;
    tx: string;
  };
}) {
  return (
    <div className="group cursor-crosshair border-b border-border px-6 py-4 transition-colors last:border-0 hover:bg-accent">
      <div className="flex items-center gap-5">
        <div className="w-52 shrink-0">
          <AddressCell address={r.beneficiary} />
        </div>
        <Tag tone={SEVERITY_TONE[r.error.severity]}>{r.error.name}</Tag>
        <Mono className="text-[11px] text-disabled-foreground">{r.error.selector}</Mono>
        <div className="ml-auto flex shrink-0 items-baseline gap-6 font-mono text-[13px] tabular-nums">
          <span className="text-foreground">{formatBond(r.amount)}</span>
          <span className="text-muted-foreground">${formatCents(r.priceCents)}</span>
          <a
            href={hashscanTx(r.tx)}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {formatInt(r.block)}
          </a>
        </div>
      </div>
      <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out group-hover:grid-rows-[1fr]">
        <div className="overflow-hidden">
          <p className="pt-2.5 font-mono text-[12.5px] leading-relaxed text-foreground/80">
            {r.error.sentence}
          </p>
          {r.error.hint && (
            <p className="font-mono text-[12.5px] leading-relaxed text-muted-foreground">
              {r.error.hint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Head({ cols, align = [] }: { cols: string[]; align?: number[] }) {
  return (
    <thead>
      <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {cols.map((c, i) => (
          <th key={c} className={"px-6 py-3 font-normal " + (align[i] === 1 ? "text-right" : "")}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function Line({ k, v, bad = false }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="flex gap-4">
      <span className="w-32 shrink-0 text-disabled-foreground">{k}</span>
      <span className={bad ? "truncate text-refusal" : "truncate text-foreground/80"}>{v}</span>
    </div>
  );
}
