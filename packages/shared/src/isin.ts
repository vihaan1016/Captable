/**
 * ISO 6166 ISIN generation with Luhn check digit.
 *
 * This is the deterministic generator required by FR-1. It produces a
 * 12-character ISIN from a 2-letter uppercase country code and a 9-character
 * alphanumeric (uppercase) NSIN.
 */

const ZERO = '0'.charCodeAt(0);
const NINE = '9'.charCodeAt(0);
const A = 'A'.charCodeAt(0);

function charToCode(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= ZERO && c <= NINE) return c - ZERO;
  if (c >= A && c <= 'Z'.charCodeAt(0)) return c - A + 10;
  throw new Error(`Invalid ISIN character: ${ch}`);
}

/**
 * Compute the Luhn check digit for an 11-character body.
 *
 * The body is expanded: letters become their two-digit ordinal (A=10..Z=35).
 * Digits are indexed from the right starting at 1; every digit at an odd
 * index (the rightmost is 1) is doubled, and doubled values > 9 have 9
 * subtracted.
 */
export function luhnCheckDigit(body: string): number {
  if (body.length !== 11) throw new Error('ISIN body must be 11 characters');

  // Expand to digits, then process from the right.
  const digits: number[] = [];
  for (const ch of body) {
    const code = charToCode(ch);
    if (code >= 10) {
      digits.push(Math.floor(code / 10), code % 10);
    } else {
      digits.push(code);
    }
  }

  let sum = 0;
  // posFromRight 0 => rightmost digit => odd index (1) => doubled
  let posFromRight = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = digits[i];
    if (posFromRight % 2 === 0) {
      const doubled = d * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    } else {
      sum += d;
    }
    posFromRight++;
  }

  return (10 - (sum % 10)) % 10;
}

/**
 * Generate a 12-character ISIN from a country code and NSIN.
 */
export function generateIsin(countryCode: string, nsin: string): string {
  const cc = countryCode.toUpperCase();
  const ns = nsin.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) throw new Error('countryCode must be 2 uppercase letters');
  if (!/^[A-Z0-9]{9}$/.test(ns)) throw new Error('nsin must be 9 alphanumeric uppercase chars');

  const body = cc + ns;
  return body + luhnCheckDigit(body).toString();
}

/**
 * Validate a 12-character ISIN using the Luhn algorithm (independent validator).
 */
export function isValidIsin(isin: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) return false;
  const body = isin.slice(0, 11);
  const check = Number(isin[11]);
  return luhnCheckDigit(body) === check;
}
