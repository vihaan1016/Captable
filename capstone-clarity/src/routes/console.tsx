import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Shell } from "@/components/Shell";
import { AddressCell, InlineCode, Mono, Tag, hashscan } from "@/components/kit";
import { Slider } from "@/components/ui/slider";
import { TxAction } from "@/components/tx/TxAction";
import { useChain } from "@/lib/chain-context";
import { asBps, formatBond, formatBps, formatCents, formatHbar, isinCheckDigit } from "@/lib/units";

const TITLE = "Operator console - bond lifecycle controls | Cap Table";
const DESC =
  "Wire compliance, set holder and concentration rules, manage identity claims, open the auction and run coupon operations from one gated console.";

export const Route = createFileRoute("/console")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
    ],
  }),
  component: Console,
});

/**
 * Role gating never hides a control. It disables the interaction and names the
 * role that would unlock it, so an operator can audit the surface before they
 * hold the key for it.
 */
function useRoleGate() {
  const { roles } = useChain();
  return {
    reason: roles.isIssuer ? undefined : ("Requires ISSUER role." as const),
    isIssuer: roles.isIssuer,
  };
}

const STAGES = [
  { id: "deployment", index: "01", label: "Deployment" },
  { id: "rules", index: "02", label: "Rules" },
  { id: "investors", index: "03", label: "Investors" },
  { id: "isin", index: "04", label: "ISIN" },
  { id: "auction", index: "05", label: "Auction" },
  { id: "ops", index: "06", label: "Ops" },
] as const;

type StageId = (typeof STAGES)[number]["id"];

/**
 * Marks the stage currently under the header rail.
 *
 * Computed from scroll position rather than from IntersectionObserver: the
 * observer approach picks the topmost intersecting section, so the final stage
 * can never win once the page bottoms out and the stage above it is still on
 * screen. Pinning the last stage at the bottom of the document is the only way
 * `06 OPS` is ever reachable.
 */
