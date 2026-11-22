import { describe, expect, it } from 'vitest';
import { toMinor } from '../src/guided-purchase-decision.js';

describe('guided purchase money input', () => {
  it('accepts the exact amounts reported on mobile', () => {
    expect(toMinor('500000')).toBe(50000000n);
    expect(toMinor('450000')).toBe(45000000n);
    expect(toMinor('100000')).toBe(10000000n);
  });
  it('accepts zero and fractional amounts', () => {
    expect(toMinor('0')).toBe(0n);
    expect(toMinor('25000.50')).toBe(2500050n);
    expect(toMinor('25000,50')).toBe(2500050n);
  });
  it('rejects malformed and negative amounts', () => {
    expect(toMinor('')).toBeNull();
    expect(toMinor('-1')).toBeNull();
    expect(toMinor('abc')).toBeNull();
  });
});
