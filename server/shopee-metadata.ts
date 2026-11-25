import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import type { ProductImport } from '../shared/product-import.js';
import { readShopeeEmbeddedState } from './shopee-embedded-state.js';
import { requestPublicPage } from './tokopedia-metadata.js';

type Diagnostic = (reason: string, host: string, status?: number) => void;
type ShopeeMetadata = {
  title: string | null;
  image: string | null;
  price: null;
  shopeeDetails?: ProductImport['shopeeDetails'];
  sellerName?: string;
  productUrl?: string;
};

const maxBytes = 2 * 1024 * 1024;
const hosts = new Set([
  's.shopee.co.id', 'shopee.co.id', 'shopee.com', 'shopee.sg', 'shopee.com.my',
  'shopee.co.th', 'shopee.vn', 'shopee.ph', 'shopee.com.br', 'shope.ee',
]);
const allowed = (url: URL) => url.protocol === 'https:' &&
  hosts.has(url.hostname.toLowerCase().replace(/^www\./u, '')) &&
  !url.username && !url.password && !url.port && url.href.length <= 4096;

function listingKey(url: URL): string | null {
  const match = url.pathname.match(/^\/product\/(\d+)\/(\d+)\/?$/u) ??
    url.pathname.match(/^\/[^/]*-i\.(\d+)\.(\d+)\/?$/u);
  // Shopee's www and non-www hosts describe the same shop/item identity.
  const host = url.hostname.replace(/^www\./u, '');
  return match && host !== 's.shopee.co.id' && host !== 'shopee.ee'
    ? host + '/' + match[1] + '/' + match[2] : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function hasType(value: unknown, expected: string): boolean {
  const tagged = (entry: unknown) => typeof entry === 'string' &&
    (entry === expected || entry === `https://schema.org/${expected}`);
  return tagged(value) || (Array.isArray(value) && value.some(tagged));
}

function identityMatches(value: unknown, current: URL, key: string | null): boolean {
  if (typeof value !== 'string') return false;
  const reference = URL.parse(value, current);
  if (!reference || !allowed(reference)) return false;
  return key ? listingKey(reference) === key :
    reference.origin === current.origin && reference.pathname === current.pathname;
}

function collectProducts(json: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(json) ? json : [json];
  return rows.flatMap(row => {
    const root = record(row);
    if (!root) return [];
    const graph = Array.isArray(root['@graph']) ? root['@graph'] : [];
    return [root, ...graph.map(record).filter((entry): entry is Record<string, unknown> => entry !== null)];
  });
}

function readProductPage(html: string, current: URL, key: string | null, status: number,
  onDiagnostic: Diagnostic | undefined, requireProductIdentity = false): ShopeeMetadata | null {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const root = document.childNodes.find((node): node is DefaultTreeAdapterTypes.Element =>
    'tagName' in node && node.tagName === 'html');
  const head = root?.childNodes.find((node): node is DefaultTreeAdapterTypes.Element =>
    'tagName' in node && node.tagName === 'head');
  const tags = new Map<string, string>();
  const scripts: { source: string; requireReference: boolean }[] = [];
  const embedded: string[] = [];
  let hasCanonical = false;
  const readScript = (node: DefaultTreeAdapterTypes.Element, requireReference: boolean) => {
    if (node.tagName !== 'script' || !node.sourceCodeLocation?.endTag) return;
    const type = node.attrs.find(attr => attr.name === 'type')?.value.toLowerCase();
    const text = node.childNodes.find(child => 'value' in child);
    if (!text || !('value' in text) || Buffer.byteLength(text.value) > 512 * 1024) return;
    if (type === 'application/ld+json') scripts.push({ source: text.value, requireReference });
    if (type === 'text/mfe-initial-data') embedded.push(text.value);
  };
  for (const node of head?.childNodes ?? []) {
    if (!('tagName' in node)) continue;
    const attr = (name: string) => node.attrs.find(entry => entry.name === name)?.value;
    const name = (attr('property') ?? attr('name'))?.toLowerCase();
    const content = attr('content')?.trim();
    const canonicalLink = node.tagName === 'link' && attr('rel')?.toLowerCase().split(/\s+/u).includes('canonical');
    const canonical = canonicalLink ? attr('href') : name === 'og:url' ? content : undefined;
    if ((canonicalLink || canonical) && !identityMatches(canonical, current, key)) {
      onDiagnostic?.('metadata_mismatch', current.hostname, status);
      return null;
    }
    if (canonicalLink && canonical) hasCanonical = true;
    if (node.tagName === 'meta' && name && content && !tags.has(name)) tags.set(name, content);
    readScript(node, false);
  }
  const body = root?.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && node.tagName === 'body');
  const bodyNodes = [...body?.childNodes ?? []];
  let appShell = false;
  while (bodyNodes.length) {
    const node = bodyNodes.pop()!;
    if (!('tagName' in node)) continue;
    if (!node.childNodes.length && node.attrs.some(attr => attr.name === 'id' && attr.value === 'main')) appShell = true;
    readScript(node, true);
    for (const child of node.childNodes) bodyNodes.push(child);
  }

  const [, shopId, itemId] = key?.split('/') ?? [];
  const states = hasCanonical && shopId && itemId && key?.startsWith('shopee.co.id/')
    ? embedded.flatMap(source => readShopeeEmbeddedState(source, shopId, itemId) ?? []) : [];
  const state = states.length === 1 ? states[0] : undefined;
  let title: string | null = state?.title ?? null;
  let image: string | null = null;
  const products: Record<string, unknown>[] = [];
  const sellers = new Set(state?.sellers);
  for (const { source, requireReference } of scripts) {
    let decoded: unknown;
    try { decoded = JSON.parse(source); } catch { continue; }
    for (const value of collectProducts(decoded)) {
      if (!hasType(value['@type'], 'Product')) continue;
      const reference = value.url ?? value['@id'];
      if (reference !== undefined && !identityMatches(reference, current, key)) continue;
      if (reference === undefined && (!key || requireReference)) continue;
      products.push(value);
      if (typeof value.name === 'string' && !title) title = value.name.trim().slice(0, 160) || null;
      const photo = Array.isArray(value.image) ? value.image[0] : value.image;
      const imageObject = record(photo);
      const photoUrl = typeof photo === 'string' ? photo :
        typeof imageObject?.url === 'string' ? imageObject.url : null;
      if (photoUrl && !image) image = photoUrl;
      const rawOffers = Array.isArray(value.offers) ? value.offers : [value.offers];
      if (rawOffers.length !== 1) continue;
      const offer = record(rawOffers[0]);
      if (!offer) continue;
      const seller = record(offer.seller);
      if (typeof seller?.name === 'string' && seller.name.trim()) sellers.add(seller.name.trim().slice(0, 160));
    }
  }

  // A short link that lands on a non-listing destination (for example, a login page)
  // must not inherit its generic social title or image as product metadata.
  if (requireProductIdentity && products.length === 0) {
    onDiagnostic?.('metadata_mismatch', current.hostname, status);
    return null;
  }

  const socialTitle = tags.get('og:title') ?? tags.get('twitter:title');
  const genericSocial = /^shopee indonesia\s*\|/iu.test(socialTitle ?? '');
  if (!genericSocial) title ??= socialTitle?.slice(0, 160) ?? null;
  const imageCandidates = [state?.image, ...(genericSocial ? [] : [tags.get('og:image'),
    tags.get('og:image:secure_url'), tags.get('twitter:image'), tags.get('twitter:image:src')]), image];
  let safeImage: string | null = null;
  for (const candidate of imageCandidates) {
    if (!candidate) continue;
    const parsed = URL.parse(candidate, current);
    if (parsed && parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port &&
        parsed.href.length <= 2048 && (parsed.hostname === 'susercontent.com' ||
        parsed.hostname.endsWith('.susercontent.com') || parsed.hostname === 'cf.shopee.co.id')) {
      safeImage = parsed.href;
      break;
    }
  }

  if (!title && !safeImage && sellers.size !== 1 && !state) {
    onDiagnostic?.(appShell ? 'storefront_shell' : 'metadata_missing', current.hostname, status);
    return null;
  }
  const productUrl = new URL(current.href);
  for (const parameter of ['sp_atk', 'xptdk']) productUrl.searchParams.delete(parameter);
  productUrl.hash = '';
  return {
    title, image: safeImage, price: null,
    ...(state && { shopeeDetails: state.details }),
    ...(sellers.size === 1 ? { sellerName: [...sellers][0]! } : {}),
    ...(key ? { productUrl: productUrl.href } : {}),
  };
}

