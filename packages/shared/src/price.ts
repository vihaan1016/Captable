/**
 * Q96 price conversion and numeric conventions (FR-17, §4.5).
 *
 * CCA prices are Q96 fixed-point: priceQ96 = price × 2^96, where price is
 * currency-wei per token-unit. The bond has 2 decimals, so one bond unit is
 * 100 raw tokens; par 100.00 is therefore 10_000 raw units of price basis.
 */

export const Q96 = 2n ** 96n;

/**
 * Convert a price expressed in currency-wei per bond-unit (raw; 100 raw = 1
 * bond) to Q96.
 */
export function toQ96(pricePerBondRaw: bigint): bigint {
  return pricePerBondRaw * Q96;
}

/**
 * Convert a Q96 price back to currency-wei per bond-unit (floor).
 */
export function fromQ96(priceQ96: bigint): bigint {
  return priceQ96 / Q96;
}

/**
 * Round-trip a Q96 price through the raw representation and back.
 */
export function roundTripQ96(pricePerBondRaw: bigint): bigint {
  return fromQ96(toQ96(pricePerBondRaw));
}

/**
 * Display a Q96 price as a two-decimal bond price string (e.g. "101.25").
 *
 * priceQ96 / Q96 is currency-wei per 100 raw tokens (i.e. per bond unit in
 * basis points); dividing by 100 yields whole bond units with 2dp.
 */
export function displayQ96(priceQ96: bigint): string {
  const raw = fromQ96(priceQ96);
  const whole = raw / 100n;
  const frac = raw % 100n;
  return `${whole}.${frac.toString().padStart(2, '0')}`;
}

/**
 * Ownership share as basis points of totalSupply, integer division, floor.
 */
export function ownershipBps(balance: bigint, totalSupply: bigint): bigint {
  if (totalSupply === 0n) return 0n;
  return (balance * 10_000n) / totalSupply;
}
