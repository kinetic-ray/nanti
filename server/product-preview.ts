import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { isIkeaMetadataLink, productMerchant } from '../shared/product-import.js';
import type { ProductImport } from '../shared/product-import.js';
import { currencies, parsePrice } from '../shared/wishlist.js';

const MAX_BYTES = 512 * 1024;

export async function previewProduct(url: URL, request = fetch): Promise<string | null> {
  return (await previewProductMetadata(url, request))?.title ?? null;
}

export async function previewProductMetadata(url: URL, request = fetch) {
  // Shopee short links and product pages may expose public Open Graph metadata.
  // Only follow redirects within explicitly allowed Shopee domains; never fetch arbitrary destinations.
  if (productMerchant(url.hostname) === 'shopee' || productMerchant(url.hostname) === 'tokopedia') return previewMarketplaceMetadata(url, request);
  if (!isIkeaMetadataLink(url)) return null;

  try {
    // Rebuild the request from a fixed origin, dropping user-supplied query and fragment.
    const response = await request(new URL(url.pathname, 'https://www.ikea.com'), {
      redirect: 'manual',
      signal: AbortSignal.timeout(3500),
      headers: { accept: 'text/html' },
    });
    if (!response.ok || !/^text\/html\b/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      return null;
    }
    if (!response.body) return null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        html += decoder.decode(value.subarray(0, Math.max(0, MAX_BYTES - bytes + value.byteLength)), { stream: true });
        if (bytes >= MAX_BYTES || /<\/head\s*>/i.test(html)) break;
      }
    } finally {
      await reader.cancel();
    }

    const document = parse(html + decoder.decode());
    const root = document.childNodes.find((node): node is DefaultTreeAdapterTypes.Element =>
      'tagName' in node && node.tagName === 'html');
    const head = root?.childNodes.find((node): node is DefaultTreeAdapterTypes.Element =>
      'tagName' in node && node.tagName === 'head');
    const tags = new Map<string, string>();
    const offers: NonNullable<ProductImport['price']>[] = [];
    let inconsistent = false;
    for (const node of head?.childNodes ?? []) {
      if (!('tagName' in node)) continue;
      if (node.tagName === 'meta') {
        const property = node.attrs.find((attr) => attr.name === 'property')?.value;
        const content = node.attrs.find((attr) => attr.name === 'content')?.value.trim();
        if (!property || !content) continue;
        if (property.startsWith('product:price:') && tags.has(property) && tags.get(property) !== content) inconsistent = true;
        if (!tags.has(property)) tags.set(property, content);
      }
      if (node.tagName === 'script' && node.attrs.some(({ name, value }) =>
        name === 'type' && value.toLowerCase() === 'application/ld+json')) {
        const data = node.childNodes[0];
        if (data && 'value' in data) {
          try { offers.push(...productOffers(JSON.parse(data.value), url)); } catch { /* Invalid structured data. */ }
        }
      }
    }
    const openGraphOffer = parseOffer(tags.get('product:price:amount'), tags.get('product:price:currency'));
    if (openGraphOffer) offers.push(openGraphOffer);
    const firstOffer = offers[0];
    const price = !inconsistent && firstOffer && offers.every((entry) =>
      entry.priceMinor === firstOffer.priceMinor && entry.currency === firstOffer.currency) ? firstOffer : null;
    return { title: tags.get('og:title')?.slice(0, 160) ?? null, image: tags.get('og:image')?.slice(0, 2048) ?? null, price };
  } catch {
    return null;
  }
}

function parseOffer(amount: unknown, code: unknown): NonNullable<ProductImport['price']> | null {
  const currency = currencies.find((entry) => entry === code);
  const priceMinor = typeof amount === 'number' || typeof amount === 'string' ? parsePrice(String(amount)) : null;
  return priceMinor === null || !currency ? null : { priceMinor, currency };
}

