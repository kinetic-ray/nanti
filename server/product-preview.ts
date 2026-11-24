import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { isIkeaMetadataLink, productMerchant } from '../shared/product-import.js';
import type { ProductImport } from '../shared/product-import.js';
import { currencies, parsePrice } from '../shared/wishlist.js';
import { extractTokopediaMetadata, requestPublicPage } from './tokopedia-metadata.js';
import { extractShopeeMetadata } from './shopee-metadata.js';

type Diagnostic = (reason: string, host: string, status?: number) => void;
type ProductPreview = { title: string | null; image: string | null; price: NonNullable<ProductImport['price']> | null; sellerName?: string; productUrl?: string };

const MAX_BYTES = 512 * 1024;

export async function previewProduct(url: URL, request?: typeof fetch): Promise<string | null> {
  return (await previewProductMetadata(url, request))?.title ?? null;
}
export async function previewProductMetadata(url: URL, request?: typeof fetch, onDiagnostic?: Diagnostic): Promise<ProductPreview | null> {
  const merchant = productMerchant(url.hostname);
  if (merchant === 'tokopedia') {
    // The production extractor uses its DNS-pinned transport. Explicit transports support fixtures.
    const fetchPage = request;
    const metadata = await extractTokopediaMetadata(url.href, fetchPage && ((target, signal) =>
      fetchPage(target, { redirect: 'manual', signal, headers: { accept: 'text/html' } })), (reason, host, status) => {
      console.info('[product-import]', { merchant, host: host || url.hostname, reason, ...(status === undefined ? {} : { status }) });
      onDiagnostic?.(reason, host || url.hostname, status);
    });
    if (!metadata) return null;
    const priceMinor = metadata.price ? parsePrice(String(metadata.price.amount)) : null;
    return {
      productUrl: metadata.productUrl,
      title: metadata.title?.slice(0, 160) ?? null,
      image: metadata.imageUrl && metadata.imageUrl.length <= 2048 ? metadata.imageUrl : null,
      price: priceMinor === null ? null : { priceMinor, currency: 'IDR' },
      ...(metadata.storeName && { sellerName: metadata.storeName.slice(0, 160) }),
    };
  }
  if (merchant === 'shopee') return extractShopeeMetadata(url, request, (reason, host, status) => {
    console.info('[product-import]', { merchant, host: host || url.hostname, reason,
      ...(status === undefined ? {} : { status }) });
    onDiagnostic?.(reason, host || url.hostname, status);
  });
  request ??= fetch;
  if (!isIkeaMetadataLink(url)) {
    onDiagnostic?.('adapter_disabled', url.hostname);
    return null;
  }

  try {
    // Rebuild the request from a fixed origin, dropping user-supplied query and fragment.
    const response = await request(new URL(url.pathname, 'https://www.ikea.com'), {
      redirect: 'manual',
      signal: AbortSignal.timeout(3500),
      headers: { accept: 'text/html' },
    });
    if (!response.ok || !/^text\/html\b/i.test(response.headers.get('content-type') ?? '')) {
      onDiagnostic?.(!response.ok ? 'http_failure' : 'not_html', url.hostname, response.status);
      await response.body?.cancel();
      return null;
    }
    if (!response.body) { onDiagnostic?.('empty_response', url.hostname, response.status); return null; }

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
    const title = tags.get('og:title')?.slice(0, 160) ?? null;
    const image = tags.get('og:image')?.slice(0, 2048) ?? null;
    if (!title && !image && !price) { onDiagnostic?.('metadata_missing', url.hostname, response.status); return null; }
    return { title, image, price };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    onDiagnostic?.(timeout ? 'timeout' : 'request_error', url.hostname);
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
