import { describe, expect, it } from 'vitest';
import { formatProductPriceInput, normalizeProductPriceInput } from '../src/product-price-input.js';
import { parsePrice } from '../shared/wishlist.js';

describe('product unit price formatting', () => {
  it('groups Indonesian price while typing', () => {
    expect(formatProductPriceInput('50000', 'id')).toBe('50.000');
    expect(formatProductPriceInput('1000000', 'id')).toBe('1.000.000');
    expect(formatProductPriceInput('50000,50', 'id')).toBe('50.000,50');
  });
  it('groups English price while typing', () => {
    expect(formatProductPriceInput('50000', 'en')).toBe('50,000');
    expect(formatProductPriceInput('50000.50', 'en')).toBe('50,000.50');
  });
  it('saves formatted prices without changing the amount', () => {
    expect(parsePrice(normalizeProductPriceInput('50.000', 'id'))).toBe(5000000);
    expect(parsePrice(normalizeProductPriceInput('50.000,50', 'id'))).toBe(5000050);
    expect(parsePrice(normalizeProductPriceInput('50,000.50', 'en'))).toBe(5000050);
  });
});