function productOffers(data: unknown, url: URL): NonNullable<ProductImport['price']>[] {
  const rows = Array.isArray(data) ? data : [data];
  const tagged = (value: unknown, label: string) => value === label || (Array.isArray(value) && value.includes(label));
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const products = Array.isArray(row['@graph']) ? [row, ...row['@graph']] : [row];
    return products.flatMap((product) => {
      if (!product || !tagged(product['@type'], 'Product')) return [];
      if (typeof product.url === 'string') {
        let listed: URL;
        try { listed = new URL(product.url, url.origin); } catch { return []; }
        if (listed.origin !== url.origin || listed.pathname.replace(/\/$/u, '') !== url.pathname.replace(/\/$/u, '')) return [];
      }
      const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
      const offer = offers[0];
      if (offers.length !== 1 || !offer || !tagged(offer['@type'], 'Offer')) return [];
      const price = parseOffer(offer.price, offer.priceCurrency);
      return price ? [price] : [];
    });
  });
}

const shopeeHosts = new Set([
  's.shopee.co.id', 'shopee.co.id', 'shopee.com', 'shopee.sg',
  'shopee.com.my', 'shopee.co.th', 'shopee.vn', 'shopee.ph',
  'shopee.com.br', 'shope.ee', 'www.shopee.co.id',
]);
function isShopeeHost(host: string) { return shopeeHosts.has(host.toLowerCase().replace(/^www\./u, '')); }

function isMarketplaceHost(host: string, merchant: 'shopee' | 'tokopedia') {
  return merchant === 'shopee' ? isShopeeHost(host) :
    ['tokopedia.com', 'tokopedia.link', 'tk.tokopedia.com', 'vt.tokopedia.com', 'shop-id.tokopedia.com'].includes(host) ||
    host.endsWith('.tokopedia.com');
}

