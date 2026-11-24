import { createHash } from 'node:crypto';
import { safeProductUrl } from '../shared/wishlist.js';

const ikeaOrigin = 'https://www.ikea.com';
const attribution = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'aff_id', 'affiliate_id', 'gclid', 'fbclid']);
const passiveAdvertising = new Set(['gclid', 'fbclid']);
const shopeeMarkets: Record<string, string> = {
  'shopee.co.id': 'id', 'shopee.sg': 'sg', 'shopee.com.my': 'my', 'shopee.co.th': 'th',
  'shopee.vn': 'vn', 'shopee.ph': 'ph', 'shopee.com.br': 'br', 'shopee.com': 'global',
};

export function productKey(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeProductTitle(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function identifyProduct(value: string | null) {
  const url = value && safeProductUrl(value);
  if (!url) return null;
  const ikea = url.origin === ikeaOrigin && url.pathname.match(/^\/([a-z]{2})\/([a-z]{2})\/p\/([a-z0-9-]{1,150})-(s?\d{8})\/?$/u);
  if (ikea && !url.hash && supportedAttribution(url)) {
    const [_, country, language, slug, article] = ikea;
    const canonicalUrl = `${ikeaOrigin}/${country}/${language}/p/${slug}-${article}/`;
    return { lookupKey: productKey(canonicalUrl), merchant: 'IKEA', market: `${country}/${language}`,
      listingId: article!, canonicalUrl, hasAttribution: hasAttribution(url) };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./u, '');
  const shopeeMarket = shopeeMarkets[host];
  const shopee = shopeeMarket && (url.pathname.match(/^\/product\/(\d+)\/(\d+)\/?$/u) ||
    url.pathname.match(/^\/[^/]*-i\.(\d+)\.(\d+)\/?$/u));
  if (shopeeMarket && shopee && !url.hash && supportedAttribution(url)) {
    const shop = shopee[1]!;
    const item = shopee[2]!;
    const canonicalUrl = `https://${host}/product/${shop}/${item}`;
    return { lookupKey: productKey(canonicalUrl), merchant: 'Shopee', market: shopeeMarket,
      listingId: `${shop}.${item}`, canonicalUrl, hasAttribution: hasAttribution(url) };
  }

  if ((host === 'tokopedia.com') && /^\/[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_-]*\/?$/iu.test(url.pathname) &&
      !url.hash && supportedAttribution(url)) {
    const path = url.pathname.replace(/\/$/u, '');
    const canonicalUrl = `https://www.tokopedia.com${path}`;
    return { lookupKey: productKey(canonicalUrl), merchant: 'Tokopedia', market: 'id',
      listingId: productKey(path).slice(0, 24), canonicalUrl, hasAttribution: hasAttribution(url) };
  }

  // Keep a shared identity for every other safe product URL. Unknown query
  // parameters remain part of the key so possible variants are not merged.
  const normalized = new URL(url.href);
  normalized.hash = '';
  for (const key of [...normalized.searchParams.keys()]) if (attribution.has(key)) normalized.searchParams.delete(key);
  normalized.searchParams.sort();
  const canonicalUrl = normalized.href;
  return { lookupKey: productKey(canonicalUrl), merchant: 'Other', market: 'global',
    listingId: productKey(canonicalUrl).slice(0, 24), canonicalUrl, hasAttribution: hasAttribution(url) };
}

function supportedAttribution(url: URL) {
  const keys = new Set<string>();
  for (const [key, parameter] of url.searchParams) {
    if (!attribution.has(key) || !/^[a-z0-9_.~ +\-]{1,150}$/i.test(parameter) || keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

function hasAttribution(url: URL) {
  return [...url.searchParams.keys()].some(key => attribution.has(key) && !passiveAdvertising.has(key));
}

export function classifyProductMatch(original: string, candidate: string) {
  const source = identifyProduct(original);
  const destination = identifyProduct(candidate);
  if (!source || !destination) return 'insufficient';
  if (source.merchant !== destination.merchant || source.listingId !== destination.listingId) return 'mismatch';
  if (source.lookupKey !== destination.lookupKey || source.market !== destination.market || source.merchant !== destination.merchant) return 'potential';
  return 'exact';
}

export function isEligibleAffiliate(original: string, candidate: string) {
  const source = identifyProduct(original);
  const destination = identifyProduct(candidate);
  return Boolean(source && destination && source.lookupKey === destination.lookupKey && source.market === destination.market &&
    source.merchant === destination.merchant && destination.hasAttribution && safeAdminUrl(original)?.origin === safeAdminUrl(candidate)?.origin);
}

export function safeAdminUrl(value: string): URL | null {
  const url = safeProductUrl(value);
  return url?.protocol === 'https:' && !url.port ? url : null;
}
