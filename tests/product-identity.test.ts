import { describe, expect, it } from 'vitest';
import { classifyProductMatch, identifyProduct, isEligibleAffiliate, normalizeProductTitle, safeAdminUrl } from '../server/product-identity.js';

// Local fixtures exercise URL syntax and matching without contacting or publishing a listing.
const product = 'https://www.ikea.com/us/en/p/test-lamp-white-12345678/';

describe('product identity', () => {
  it('identifies the merchant, market and article and ignores only supported attribution parameters', () => {
    const identified = identifyProduct(product)!;
    expect(identified).toMatchObject({ merchant: 'IKEA', market: 'us/en', listingId: '12345678', canonicalUrl: product });
    expect(identifyProduct(`${product}?utm_medium=test&gclid=abc`)?.lookupKey).toBe(identified.lookupKey);
    expect(identifyProduct(product.slice(0, -1))?.lookupKey).toBe(identified.lookupKey);
    expect(identifyProduct(`${product}?size=large`)?.merchant).toBe('Other');
    expect(identifyProduct(`${product}#configuration`)?.canonicalUrl).toBe(product);
    expect(identifyProduct(`${product}?utm_source=a&utm_source=b`)?.merchant).toBe('Other');
  });

  it('keeps different variants, aliases and markets out of exact matches', () => {
    expect(classifyProductMatch(product, `${product}?utm_source=test`)).toBe('exact');
    expect(classifyProductMatch(product, product.replace('12345678', '12345679'))).toBe('mismatch');
    expect(classifyProductMatch(product, product.replace('white', 'light'))).toBe('potential');
    expect(classifyProductMatch(product, product.replace('/us/en/', '/ca/en/'))).toBe('potential');
    expect(classifyProductMatch(product, 'https://example.test/test-lamp-white')).toBe('insufficient');
    expect(normalizeProductTitle('  Ｔｅｓｔ   Lamp   White ')).toBe('test lamp white');
  });

  it('allows only direct HTTPS candidates with matching identity and supported attribution', () => {
    expect(isEligibleAffiliate(product, `${product}?utm_source=unit-test`)).toBe(true);
    expect(isEligibleAffiliate(product, product)).toBe(false);
    expect(isEligibleAffiliate(product, `${product}?gclid=abc`)).toBe(false);
    expect(isEligibleAffiliate(product, `${product}?destination=elsewhere`)).toBe(false);
    expect(isEligibleAffiliate(product, product.replace('www.ikea.com', 'example.test'))).toBe(false);
    for (const value of ['javascript:void(0)', 'http://example.test/', 'https://user:pass@example.test/', 'https://example.test:8443/']) {
      expect(safeAdminUrl(value)).toBeNull();
    }
  });

  it('deduplicates Tokopedia, Shopee, and manual submissions without granting cross-product links', () => {
    const tokopedia = 'https://www.tokopedia.com/store/phone-case';
    const shopee = 'https://shopee.co.id/Phone-Case-i.123.456';
    const manual = 'https://shop.example.test/items/phone-case?variant=blue';
    expect(identifyProduct(tokopedia)).toMatchObject({ merchant: 'Tokopedia', market: 'id', canonicalUrl: tokopedia });
    expect(identifyProduct(shopee)).toMatchObject({ merchant: 'Shopee', market: 'id', listingId: '123.456',
      canonicalUrl: 'https://shopee.co.id/product/123/456' });
    expect(identifyProduct(manual)).toMatchObject({ merchant: 'Other', market: 'global' });
    for (const source of [tokopedia, shopee, manual]) {
      const attributed = source + (source.includes('?') ? '&' : '?') + 'utm_source=partner';
      expect(isEligibleAffiliate(source, attributed)).toBe(true);
      expect(isEligibleAffiliate(source, source.replace('phone-case', 'different-case'))).toBe(false);
    }
    expect(isEligibleAffiliate(shopee, 'https://example.test/product/123/456?utm_source=partner')).toBe(false);
  });
});
