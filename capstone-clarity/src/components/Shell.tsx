import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useConnect, useDisconnect, useAccount } from "wagmi";
import { AddressCell, DesktopOnlyGate, Tag, Tick } from "@/components/kit";
import { useChain } from "@/lib/chain-context";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/units";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/venue", label: "Venue" },
  { to: "/console", label: "Console" },
] as const;

/**
 * The global rail. 48px, one hairline, and no surface of its own. It carries
 * identity, route and wallet only: venue state gets its own strip underneath,
 * because sharing one 48px row squeezes both into illegibility.
 */
export function Shell({
  children,
  fill = false,
  gate = false,
}: {
  children: ReactNode;
  fill?: boolean;
  gate?: boolean;
}) {
  const { state, roles } = useChain();
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <div
      className={cn(
        "flex flex-col bg-background",
        fill ? "h-[100dvh] overflow-hidden" : "min-h-[100dvh]",
      )}
    >
      {gate && <DesktopOnlyGate />}

      <header className="sticky top-0 z-30 flex h-12 shrink-0 items-stretch border-b border-border bg-background">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 pl-4 pr-5">
          <span className="size-2.5 border border-foreground/70" aria-hidden />
          <span className="font-mono text-[12.5px] uppercase tracking-[0.12em]">Cap Table</span>
        </Link>

        <nav className="flex shrink-0 items-stretch border-l border-border">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="flex items-center border-r border-border px-5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground data-[status=active]:text-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="flex shrink-0 items-center gap-3 border-l border-border px-4">
          <span className="hidden items-center gap-2 font-mono text-[11.5px] text-muted-foreground xl:flex">
            <span className="pulse-dot size-1.5 bg-success" />
            <Tick value={formatInt(state.lastBlock)} className="text-[11.5px] text-foreground/80" />
            <span className="text-disabled-foreground">
              lag {state.deployment.indexerLagBlocks}
            </span>
          </span>

          {isConnected ? (
            <>
              <Tag tone="primary">{roles.roles[0]}</Tag>
              <AddressCell address={address!} />
              <button
                type="button"
                onClick={() => disconnect()}
                className="border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => connect({ connector: connectors[0]! })}
              className="bg-foreground px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-primary-foreground transition-colors hover:bg-foreground/85"
            >
              Connect wallet
            </button>
          )}
        </div>
      </header>

      <main className={cn("min-h-0 flex-1", fill && "overflow-hidden")}>{children}</main>

      <footer className="flex h-9 shrink-0 items-center gap-6 overflow-hidden border-t border-border px-6 font-mono text-[11px] uppercase tracking-[0.12em] text-disabled-foreground">
        <span>commit {state.deployment.commit}</span>
        <span className="hidden lg:inline">{state.deployment.rpc}</span>
        <span>hedera testnet / 296</span>
        <span className="hidden xl:inline">
          {state.deployment.verified ? "sources verified" : "unverified"}
        </span>
        <span className="ml-auto shrink-0 normal-case tracking-normal">
          Demo transport. No mainnet value moves through this interface.
        </span>
      </footer>
    </div>
  );
}
