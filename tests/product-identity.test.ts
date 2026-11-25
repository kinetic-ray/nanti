import { describe, expect, it } from 'vitest';
import { classifyProductMatch, identifyCatalogProduct, identifyProduct, isEligibleAffiliate, normalizeProductTitle, safeAdminUrl } from '../server/product-identity.js';

// Local fixtures exercise URL syntax and matching without contacting or publishing a listing.
const product = 'https://www.ikea.com/us/en/p/test-lamp-white-12345678/';

describe('product identity', () => {
  it('classifies known marketplace URLs and strips Shopee share tracking while preserving variants', () => {
    const listing = 'https://shopee.co.id/product/123/456';
    expect(identifyCatalogProduct('https://s.shopee.co.id/share')?.merchant).toBe('Shopee');
    expect(identifyCatalogProduct('https://www.shopee.co.id/Lamp-i.123.456?sp_atk=share&xptdk=share')?.canonicalUrl)
      .toBe(listing);
    expect(identifyCatalogProduct(listing + '?variationId=7')?.lookupKey)
      .not.toBe(identifyCatalogProduct(listing + '?variationId=8')?.lookupKey);
  });
  it('recognizes Tokopedia tracking links while keeping unknown parameters and fragments in the identity', () => {
    const listing = 'https://www.tokopedia.com/store/phone-case';
    const tracked = listing + '?ref=share&utm_source=share';
    expect(identifyProduct(tracked)).toMatchObject({ merchant: 'Tokopedia', market: 'id', canonicalUrl: listing });
    expect(classifyProductMatch(listing, tracked)).toBe('exact');
    expect(isEligibleAffiliate(listing, tracked)).toBe(false);
    const blue = identifyProduct(tracked + '&variant=blue');
    expect(blue?.canonicalUrl).toBe(listing + '?variant=blue');
    expect(blue?.lookupKey).not.toBe(identifyProduct(listing + '?variant=red')?.lookupKey);
    expect(identifyProduct(listing + '#bundle')?.lookupKey).not.toBe(identifyProduct(listing)?.lookupKey);
    expect(classifyProductMatch(listing, listing + '-different')).toBe('mismatch');
  });

  it('recognizes supported Tokopedia short hosts without treating an opaque redirect as an eligible affiliate', () => {
    for (const host of ['tokopedia.link', 'www.tokopedia.link', 'tk.tokopedia.com', 'vt.tokopedia.com']) {
      const link = `https://${host}/fixture?utm_source=partner`;
      expect(identifyProduct(link)).toMatchObject({ merchant: 'Tokopedia', canonicalUrl: link });
      expect(isEligibleAffiliate(link, link)).toBe(false);
    }
  });

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
