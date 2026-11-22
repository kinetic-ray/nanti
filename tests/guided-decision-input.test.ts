import { describe, expect, it } from 'vitest';
import { formatMoneyInput, toMinor } from '../src/guided-purchase-decision.js';

describe('guided purchase money input', () => {
  it('groups Indonesian amounts as the user types', () => {
    expect(formatMoneyInput('500000', 'id')).toBe('500.000');
    expect(formatMoneyInput('450000', 'id')).toBe('450.000');
    expect(formatMoneyInput('1000000', 'id')).toBe('1.000.000');
    expect(formatMoneyInput('500.000', 'id')).toBe('500.000');
  });
  it('uses English grouping when the interface is in English', () => {
    expect(formatMoneyInput('1000000', 'en')).toBe('1,000,000');
  });
  it('parses grouped and ungrouped amounts identically', () => {
    expect(toMinor('500000')).toBe(50000000n);
    expect(toMinor('500.000')).toBe(50000000n);
    expect(toMinor('500,000')).toBe(50000000n);
    expect(toMinor('450.000')).toBe(45000000n);
    expect(toMinor('100.000')).toBe(10000000n);
    expect(toMinor('0')).toBe(0n);
  });
  it('rejects malformed and negative amounts', () => {
    expect(toMinor('')).toBeNull();
    expect(toMinor('-1')).toBeNull();
    expect(toMinor('abc')).toBeNull();
    expect(toMinor('1.00')).toBeNull();
  });
});
