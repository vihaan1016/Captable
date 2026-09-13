import { lazy, Suspense, useEffect, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";

const PrismStage = lazy(() =>
  import("@/components/ui/prism-hero").then((m) => ({ default: m.PrismStage })),
);

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/**
 * Static wordmark. Reduced motion means the WebGL bundle is never fetched and
 * no transmission buffer is ever allocated, not merely that the stone holds
 * still, so the fallback has to carry the frame on its own.
 */
function StaticWordmark({ headline }: { headline: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background" aria-hidden>
      <span className="font-display text-[12vw] font-semibold leading-none tracking-tight text-foreground lg:text-[8vw]">
        {headline}
      </span>
    </div>
  );
}

/** Client-only crystal stage. Renders nothing on the server. */
export function HeroStage({ headline = "CAP TABLE" }: { headline?: string }) {
  return (
    <ClientOnly fallback={<div className="absolute inset-0 bg-background" />}>
      <Stage headline={headline} />
    </ClientOnly>
  );
}

function Stage({ headline }: { headline: string }) {
  const reduced = usePrefersReducedMotion();
  if (reduced) return <StaticWordmark headline={headline} />;

  return (
    <Suspense fallback={<StaticWordmark headline={headline} />}>
      <PrismStage headline={headline} dispersion={1.2} tint="#E8E8EA" smoke="#1A1A1A" />
    </Suspense>
  );
}