function useActiveStage() {
  const [active, setActive] = useState<StageId>(STAGES[0].id);

  useEffect(() => {
    const read = () => {
      const trigger = window.innerHeight * 0.3;
      const doc = document.documentElement;
      const atBottom = window.scrollY + window.innerHeight >= doc.scrollHeight - 4;
      if (atBottom) {
        setActive(STAGES[STAGES.length - 1]!.id);
        return;
      }
      let current: StageId = STAGES[0]!.id;
      for (const stage of STAGES) {
        const el = document.getElementById(stage.id);
        if (el && el.getBoundingClientRect().top <= trigger) current = stage.id;
      }
      setActive(current);
    };

    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, []);

  return active;
}

function StageRail() {
  const active = useActiveStage();
  return (
    <nav className="sticky top-20 hidden border-l border-border lg:block">
      {STAGES.map((s) => {
        const on = s.id === active;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={
              "-ml-px flex items-baseline gap-3 border-l py-1.5 pl-4 font-mono text-[11px] transition-colors " +
              (on
                ? "border-foreground text-foreground"
                : "border-transparent text-disabled-foreground hover:text-muted-foreground")
            }
          >
            <span className="tabular-nums">{s.index}</span>
            <span className="uppercase tracking-[0.14em]">{s.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

function Console() {
  const { roles, addresses } = useChain();

  return (
    <Shell gate>
      <div className="mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-x-12 px-6 pb-24 lg:grid-cols-[200px_minmax(0,800px)]">
        <div className="hidden lg:block">
          <StageRail />
        </div>
        <div>
          <header className="py-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-disabled-foreground">
              operator console
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">
              Six ordered stages.
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Each stage simulates before it signs, and refuses with a plain-English reason instead
              of a bare selector. Controls stay visible without the role, disabled and labelled.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Tag tone={roles.isIssuer ? "success" : "neutral"} dot={roles.isIssuer}>
                {roles.isIssuer ? `${roles.roles[0]} key connected` : "read only"}
              </Tag>
              {!roles.isIssuer && (
                <span className="font-mono text-[11px] text-disabled-foreground">
                  connect {addresses.seller.slice(0, 10)}... (SELLER) to enable writes
                </span>
              )}
            </div>
          </header>

          <WiringStage />
          <RulesStage />
          <IdentityStage />
          <IsinStage />
          <OracleStage />
          <CouponStage />
        </div>
      </div>
    </Shell>
  );
}

/** A raw bento block. Hairline rule on top, no accordion, no card chrome. */
function Stage({
  id,
  index,
  title,
  body,
  children,
}: {
  id: string;
  index: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-border py-8">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground">
        // {index} {title}
      </h2>
      <p className="mt-2 max-w-xl font-mono text-[11px] leading-relaxed text-muted-foreground">
        {body}
      </p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function RoleNote() {
  const { isIssuer } = useRoleGate();
  if (isIssuer) return null;
  return (
    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-disabled-foreground">
      Requires ISSUER role
    </p>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-[11px]">{value}</span>
    </div>
  );
}

const INPUT =
  "w-full border-b border-border bg-transparent py-2 font-mono text-[12px] outline-none transition-colors placeholder:text-disabled-foreground focus:border-foreground";

/* ---------------------------------------------------------------- 01 */

function WiringStage() {
  const { state } = useChain();
  const d = state.deployment;
  const items = [
    { label: "Compliance attached", ok: state.complianceAttached },
    { label: "SSI manager granted", ok: state.ssiManagerGranted },
    { label: "Issuer listed", ok: state.issuerListed },
    { label: "KYC probe verified", ok: state.kycProbeVerified },
    { label: "Auction created", ok: state.auctionCreated },
    { label: "Bytecode verified", ok: d.verified },
  ];
  const ready = items.filter((i) => i.ok).length;

  return (
    <Stage
      id="deployment"
      index="01"
      title="Deployment"
      body="Preconditions the venue checks before it will accept a single bid."
    >
      <div>
        <div className="flex items-center gap-3 border-b border-border pb-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-disabled-foreground">
            preconditions
          </span>
          <Mono className="ml-auto text-[11px] text-success">
            {ready}/{items.length} ready
          </Mono>
        </div>
        <ul>
          {items.map((i) => (
            <li
              key={i.label}
              className="flex cursor-crosshair items-center gap-3 border-b border-border py-2 transition-colors last:border-0 hover:bg-accent"
            >
              <span
                className={"size-1.5 shrink-0 " + (i.ok ? "bg-success" : "bg-warning")}
                aria-hidden
              />
              <span className="font-mono text-[11px]">{i.label}</span>
              <Mono className="ml-auto text-[10px] uppercase tracking-[0.14em] text-disabled-foreground">
                {i.ok ? "ready" : "missing"}
              </Mono>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5">
        {(
          [
            ["bond", d.bond],
            ["compliance", d.compliance],
            ["auction", d.auction],
            ["router", d.router],
            ["hook", d.hook],
            ["oracle", d.oracle],
          ] as const
        ).map(([k, v]) => (
          <Row key={k} label={k} value={<AddressCell address={v} href={hashscan(v)} />} />
        ))}
      </div>
    </Stage>
  );
}

/* ---------------------------------------------------------------- 02 */

function RulesStage() {
  const { state, actions } = useChain();
  const gate = useRoleGate();
  const [maxInvestors, setMaxInvestors] = useState(state.maxInvestors);
  const [maxBps, setMaxBps] = useState(state.maxOwnershipBps as number);

  const holders = state.investors.filter((i) => i.balance > 0n).length;
  const topBps = Math.max(0, ...state.investors.map((i) => i.bps as number));
  const shrinkBelowHolders = maxInvestors < holders;
  const shrinkBelowTop = maxBps < topBps;
  const blocked = shrinkBelowHolders || shrinkBelowTop;

  return (
    <Stage
      id="rules"
      index="02"
      title="Rules"
      body="The two caps the hook reads live on every bid — commit a lower maxInvestors and the very next new-holder bid is refused by the register projection. Lowering a cap below current reality is refused, not silently applied."
    >
      <div className="space-y-6">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-disabled-foreground">
              maxInvestors
            </span>
            <Mono className="text-[13px] tabular-nums">{maxInvestors}</Mono>
          </div>
          <Slider
            className="mt-3"
            min={1}
            max={24}
            step={1}
            value={[maxInvestors]}
            onValueChange={([v]) => setMaxInvestors(v ?? 1)}
            aria-label="Maximum investors"
          />
          <p className="mt-2 font-mono text-[11px] text-disabled-foreground">
            {holders} holders of record / cap {state.maxInvestors} on chain
          </p>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-disabled-foreground">
              maxOwnershipBps
            </span>
            <Mono className="text-[13px] tabular-nums">
              {maxBps} / {formatBps(asBps(maxBps))}
            </Mono>
          </div>
          <Slider
            className="mt-3"
            min={100}
            max={10000}
            step={25}
            value={[maxBps]}
            onValueChange={([v]) => setMaxBps(v ?? 100)}
            aria-label="Maximum ownership in basis points"
          />
          <p className="mt-2 font-mono text-[11px] text-disabled-foreground">
            largest holder {formatBps(asBps(topBps))} / cap {formatBps(state.maxOwnershipBps)} on
            chain
          </p>
        </div>

        <div className="bg-terminal p-3 font-mono text-[11px] leading-[1.7]">
          {shrinkBelowHolders ? (
            <span className="text-refusal">
              {`> refused - ${holders} holders already exist; a cap of ${maxInvestors} would strand ${holders - maxInvestors}.`}
            </span>
          ) : shrinkBelowTop ? (
            <span className="text-refusal">
              {`> refused - largest holder sits at ${formatBps(asBps(topBps))}, above the proposed ${formatBps(asBps(maxBps))}.`}
            </span>
          ) : (
            <span className="text-success">
              {`> ok - investors ${state.maxInvestors} -> ${maxInvestors}, ownership ${formatBps(state.maxOwnershipBps)} -> ${formatBps(asBps(maxBps))}.`}
            </span>
          )}
        </div>

        <div>
          <TxAction
            label="Commit rules"
            pendingLabel="Committing"
            disabledReason={
              gate.reason ??
              (shrinkBelowHolders
                ? "Cap below existing holder count"
                : shrinkBelowTop
                  ? "Cap below largest holder"
                  : undefined)
            }
            simulate={async () => null}
            write={async () => {
              const hash = await actions.setRules(maxInvestors, maxBps);
              toast.success("Compliance rules updated");
              return hash;
            }}
          />
          <RoleNote />
        </div>
      </div>
    </Stage>
  );
}

/* ---------------------------------------------------------------- 03 */

function IdentityStage() {
  const { state, actions } = useChain();
  const gate = useRoleGate();
  const [draft, setDraft] = useState("");

  const parsed = draft
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const isAddress = (a: string) => /^0x[a-fA-F0-9]{40}$/.test(a);
  const valid = parsed.filter(isAddress);
  const malformed = parsed.filter((a) => !isAddress(a));

  return (
    <Stage
      id="investors"
      index="03"
      title="Investors"
      body="Grant KYC in batch, revoke a claim, or block an address. Blocking is immediate and refuses future transfers with a named reason."
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        placeholder="0xabc... 0xdef...   (whitespace or comma separated)"
        className={INPUT + " resize-none"}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Tag tone={valid.length ? "success" : "neutral"}>{valid.length} valid</Tag>
        {malformed.length > 0 && <Tag tone="refusal">{malformed.length} malformed</Tag>}
        <span className="ml-auto">
          <TxAction
            label={`Grant KYC${valid.length ? ` x${valid.length}` : ""}`}
            pendingLabel="Granting"
            disabledReason={
              gate.reason ??
              (valid.length === 0
                ? "Paste at least one valid address"
                : malformed.length > 0
                  ? "Remove malformed addresses first"
                  : undefined)
            }
            simulate={async () => null}
            write={async () => {
              let last = "";
              for (const addr of valid) {
                last = await actions.grantKyc(addr);
              }
              toast.success(`KYC granted to ${valid.length} address(es)`);
              setDraft("");
              return last;
            }}
          />
        </span>
      </div>
      <RoleNote />

      <div className="mt-6">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.14em] text-disabled-foreground">
              <th className="py-2 pr-3 font-normal">holder</th>
              <th className="px-3 py-2 text-right font-normal">balance</th>
              <th className="px-3 py-2 text-right font-normal">share</th>
              <th className="px-3 py-2 font-normal">claim</th>
              <th className="px-3 py-2 text-right font-normal">actions</th>
            </tr>
          </thead>
          <tbody>
            {state.investors.map((i) => (
              <tr
                key={i.address}
                className="cursor-crosshair border-b border-border transition-colors last:border-0 hover:bg-accent"
              >
                <td className="py-2 pr-3">
                  <AddressCell address={i.address} href={hashscan(i.address)} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Mono className="text-[11px]">{formatBond(i.balance)}</Mono>
                </td>
                <td className="px-3 py-2 text-right">
                  <Mono className="text-[11px]">{formatBps(i.bps)}</Mono>
                </td>
                <td className="px-3 py-2">
                  {i.blocked ? (
                    <Tag tone="refusal">blocked</Tag>
                  ) : i.kyc ? (
                    <Tag tone="success">verified</Tag>
                  ) : (
                    <Tag tone="pending">unverified</Tag>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1.5">
                    {i.kyc && (
                      <TxAction
                        label="Revoke"
                        variant="verb"
                        destructive
                        disabledReason={gate.reason}
                        write={async () => {
                          const hash = await actions.revokeKyc(i.address);
                          toast("KYC claim revoked");
                          return hash;
                        }}
                      />
                    )}
                    <TxAction
                      label={i.blocked ? "Unblock" : "Block"}
                      variant="verb"
                      destructive={!i.blocked}
                      disabledReason={gate.reason}
                      write={async () => {
                        const hash = await actions.setBlocked(i.address, !i.blocked);
                        toast(i.blocked ? "Address unblocked" : "Address blocked");
                        return hash;
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Stage>
  );
}

/* ---------------------------------------------------------------- 04 */

function IsinStage() {
  const [country, setCountry] = useState("US");
  const [nsin, setNsin] = useState("0378331005");

  const body = `${country}${nsin}`.replace(/[^A-Z0-9]/g, "");
  const check = isinCheckDigit(body);
  const isin = check ? `${body}${check}` : null;

  return (
    <Stage
      id="isin"
      index="04"
      title="ISIN"
      body="The check digit is computed locally with the ISO 6166 Luhn variant, so a malformed identifier never reaches the token metadata."
    >
      <div className="grid gap-4 sm:grid-cols-[110px_minmax(0,1fr)]">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-disabled-foreground">
            country
          </span>
          <input
            value={country}
            maxLength={2}
            onChange={(e) => setCountry(e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase())}
            className={INPUT + " mt-2 uppercase"}
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-disabled-foreground">
            nsin (9 chars)
          </span>
          <input
            value={nsin}
            maxLength={9}
            onChange={(e) => setNsin(e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())}
            className={INPUT + " mt-2 uppercase"}
          />
        </label>
      </div>

      <div className="mt-4 bg-terminal p-3 font-mono text-[11px] leading-[1.7]">
        <div className="flex gap-3">
          <span className="w-24 shrink-0 text-disabled-foreground">body</span>
          <span className="text-foreground/85">{body || "-"}</span>
        </div>
        <div className="flex gap-3">
          <span className="w-24 shrink-0 text-disabled-foreground">length</span>
          <span className={body.length === 11 ? "text-foreground/85" : "text-warning"}>
            {body.length} / 11
          </span>
        </div>
        <div className="mt-2 border-t border-border pt-2">
          {isin ? (
            <span className="text-success">{`> ${isin}  check digit ${check}`}</span>
          ) : (
            <span className="text-warning">{"> need exactly 11 characters (2 + 9)"}</span>
          )}
        </div>
      </div>
    </Stage>
  );
}

/* ---------------------------------------------------------------- 05 */

function OracleStage() {
  const { state, actions } = useChain();
  const gate = useRoleGate();
  const [nav, setNav] = useState(formatCents(state.navCents).replace(/,/g, ""));

  const cents = (() => {
    const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(nav.trim());
    if (!m) return null;
    return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "0").padEnd(2, "0"));
  })();
  const stale = state.navUpdatedSecondsAgo > state.maxStalenessSeconds;

  return (
    <Stage
      id="auction"
      index="05"
      title="Auction"
      body="Bids are priced against NAV. Past the staleness window the hook skips the band check rather than halting bids — push NAV here within the hour before filming the band beat."
    >
      <div>
        <Row
          label="Phase"
          value={
            <Tag tone="success" dot>
              {state.phase}
            </Tag>
          }
        />
        <Row label="Current NAV" value={<Mono>${formatCents(state.navCents)}</Mono>} />
        <Row
          label="Band"
          value={
            <Mono>
              ±{state.bandBps / 100}% ($
              {formatCents(state.navBandLoCents)}–${formatCents(state.navBandHiCents)})
            </Mono>
          }
        />
        <Row
          label="Last update"
          value={
            <span className="flex items-center gap-2">
              <Mono>{state.navUpdatedSecondsAgo}s ago</Mono>
              <Tag tone={stale ? "refusal" : "success"}>{stale ? "stale — band bypassed" : "fresh"}</Tag>
            </span>
          }
        />
        <Row label="Staleness window" value={<Mono>{state.maxStalenessSeconds}s</Mono>} />
        <Row label="Tick spacing" value={<Mono>${formatCents(state.tickCents)}</Mono>} />
      </div>

      <label className="mt-5 block max-w-[240px]">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-disabled-foreground">
          push nav (USD)
        </span>
        <input
          value={nav}
          onChange={(e) => setNav(e.target.value)}
          inputMode="decimal"
          className={INPUT + " mt-2 tabular-nums"}
        />
      </label>

      <div className="mt-4">
        <TxAction
          label="Push NAV"
          pendingLabel="Publishing"
          disabledReason={
            gate.reason ??
            (cents === null || cents <= 0n ? "Enter an amount like 1002.50" : undefined)
          }
          simulate={async () => null}
          write={async () => {
            const hash = await actions.setNav(cents!);
            toast.success("NAV published");
            return hash;
          }}
        />
        <RoleNote />
      </div>
    </Stage>
  );
}

/* ---------------------------------------------------------------- 06 */

function CouponStage() {
  const { state, actions } = useChain();
  const gate = useRoleGate();
  const funded = state.reserveTinybar >= state.requiredTinybar;
  const coverage = Math.min(
    100,
    Number((state.reserveTinybar * 100n) / (state.requiredTinybar || 1n)),
  );

  return (
    <Stage
      id="ops"
      index="06"
      title="Ops"
      body="A coupon can only be scheduled once the reserve covers the obligation, and only distributed once scheduled."
    >
      <div>
        <Row
          label="Reserve"
          value={<Mono>{formatHbar(state.reserveTinybar as never)} HBAR</Mono>}
        />
        <Row
          label="Required"
          value={<Mono>{formatHbar(state.requiredTinybar as never)} HBAR</Mono>}
        />
        <Row
          label="Coverage"
          value={
            <span className="flex items-center gap-3">
              <Mono>{coverage}%</Mono>
              <Tag tone={funded ? "success" : "pending"}>{funded ? "covered" : "short"}</Tag>
            </span>
          }
        />
      </div>

      <div className="mt-4 h-1 w-full bg-foreground/10">
        <div
          className={
            "h-full transition-[width] duration-500 ease-out " +
            (funded ? "bg-success" : "bg-warning")
          }
          style={{ width: `${coverage}%` }}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-start gap-3">
        <TxAction
          label="Fund reserve"
          pendingLabel="Funding"
          variant="ghost"
          disabledReason={gate.reason}
          write={async () => {
            const hash = await actions.fundReserve(250_000n * 10n ** 18n);
            toast.success("Reserve topped up");
            return hash;
          }}
        />
        <TxAction
          label="Schedule coupon"
          pendingLabel="Scheduling"
          variant="ghost"
          disabledReason={
            gate.reason ??
            (!funded
              ? "Reserve does not cover the obligation"
              : state.couponScheduled
                ? "Already scheduled"
                : undefined)
          }
          simulate={async () => null}
          write={async () => {
            const now = BigInt(Math.floor(Date.now() / 1000));
            const hash = await actions.setCoupon({
              recordDate: now,
              executionDate: now + 31_536_000n,
              startDate: now,
              endDate: now + 31_536_000n,
              fixingDate: now,
              rate: 500n, // 5.00% with rateDecimals 2
              rateDecimals: 2,
              rateStatus: 1,
            });
            toast.success("Coupon scheduled");
            return hash;
          }}
        />
      </div>
      <p className="mt-3 max-w-xl font-mono text-[11px] leading-relaxed text-muted-foreground">
        Coupon distribution is executed by the ATS coupon facet at the execution date, not as a
        browser action, so there is no "distribute" button here.
      </p>
      <RoleNote />

      <div className="mt-8 border-t border-border pt-6">
        <p className="mb-3 max-w-xl font-mono text-[11px] leading-relaxed text-muted-foreground">
          Settlement moves every cleared bid to <InlineCode>SETTLED</InlineCode> in one batch. It is
          refused while the auction is still taking orders.
        </p>
        <TxAction
          label="Settle all cleared bids"
          pendingLabel="Settling"
          destructive
          disabledReason={
            gate.reason ?? (state.phase === "OPEN" ? "Auction is still open" : undefined)
          }
          simulate={async () => null}
          write={async () => {
            let last = "";
            for (const b of state.bids.filter((x) => x.state === 3 || x.state === 6)) {
              last = await actions.settle(b.id);
            }
            toast.success("Settlement batch submitted");
            return last;
          }}
        />
        <RoleNote />
      </div>
    </Stage>
  );
}
