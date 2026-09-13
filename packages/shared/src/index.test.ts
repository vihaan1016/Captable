import { describe, it, expect } from 'vitest';
import { generateIsin, isValidIsin, luhnCheckDigit } from './isin.js';
import { toQ96, fromQ96, roundTripQ96, displayQ96, ownershipBps } from './price.js';

describe('isin', () => {
  it('produces the Apple Inc. reference ISIN', () => {
    expect(generateIsin('US', '037833100')).toBe('US0378331005');
  });

  it('round-trips through the independent validator', () => {
    for (const [cc, nsin] of [
      ['US', '037833100'],
      ['GB', '000263494'],
      ['DE', '000555750'],
      ['JP', '343500000'],
    ]) {
      const isin = generateIsin(cc, nsin);
      expect(isValidIsin(isin)).toBe(true);
      expect(isin).toHaveLength(12);
    }
  });

  it('rejects a wrong check digit', () => {
    expect(isValidIsin('US0378331006')).toBe(false);
  });

  it('computes the Luhn digit for a known body', () => {
    expect(luhnCheckDigit('US037833100')).toBe(5);
  });
});

describe('price', () => {
  it('round-trips Q96 exactly', () => {
    for (const raw of [10000n, 10125n, 9999n, 1n, 2n ** 64n]) {
      expect(roundTripQ96(raw)).toBe(raw);
    }
  });

  it('displays 101.25 for par + 1.25%', () => {
    expect(displayQ96(toQ96(10125n))).toBe('101.25');
  });

  it('computes ownership bps with floor division', () => {
    expect(ownershipBps(1500n, 100000n)).toBe(150n);
    expect(ownershipBps(1499n, 100000n)).toBe(149n);
  });
});
