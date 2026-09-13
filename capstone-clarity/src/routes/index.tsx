import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { HeroStage } from "@/components/HeroStage";
import { MorphingText } from "@/components/ui/morphing-text";
import { AddressCell, Mono, Tick, hashscan } from "@/components/kit";
import { useChain } from "@/lib/chain-context";
import { formatBps, formatCents, formatInt } from "@/lib/units";

const TITLE = "Cap Table - compliant bond issuance on Hedera";
const DESC =
  "A single-auction venue for tokenised bonds. Identity claims and concentration caps are simulated before you sign.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
    ],
  }),
  component: Overview,
});

/**
 * Every entry is a complete sentence that sets on one line at the headline
 * size, so the slot can be exactly one line tall. Sizing the slot for a
 * wrapping string would leave a dead band under every other line in the cycle,
 * and splitting a sentence across two entries reads as two broken fragments.
 */
const HEADLINE_CYCLE = [
  "Every refusal has a reason.",
  "Identity-gated bidding.",
  "Cleared on chain.",
] as const;

function Overview() {
  const { state } = useChain();
  const d = state.deployment;

  const contracts = [
    { label: "bond", address: d.bond },
    { label: "auction", address: d.auction },
    { label: "compliance", address: d.compliance },
    { label: "oracle", address: d.oracle },
  ] as const;

  return (
    <Shell fill>
      {/*
        No divider. The canvas paints the same black as the page, so the two
        halves meet on an invisible seam and the composition reads as one field
        with the stone floating in it rather than as two boxes.
      */}
      <div className="grid h-full grid-cols-1 lg:grid-cols-12">
        <section className="z-10 col-span-1 flex min-h-0 flex-col justify-center px-10 lg:col-span-6 xl:pl-16 xl:pr-14 2xl:pl-24">
          <div className="flex items-center gap-4 font-mono text-[12px]">
            <span className="flex items-center gap-2 border border-success/20 bg-success/10 px-2.5 py-1 uppercase tracking-[0.12em] text-success">
              <span className="pulse-dot size-1.5 bg-current" />
              auction {state.phase.toLowerCase()}
            </span>
            <span className="text-muted-foreground">
              ends in <Tick value={formatInt(state.endsInBlocks)} className="text-foreground" />{" "}
              blocks
            </span>
          </div>

          <h1 className="mt-9">
            <span className="sr-only">Every refusal has a reason.</span>
            <MorphingText
              texts={[...HEADLINE_CYCLE]}
              className="mx-0 h-[44px] max-w-none text-left font-display text-[34px] font-semibold leading-none tracking-tight xl:h-[56px] xl:text-[44px]"
            />
          </h1>

          <p className="mt-7 max-w-lg font-sans text-[15px] leading-[1.7] text-muted-foreground">
            {DESC} A rejected bid names the rule that stopped it, in plain English, with the
            selector that produced it.
          </p>

          <div className="mt-10 flex gap-4">
            <Link
              to="/venue"
              className="bg-foreground px-7 py-3.5 font-mono text-[12px] uppercase tracking-[0.16em] text-primary-foreground transition-colors hover:bg-foreground/85"
            >
              Enter venue
            </Link>
            <Link
              to="/console"
              className="border border-border bg-transparent px-7 py-3.5 font-mono text-[12px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
            >
              Operator console
            </Link>
          </div>

          <dl className="mt-16 grid max-w-xl grid-cols-2 gap-x-12 gap-y-2.5 border-t border-border pt-7">
            {contracts.map((c) => (
              <div key={c.label} className="flex items-center justify-between gap-4">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-disabled-foreground">
                  {c.label}
                </dt>
                <dd>
                  <AddressCell address={c.address} href={hashscan(c.address)} />
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="relative col-span-1 min-h-0 bg-background lg:col-span-6">
          <HeroStage headline="CAP TABLE" />
          <LiveTicker />
        </section>
      </div>
    </Shell>
  );
}

/**
 * Floating terminal panel over the canvas. A flat monospace data list: the
 * stats card it replaces carried a sparkline, coin rows and dominance bars,
 * none of which describe a single-auction venue.
 */
function LiveTicker() {
  const { state } = useChain();
  const holders = state.investors.filter((i) => i.balance > 0n).length;

  const rows = [
    { k: "clearing", v: `$${formatCents(state.clearingCents)}`, tone: "text-success", live: true },
    { k: "nav", v: `$${formatCents(state.navCents)}`, tone: "text-foreground", live: true },
    { k: "holders", v: `${holders}/${state.maxInvestors}`, tone: "text-foreground", live: false },
    { k: "cap", v: formatBps(state.maxOwnershipBps), tone: "text-foreground", live: false },
    { k: "refusals", v: formatInt(state.refusals.length), tone: "text-refusal", live: true },
  ] as const;

  return (
    <div className="pointer-events-none absolute bottom-12 right-12 hidden w-72 border border-border bg-background/80 px-5 py-4 font-mono text-[13px] backdrop-blur-md lg:block">
      <div className="mb-3 flex items-center gap-2 border-b border-border pb-3">
        <span className="pulse-dot size-1.5 bg-success" />
        <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          live venue
        </span>
        <Mono className="ml-auto text-[11px] text-disabled-foreground">
          blk {formatInt(state.lastBlock)}
        </Mono>
      </div>
      {rows.map((r) => (
        <div key={r.k} className="flex items-baseline justify-between py-1.5">
          <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            {r.k}
          </span>
          {r.live ? <Tick value={r.v} className={r.tone} /> : <Mono className={r.tone}>{r.v}</Mono>}
        </div>
      ))}
    </div>
  );
}
