import { describe, expect, it } from 'vitest';
import { rankAlternatives, type RecommendationProduct } from '../server/recommendation-matching.js';

const source: RecommendationProduct = {
  id: 'nb', title: 'New Balance 530 White', category: 'sneakers',
  color: 'white', style: 'retro', useCase: 'casual',
  priceMinor: 150000000, currency: 'IDR', priceVerified: true,
  published: true, url: 'https://example.com/nb',
};
const candidate = (changes: Partial<RecommendationProduct> = {}): RecommendationProduct => ({
  id: 'brodo', title: 'Brodo Nexus White', category: 'sneakers',
  color: 'white', style: 'retro', useCase: 'casual',
  priceMinor: 80000000, currency: 'IDR', priceVerified: true, priceVerifiedAt: new Date(),
  published: true, url: 'https://www.tokopedia.com/brodo/nexus', ...changes,
});
describe('curated alternative ranking', () => {
  it('matches relevant cheaper products without external services', () => {
    const matches = rankAlternatives(source, [candidate()]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.product.id).toBe('brodo');
    expect(matches[0]?.reasons).toContain('Warna serupa');
  });
  it('excludes expensive, unverified, unpublished and wrong-currency products', () => {
    expect(rankAlternatives(source, [
      candidate({ id: 'expensive', priceMinor: 160000000 }),
      candidate({ id: 'unknown', priceVerified: false }),
      candidate({ id: 'draft', published: false }),
      candidate({ id: 'usd', currency: 'USD' }),
    ])).toEqual([]);
  });
  it('excludes category mismatches even with a manual link', () => {
    expect(rankAlternatives(source, [candidate({ category: 'headphones' })], {
      manuallyLinkedIds: ['brodo'],
    })).toEqual([]);
  });
  it('rejects unsafe and malformed destination URLs', () => {
    expect(rankAlternatives(source, [
      candidate({ id: 'http', url: 'http://example.com' }),
      candidate({ id: 'local', url: 'https://localhost/private' }),
      candidate({ id: 'credentials', url: 'https://user:pass@example.com' }),
    ])).toEqual([]);
  });
  it('supports a manually linked candidate with weak textual similarity', () => {
    const result = rankAlternatives(source, [candidate({
      title: 'Generic Footwear', color: null, style: null, useCase: null,
    })], { manuallyLinkedIds: ['brodo'] });
    expect(result).toHaveLength(1);
  });
  it('rejects lookalike marketplace domains and credential-bearing URLs', () => {
    expect(rankAlternatives(source, [
      candidate({ id: 'lookalike', url: 'https://tokopedia.com.evil.example/item' }),
      candidate({ id: 'subdomain', url: 'https://evil-tokopedia.com/item' }),
      candidate({ id: 'credentials', url: 'https://user:pass@www.tokopedia.com/item' }),
      candidate({ id: 'port', url: 'https://www.tokopedia.com:8443/item' }),
    ])).toEqual([]);
  });
  it('rejects stale or missing verification timestamps', () => {
    expect(rankAlternatives(source, [candidate({ priceVerifiedAt: null })])).toEqual([]);
    expect(rankAlternatives(source, [candidate({ priceVerifiedAt: new Date(Date.now() - 8 * 86_400_000) })])).toEqual([]);
  });
  it('accepts equivalent shoe categories', () => {
    expect(rankAlternatives({ ...source, category: 'sepatu' }, [candidate({ category: 'sneakers' })])).toHaveLength(1);
  });
  it('limits recommendations to three and handles absent source prices', () => {
    expect(rankAlternatives(source, Array.from({ length: 6 }, (_, i) =>
      candidate({ id: String(i) })))).toHaveLength(3);
    expect(rankAlternatives({ ...source, priceMinor: null }, [candidate()])).toEqual([]);
  });
});