async function previewMarketplaceMetadata(initial: URL, request: typeof fetch) {
  const diagnostic = (reason: string, host: string, status?: number) => {
    // No full URLs, query strings, affiliate codes or product identifiers in logs.
    console.info('[product-import]', { merchant: productMerchant(initial.hostname), host, reason, ...(status === undefined ? {} : { status }) });
  };
  let current = new URL(initial.href);
  let hop = 0;
  try {
    const merchant = productMerchant(initial.hostname);
    if (merchant !== 'shopee' && merchant !== 'tokopedia') return null;
    current.hash = '';
    for (hop = 0; hop < 6; hop++) {
      if (current.protocol !== 'https:' || !isMarketplaceHost(current.hostname, merchant) ||
          current.username || current.password || current.port) {
        diagnostic('redirect_disallowed', current.hostname);
        return null;
      }
      const response = await request(current, {
        redirect: 'manual', signal: AbortSignal.timeout(3500),
        headers: { accept: 'text/html' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) { diagnostic('redirect_missing_location', current.hostname, response.status); return null; }
        current = new URL(location, current);
        continue;
      }
      if (!response.ok || !/^text\/html\b/i.test(response.headers.get('content-type') ?? '') ||
          !response.body) { diagnostic(!response.ok ? 'http_failure' : 'not_html', current.hostname, response.status); await response.body?.cancel(); return null; }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let html = '';
      let total = 0;
      try {
        while (total < MAX_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          const length = Math.min(value.byteLength, MAX_BYTES - total);
          total += length;
          html += decoder.decode(value.subarray(0, length), { stream: true });
          if (/<\/head\s*>/i.test(html)) break;
        }
      } finally { await reader.cancel(); }
      const document = parse(html + decoder.decode());
      const root = document.childNodes.find((node): node is DefaultTreeAdapterTypes.Element =>
        'tagName' in node && node.tagName === 'html');
      const head = root?.childNodes.find((node): node is DefaultTreeAdapterTypes.Element =>
        'tagName' in node && node.tagName === 'head');
      const tags = new Map<string, string>();
      for (const node of head?.childNodes ?? []) {
        if (!('tagName' in node) || node.tagName !== 'meta') continue;
        const key = node.attrs.find(a => a.name === 'property' || a.name === 'name')?.value.toLowerCase();
        const content = node.attrs.find(a => a.name === 'content')?.value.trim();
        if (key && content && !tags.has(key)) tags.set(key, content);
      }
      // Prefer public social preview tags, then structured Product data if available.
      let structuredTitle: string | null = null;
      let structuredImage: string | null = null;
      const offers: NonNullable<ProductImport['price']>[] = [];
      let conflictingPrices = false;
      for (const node of head?.childNodes ?? []) {
        if (!('tagName' in node) || node.tagName !== 'script' ||
            !node.attrs.some(a => a.name === 'type' && a.value.toLowerCase() === 'application/ld+json')) continue;
        const content = node.childNodes[0];
        if (!content || !('value' in content)) continue;
        try {
          const parsed: unknown = JSON.parse(content.value);
          const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
          for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;
            const graph = '@graph' in entry && Array.isArray(entry['@graph']) ? entry['@graph'] : [];
            for (const value of [entry, ...graph]) {
              if (!value || typeof value !== 'object' || !('@type' in value)) continue;
              const kind = value['@type'];
              if (kind !== 'Product' && !(Array.isArray(kind) && kind.includes('Product'))) continue;
              if ('name' in value && typeof value.name === 'string') structuredTitle ??= value.name;
              const photos = 'image' in value ? value.image : null;
              const photo = Array.isArray(photos) ? photos[0] : photos;
              if (typeof photo === 'string') structuredImage ??= photo;
              // Only trust an explicit single Product Offer for the current listing.
              // Aggregate/variant price ranges must not become a fabricated exact price.
              const rawOffers = 'offers' in value ? value.offers : null;
              if (rawOffers && !Array.isArray(rawOffers) && typeof rawOffers === 'object' &&
                  '@type' in rawOffers && rawOffers['@type'] === 'Offer' &&
                  'price' in rawOffers && 'priceCurrency' in rawOffers) {
                const offer = parseOffer(rawOffers.price, rawOffers.priceCurrency);
                if (offer) offers.push(offer);
              }
            }
          }
        } catch { /* Ignore malformed structured data. */ }
      }
      const socialOffer = parseOffer(tags.get('product:price:amount'), tags.get('product:price:currency'));
      if (socialOffer) offers.push(socialOffer);
      const firstOffer = offers[0];
      conflictingPrices = offers.some(offer => firstOffer &&
        (offer.priceMinor !== firstOffer.priceMinor || offer.currency !== firstOffer.currency));
      const price = !conflictingPrices && firstOffer ? firstOffer : null;
      const title = (tags.get('og:title') ?? tags.get('twitter:title') ??
        structuredTitle ?? '').slice(0, 160) || null;
      const candidate = tags.get('og:image') ?? tags.get('twitter:image') ??
        tags.get('twitter:image:src') ?? structuredImage;
      let image: string | null = null;
      if (candidate) {
        try {
          const parsed = new URL(candidate, current);
          // Only publicly hosted Shopee image-CDN URLs; no arbitrary image fetching.
          const host = parsed.hostname.toLowerCase();
          if (parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
              (host === 'susercontent.com' || host.endsWith('.susercontent.com') ||
               host === 'shopee.co.id' || host.endsWith('.shopee.co.id') ||
               (merchant === 'tokopedia' && (host === 'tokopedia.net' || host.endsWith('.tokopedia.net') ||
                 host === 'tokopedia.com' || host.endsWith('.tokopedia.com'))))) {
            image = parsed.href.slice(0, 2048);
          }
        } catch { /* Invalid image URL. */ }
      }
      if (!title && !image) diagnostic('metadata_missing', current.hostname, response.status);
      return title || image || price ? { title, image, price } : null;
    }
    diagnostic('redirect_limit', current.hostname);
    return null;
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    diagnostic(timeout ? (hop > 0 ? 'destination_timeout' : 'timeout') : 'request_error', current.hostname);
    return null;
  }
}
