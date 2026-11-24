import { describe, expect, it } from 'vitest';
import { marketplacePriceAllowed } from '../server/runtime.js';

describe('marketplace price metadata permission', () => {
  it.each([
    ['', false],
    ['granted', true],
  ] as const)('allows Shopee prices only when permission is %s', (permission, expected) => {
    expect(marketplacePriceAllowed('shopee', {
      NANTI_SHOPEE_PRICE_METADATA_PERMISSION: permission,
      NANTI_IKEA_PRICE_METADATA_PERMISSION: '',
    })).toBe(expected);
  });

  it('keeps Tokopedia price extraction independent of the Shopee permission', () => {
    expect(marketplacePriceAllowed('tokopedia', {
      NANTI_SHOPEE_PRICE_METADATA_PERMISSION: '',
      NANTI_IKEA_PRICE_METADATA_PERMISSION: '',
    })).toBe(true);
  });
});
