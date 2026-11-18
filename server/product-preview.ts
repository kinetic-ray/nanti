import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { isIkeaMetadataLink } from '../shared/product-import.js';
import type { ProductImport } from '../shared/product-import.js';
import { currencies, parsePrice } from '../shared/wishlist.js';

const MAX_BYTES = 512 * 1024;

export async function previewProduct(url: URL, request = fetch): Promise<string | null> {
  return (await previewProductMetadata(url, request))?.title ?? null;
}

export async function previewProductMetadata(url: URL, request = fetch) {
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
