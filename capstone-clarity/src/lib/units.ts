/**
 * Single source of truth for numeric conversions.
 * No monetary arithmetic may live outside this module.
 */

export type Q96 = bigint & { readonly __brand: "Q96" };
export type Bps = number & { readonly __brand: "Bps" };
export type RawBond = bigint & { readonly __brand: "RawBond" }; // 2 decimals
export type Tinybar = bigint & { readonly __brand: "Tinybar" }; // 18dp

const Q96_ONE = 1n << 96n;

export const asBps = (n: number) => n as Bps;
export const asRawBond = (n: bigint) => n as RawBond;
export const asTinybar = (n: bigint) => n as Tinybar;

/** cents (2dp) -> Q96 fixed point. Matches PriceQ96.sol: pricePerBondRaw * 2^96. */
export function toQ96(pricePerBondRaw: bigint): Q96 {
  return (pricePerBondRaw * Q96_ONE) as Q96;
}

export function fromQ96(p: Q96): { display: string; cents: bigint; raw: string } {
  const cents = p / Q96_ONE;
  return {
    display: formatCents(cents),
    cents,
    raw: p.toString(),
  };
}

export function snapToTick(p: Q96, tickSpacing: Q96): Q96 {
  if (tickSpacing <= 0n) return p;
  const rem = p % tickSpacing;
  const down = p - rem;
  const up = down + tickSpacing;
  return (rem * 2n >= tickSpacing ? up : down) as Q96;
}

export function formatCents(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${groupDigits(whole.toString())}.${frac}`;
}

export function formatBond(v: RawBond): string {
  return formatCents(v);
}

export function formatHbar(v: Tinybar): string {
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${groupDigits(whole.toString())}.${frac}`;
}

export function formatBps(v: Bps): string {
  return `${(v / 100).toFixed(2)}%`;
}

export function blocksToSeconds(blocks: number): number {
  return blocks * 2; // HIP-415 cadence, 2s/block
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => n.toString().padStart(2, "0")).join(":");
}

export function truncateAddress(addr: string, lead = 6, tail = 4): string {
  if (addr.length <= lead + tail + 2) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

function groupDigits(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** ISO 6166 check digit for a country code + NSIN (11 chars). */
export function isinCheckDigit(body: string): string | null {
  const clean = body.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 11) return null;
  let digits = "";
  for (const ch of clean) {
    digits += /[0-9]/.test(ch) ? ch : (ch.charCodeAt(0) - 55).toString();
  }
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    double = !double;
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * Deterministic integer grouping. `toLocaleString` resolves against the host
 * ICU locale, which differs between the SSR process and the browser and trips
 * a hydration mismatch on block heights.
 */
export function formatInt(n: number | bigint): string {
  return groupDigits(n.toString());
}
