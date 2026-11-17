import { createHash } from 'node:crypto';
import { safeProductUrl } from '../shared/wishlist.js';

const ikeaOrigin = 'https://www.ikea.com';
const attribution = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'aff_id', 'affiliate_id', 'gclid', 'fbclid']);
const passiveAdvertising = new Set(['gclid', 'fbclid']);

export function productKey(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeProductTitle(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function identifyProduct(value: string | null) {
  const url = value && safeProductUrl(value);
  if (!url || url.origin !== ikeaOrigin || url.hash) return null;
  const path = url.pathname.match(/^\/([a-z]{2})\/([a-z]{2})\/p\/([a-z0-9-]{1,150})-(s?\d{8})\/?$/u);
  if (!path) return null;
  const [_, country, language, slug, article] = path;
  const keys = new Set<string>();
  for (const [key, parameter] of url.searchParams) {
    if (!attribution.has(key) || !/^[a-z0-9_.~ +\-]{1,150}$/i.test(parameter) || keys.has(key)) return null;
    keys.add(key);
  }
  const market = `${country}/${language}`;
  const canonicalUrl = `${ikeaOrigin}/${market}/p/${slug}-${article}/`;
  return {
    lookupKey: productKey(canonicalUrl), merchant: 'IKEA', market, listingId: article!,
    canonicalUrl, hasAttribution: [...keys].some((key) => !passiveAdvertising.has(key)),
  };
}

export function classifyProductMatch(original: string, candidate: string) {
  const source = identifyProduct(original);
  const destination = identifyProduct(candidate);
  if (!source || !destination) return 'insufficient';
  if (source.merchant !== destination.merchant || source.listingId !== destination.listingId) return 'mismatch';
  if (source.lookupKey !== destination.lookupKey || source.market !== destination.market) return 'potential';
  return 'exact';
}

export function isEligibleAffiliate(original: string, candidate: string) {
  return classifyProductMatch(original, candidate) === 'exact' && identifyProduct(candidate)?.hasAttribution === true;
}

export function safeAdminUrl(value: string): URL | null {
  const url = safeProductUrl(value);
  return url?.protocol === 'https:' && !url.port ? url : null;
}