export async function extractShopeeMetadata(initial: URL, request?: typeof fetch,
  onDiagnostic?: Diagnostic): Promise<ShopeeMetadata | null> {
  let current = new URL(initial.href);
  current.hash = '';
  let key = listingKey(current);
  let hop = 0;
  const diagnostic = (reason: string, status?: number) => onDiagnostic?.(reason, current.hostname, status);
  try {
    if (!allowed(current)) { diagnostic('redirect_disallowed'); return null; }
    const deadline = AbortSignal.timeout(5000);
    const visited = new Set<string>();
    for (hop = 0; hop < 6; hop++) {
      visited.add(current.href);
      const signal = AbortSignal.any([deadline, AbortSignal.timeout(3500)]);
      const response = request
        ? await request(current, { redirect: 'manual', signal, headers: { accept: 'text/html' } })
        : await requestPublicPage(current, signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        const target = location ? URL.parse(location, current) : null;
        if (!target || !allowed(target)) { diagnostic(location ? 'redirect_disallowed' : 'redirect_missing_location', response.status); return null; }
        target.hash = '';
        if (visited.has(target.href)) { diagnostic('redirect_limit', response.status); return null; }
        const targetKey = listingKey(target);
        if (key && targetKey !== key) { diagnostic('redirect_disallowed', response.status); return null; }
        key ??= targetKey;
        current = target;
        continue;
      }
      if (response.status !== 200) {
        const code = response.status === 403 ? 'access_blocked' : response.status === 429 ? 'rate_limited' :
          response.status === 404 || response.status === 410 ? 'listing_unavailable' : 'http_failure';
        diagnostic(code, response.status);
        await response.body?.cancel();
        return null;
      }
      if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') {
        diagnostic('captcha_required', response.status);
        await response.body?.cancel();
        return null;
      }
      if (response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'text/html' || !response.body) {
        diagnostic('not_html', response.status);
        await response.body?.cancel();
        return null;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let html = '';
      let total = 0;
      try {
        while (total < maxBytes) {
          const { done, value } = await reader.read();
          if (done) break;
          const length = Math.min(value.byteLength, maxBytes - total);
          total += length;
          html += decoder.decode(value.subarray(0, length), { stream: true });
        }
      } finally { await reader.cancel(); }
      html += decoder.decode();
      if (/(?:verify (?:that )?you are human|captcha|human verification)/iu.test(html.slice(0, 16_384))) {
        diagnostic('captcha_required', response.status);
        return null;
      }
      return readProductPage(html, current, key, response.status, onDiagnostic,
        key === null);
    }
    diagnostic('redirect_limit');
    return null;
  } catch (error) {
    const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
    diagnostic(timeout ? (hop > 0 ? 'destination_timeout' : 'timeout') : 'request_error');
    return null;
  }
}
