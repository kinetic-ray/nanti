import { resolve4 } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList } from 'node:net';
import { Readable } from 'node:stream';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

type Price = { amount: number; currency: 'IDR' };
type Diagnostic = (reason: string, host: string, status?: number) => void;
type PageRequest = (url: URL, signal: AbortSignal) => Promise<Response>;

export interface ProductMetadata {
  source: 'tokopedia';
  originalUrl: string;
  productUrl: string;
  title: string | null;
  price: Price | null;
  imageUrl: string | null;
  storeName: string | null;
}

const listingHosts = new Set(['www.tokopedia.com', 'tokopedia.com']);
const shortHosts = new Set(['tokopedia.link', 'www.tokopedia.link', 'tk.tokopedia.com', 'vt.tokopedia.com']);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const maxBytes = 1024 * 1024;
const imageHosts = /(^|\.)(tokopedia\.net|tokopedia-static\.net|tokopedia\.com|tiktokcdn\.com|ibytedtos\.com)$/;
const maxImageBytes = 195_000;
const privateAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) privateAddresses.addSubnet(network, prefix);

export async function requestPublicPage(url: URL, signal: AbortSignal, accept = 'text/html'): Promise<Response> {
  signal.throwIfAborted();
  // DNS resolution does not take an AbortSignal. Enforce the same deadline before TLS starts.
  const addresses = await new Promise<string[]>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    resolve4(url.hostname).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
  signal.throwIfAborted();
  const address = addresses[0];
  if (!address || addresses.some((ip) => privateAddresses.check(ip))) throw new Error('Non-public DNS answer');
  // Pin the checked address while retaining the original hostname for TLS and Host.
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      agent: false, hostname: address, servername: url.hostname, signal,
      headers: { Host: url.hostname, Accept: accept, 'Accept-Encoding': 'identity', 'User-Agent': 'Nanti/1.0' },
    }, (incoming) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(key, value);
      }
      const status = incoming.statusCode ?? 502;
      if (status !== 200) {
        incoming.destroy();
        resolve(new Response(null, { status, headers }));
        return;
      }
      const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      resolve(new Response(body, { status, headers }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

function safeHttps(value: string, base?: URL): URL | null {
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
  } catch {
    return null;
  }
}

function listingKey(url: URL): string | null {
  const path = url.pathname.replace(/\/$/, '');
  if (!listingHosts.has(url.hostname) || !/^\/[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_-]*$/i.test(path)) return null;
  return path;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function tagged(value: unknown, type: string): boolean {
  return [value].flat().some((entry) => entry === type || entry === 'https://schema.org/' + type);
}

function exactPrice(value: unknown, currency: unknown): Price | null {
  if (currency !== 'IDR' || (typeof value !== 'number' && typeof value !== 'string') ||
      !/^\d+(?:\.0+)?$/.test(String(value))) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount * 100 <= 2_147_483_647 ? { amount, currency } : null;
}

function rupiahDisplay(value: string): Price | null {
  const normalized = value.replace(/[\u00a0\u202f]/gu, ' ').trim();
  const match = /^Rp\s*((?:\d{1,3}(?:\.\d{3})+)|\d+)$/iu.exec(normalized);
  if (!match?.[1]) return null;
  return exactPrice(Number(match[1].replace(/\./gu, '')), 'IDR');
}

function renderedProductPrice(html: string): Price | null {
  const document = parse(html);
  const candidates = new Map<number, Price>();
  const misleading = /(?:voucher|cashback|installment|angsuran|shipping|delivery|ongkir|original|strike|slash|old[-_ ]?price|discount[-_ ]?badge|saving)/iu;
  const stack: DefaultTreeAdapterTypes.ChildNode[] = [...document.childNodes];
  const textContent = (node: DefaultTreeAdapterTypes.ChildNode): string => {
    if ('value' in node) return node.value;
    if ('childNodes' in node) return node.childNodes.map(textContent).join('');
    return '';
  };
  while (stack.length) {
    const node = stack.pop()!;
    if (!('tagName' in node)) continue;
    for (const child of node.childNodes) stack.push(child);
    const attrs = new Map(node.attrs.map(({ name, value }) => [name.toLowerCase(), value]));
    const testId = attrs.get('data-testid') ?? attrs.get('data-qa') ?? '';
    const className = attrs.get('class') ?? '';
    const selector = attrs.get('itemprop') === 'price' ||
      /(?:pdp|product)[-_ ]?.*price|price.*(?:pdp|product)/iu.test(testId) ||
      /(?:^|[\s_-])(?:pdp|product)[_-]?price(?:$|[\s_-])/iu.test(className);
    if (!selector || /^(script|style|template|noscript)$/iu.test(node.tagName) || misleading.test(testId + ' ' + className)) continue;
    let ancestor: DefaultTreeAdapterTypes.ParentNode | null = node;
    let hidden = false;
    while (ancestor && 'tagName' in ancestor) {
      const parentAttrs = new Map(ancestor.attrs.map(({ name, value }) => [name.toLowerCase(), value]));
      const style = parentAttrs.get('style') ?? '';
      if (parentAttrs.has('hidden') || parentAttrs.get('aria-hidden') === 'true' ||
          /display\s*:\s*none|visibility\s*:\s*hidden/iu.test(style) ||
          misleading.test((parentAttrs.get('data-testid') ?? '') + ' ' + (parentAttrs.get('class') ?? ''))) {
        hidden = true;
        break;
      }
      ancestor = ancestor.parentNode;
    }
    if (hidden) continue;
    const price = rupiahDisplay(attrs.get('content') ?? textContent(node));
    if (price) candidates.set(price.amount, price);
  }
  return candidates.size === 1 ? [...candidates.values()][0] ?? null : null;
}

function image(value: unknown, base: URL): string | null {
  for (const entry of [value].flat()) {
    const candidate = text(entry) ?? text(record(entry)?.contentUrl) ?? text(record(entry)?.url);
    const url = candidate && safeHttps(candidate, base);
    if (url && imageHosts.test(url.hostname) &&
        !/placeholder|default[-_]?image/i.test(url.pathname)) return url.href;
  }
  return null;
}

// Tokopedia's desktop PDP publishes a normalized cache as a JSON assignment.
function parsePdpCache(script: string, url: URL) {
  const json = /^[ \t]*window\.__cache[ \t]*=[ \t]*(\{[^\r\n]*\});[ \t]*\r?$/m.exec(script)?.[1];
  const path = listingKey(url);
  if (!json || !path) return null;
  const cache = record(JSON.parse(json));
  const query = record(cache?.ROOT_QUERY);
  if (!cache || !query) return null;
  const [, shop, slug] = path.split('/');
  const resolve = (value: unknown, typename: string) => {
    const ref = record(value);
    const id = text(ref?.id);
    if (ref?.type !== 'id' || ref.typename !== typename || !id || !Object.hasOwn(cache, id)) return undefined;
    const entity = record(cache[id]);
    return entity?.__typename === typename ? entity : undefined;
  };

  const queries = Object.keys(query).filter((key) => {
    if (!key.startsWith('pdpMainInfo(') || !key.endsWith(')')) return false;
    try {
      const args = record(JSON.parse(key.slice('pdpMainInfo('.length, -1)));
      return args?.shopDomain === shop && args?.productKey === slug;
    } catch {
      return false;
    }
  });
  if (queries.length !== 1 || !queries[0]) return null;
  const entry = resolve(query[queries[0]], 'pdpMainInfo');
  const data = resolve(entry?.data, 'pdpMainInfoData');
  const basic = resolve(data?.basicInfo, 'pdpBasicInfo');
  const reference = text(basic?.url);
  const listing = reference && safeHttps(reference, url);
  if (!listing || listingKey(listing) !== path) return null;

  const components = Array.isArray(entry?.components)
    ? entry.components.map((ref) => resolve(ref, 'pdpComponent')) : [];
  const rows = (name: string) => components.flatMap((component) =>
    component?.name === name && Array.isArray(component.data) ? component.data : []);
  const contentRows = rows('product_content');
  const content = contentRows.length === 1 ? resolve(contentRows[0], 'pdpDataProductContent') : undefined;
  const variant = resolve(content?.variant, 'pdpContentSnapshotVariant');
  const variantOptions = components.filter((component) => component?.name === 'variant_options');
  const ambiguousPrice = variant?.isVariant === true || rows('variant_options').length > 0;
  const cachedPrice = resolve(content?.price, 'pdpContentSnapshotPrice');
  const formatted = rupiahDisplay(text(cachedPrice?.priceFmt) ?? '');
  const amount = exactPrice(cachedPrice?.value, 'IDR');
  const price = !ambiguousPrice && variant?.isVariant === false && variantOptions.length === 1 &&
    Array.isArray(variantOptions[0]?.data) && formatted && amount?.amount === formatted.amount &&
    (cachedPrice?.currency === 'UNKNOWN' || cachedPrice?.currency === 'IDR') ? amount : null;
  const media = rows('product_media').flatMap((ref) => {
    const gallery = resolve(ref, 'pdpDataProductMedia')?.media;
    return Array.isArray(gallery) ? gallery : [];
  });
  const photos = media.map((ref) => resolve(ref, 'pdpContentSnapshotMedia'))
    .filter((item) => item?.type === 'image').map((item) => item?.URLOriginal);

  return { title: text(content?.name), storeName: text(basic?.shopName), imageUrl: image(photos, url), price, ambiguousPrice };
}

function localGraphResolver(entries: unknown[], url: URL) {
  const listing = listingKey(url);
  const keyFor = (value: unknown) => {
    const id = text(value);
    const reference = id && safeHttps(id, url);
    return listing && reference && listingKey(reference) === listing && (!reference.search || reference.search === url.search)
      ? reference.hash || null : null;
  };
  const nodes = new Map<string, Record<string, unknown> | null>();
  for (const entry of entries) {
    const node = record(entry);
    const key = keyFor(node?.['@id']);
    if (node && key) nodes.set(key, nodes.has(key) ? null : node);
  }
  return (value: unknown): Record<string, unknown> | undefined => {
    const node = record(value);
    if (!node || Object.keys(node).length !== 1 || !('@id' in node)) return node;
    const key = keyFor(node['@id']);
    return key ? nodes.get(key) ?? undefined : undefined;
  };
}

type MetadataResult = { metadata: ProductMetadata } | { issue: string };

function parseMetadata(html: string, url: URL, originalUrl: string): MetadataResult {
  const identity = listingKey(url);
  const matches = (candidate: string) => {
    const reference = safeHttps(candidate, url);
    return identity !== null && reference !== null && listingKey(reference) === identity;
  };
  const hasDifferentQuery = (candidate: string | null) => {
    const query = candidate ? safeHttps(candidate, url)?.search : undefined;
    return Boolean(query && query !== url.search);
  };
  const tags = new Map<string, string[]>();
  const pageUrls: string[] = [];
  const products: { product: Record<string, unknown>; resolve: ReturnType<typeof localGraphResolver> }[] = [];
  let state: Record<string, unknown> | undefined;
  let hydration: ReturnType<typeof parsePdpCache> = null;
  let hydrationSeen = false;
  let hasReferencedProduct = false;
  let malformed = false;
  let pageIssue: string | undefined;
  let headingIssue: string | undefined;
  let hasVariants = false;
  const nodes: DefaultTreeAdapterTypes.ChildNode[] = [...parse(html).childNodes];
  while (nodes.length) {
    const node = nodes.pop()!;
    if ('childNodes' in node) {
      for (const child of [...node.childNodes].reverse()) nodes.push(child);
    }
    if (!('tagName' in node)) continue;
    const attr = (name: string) => node.attrs.find((entry) => entry.name === name)?.value;
    const inHead = node.parentNode && 'tagName' in node.parentNode && node.parentNode.tagName === 'head';
    if ((node.tagName === 'title' && inHead) || node.tagName === 'h1') {
      const label = node.childNodes.map(child => 'value' in child ? child.value : '').join('').trim();
      const issue = /^(verify (that )?you are human|captcha|human verification)[.!]?$/iu.test(label) ? 'captcha_required' :
        /^(access denied|request blocked|akses ditolak|forbidden)[.!]?$/iu.test(label) ? 'access_blocked' :
        /^(too many requests|rate limit exceeded)[.!]?$/iu.test(label) ? 'rate_limited' : undefined;
      if (node.tagName === 'title') pageIssue ??= issue;
      else headingIssue ??= issue;
    }
    if (node.tagName === 'form' && /^(captcha-form|challenge-form)$/iu.test(attr('id') ?? '')) pageIssue = 'captcha_required';
    if (node.tagName === 'meta' && inHead) {
      const key = (attr('property') ?? attr('name'))?.toLowerCase();
      const value = text(attr('content'));
      if (key && value) {
        const values = tags.get(key) ?? [];
        values.push(value);
        tags.set(key, values);
      }
    }
    if (node.tagName === 'link' && inHead && attr('rel')?.toLowerCase().split(/\s+/).includes('canonical')) {
      const href = text(attr('href'));
      if (href) pageUrls.push(href);
    }
    if (node.tagName !== 'script') continue;
    const jsonLd = attr('type')?.toLowerCase() === 'application/ld+json';
    const nextData = attr('id') === '__NEXT_DATA__' && attr('type')?.toLowerCase() === 'application/json';
    const data = node.childNodes[0];
    if (!data || !('value' in data)) continue;
    try {
      if (!jsonLd && !nextData) {
        if (attr('type')?.toLowerCase() === 'text/javascript' && /window\.__cache\s*=/.test(data.value)) {
          hydrationSeen = true;
          hydration ??= parsePdpCache(data.value, url);
        }
        continue;
      }
      const parsed: unknown = JSON.parse(data.value);
      if (nextData) {
        const props = record(record(parsed)?.props);
        const page = record(record(props?.pageProps)?.data);
        const layout = record(page?.pdpGetLayout);
        const basic = record(layout?.basicInfo);
        const productUrl = text(basic?.url);
        if (productUrl && matches(productUrl)) state = layout;
      } else {
        const entries = [parsed].flat().flatMap(root => {
          const graph = record(root)?.['@graph'];
          return [root, ...(Array.isArray(graph) ? graph : [])];
        });
        const resolve = localGraphResolver(entries, url);
        const primary = new Set<unknown>();
        for (const entry of entries) {
          const page = record(entry);
          const reference = text(page?.url) ?? text(page?.['@id']);
          if (page && tagged(page['@type'], 'WebPage') && reference && matches(reference)) {
            const entity = resolve(page.mainEntity);
            if (entity) primary.add(entity);
          }
        }
        for (const entry of new Set([...entries, ...primary])) {
          const product = record(entry);
          if (!product) continue;
          const reference = text(product.url) ?? text(product['@id']);
          const isListing = reference ? matches(reference) : primary.has(product);
          if (isListing && tagged(product['@type'], 'ProductGroup')) hasVariants = true;
          if (!tagged(product['@type'], 'Product')) continue;
          if (reference) hasReferencedProduct = true;
          if (isListing) {
            hasVariants ||= product.isVariantOf != null || hasDifferentQuery(reference);
            products.push({ product, resolve });
          }
        }
      }
    } catch {
      malformed = true;
    }
  }

  pageUrls.push(...(tags.get('og:url') ?? []));
  if (pageIssue) return { issue: pageIssue };
  if (headingIssue && !products.length && !state && !hydration) return { issue: headingIssue };
  if (pageUrls.some((value) => !matches(value)) || (!products.length && !state && !hydration && hasReferencedProduct)) {
    return { issue: 'listing_mismatch' };
  }
  if (!products.length && !state && !hydration && !pageUrls.length) {
    return { issue: malformed ? 'metadata_malformed' : 'metadata_missing' };
  }
  const firstTag = (key: string) => tags.get(key)?.[0];
  const basic = record(state?.basicInfo);
  const title = products.map(({ product }) => text(product.name)).find(Boolean) ?? text(firstTag('og:title')) ?? text(firstTag('twitter:title')) ?? text(basic?.name) ?? hydration?.title ?? null;
  const imageUrl = image(tags.get('og:image'), url) ?? image(tags.get('og:image:secure_url'), url) ??
    image(tags.get('twitter:image'), url) ?? image(tags.get('twitter:image:src'), url) ??
    products.map(({ product, resolve }) => image([product.image].flat().map(value => resolve(value) ?? value), url)).find(Boolean) ??
    image(basic?.image, url) ?? hydration?.imageUrl ?? null;

  const sellers = new Set<string>();
  if (hydration?.storeName) sellers.add(hydration.storeName);
  const jsonLdPrices: Price[] = [];
  let jsonLdOfferSeen = false;
  let jsonLdAmbiguous = false;
  for (const { product, resolve } of products) {
    if (product.offers == null) continue;
    jsonLdOfferSeen = true;
    const offers = [product.offers].flat();
    if (offers.length !== 1) jsonLdAmbiguous = true;
    for (const entry of offers) {
      const offer = resolve(entry);
      const reference = text(offer?.url);
      if (reference && (!matches(reference) || hasDifferentQuery(reference))) { jsonLdAmbiguous = true; continue; }
      const price = offer && tagged(offer['@type'], 'Offer') && offer.lowPrice == null && offer.highPrice == null
        ? exactPrice(offer.price, offer.priceCurrency) : null;
      if (price) jsonLdPrices.push(price);
      else jsonLdAmbiguous = true;
      const seller = text(resolve(offer?.seller)?.name);
      if (seller) sellers.add(seller);
    }
  }
  const amounts = tags.get('product:price:amount') ?? [];
  const currencies = tags.get('product:price:currency') ?? [];
  const stateSeller = text(record(record(state?.shopInfo)?.shopCore)?.name);
  if (stateSeller) sellers.add(stateSeller);
  const exactPageIdentity = pageUrls.some(matches) || products.length > 0 || Boolean(state || hydration);
  const blockedByVariants = hasVariants || Boolean(hydration?.ambiguousPrice);
  const jsonLdPrice = jsonLdOfferSeen && !jsonLdAmbiguous && jsonLdPrices.length > 0 &&
    jsonLdPrices.every(({ amount }) => amount === jsonLdPrices[0]?.amount) ? jsonLdPrices[0] ?? null : null;
  const hasPriceTag = amounts.length > 0 || currencies.length > 0;
  const taggedPrice = hasPriceTag && amounts.length === 1 && currencies.length === 1
    ? exactPrice(amounts[0], currencies[0] === 'Rp' ? 'IDR' : currencies[0]) : null;
  const conflictingPublishedPrices = Boolean(jsonLdPrice && taggedPrice && jsonLdPrice.amount !== taggedPrice.amount);
  // Tokopedia's PDP cache exposes the current selling price separately from slashPriceFmt,
  // discount badges, vouchers, and installment copy. It outranks social tags that can lag.
  const price = blockedByVariants ? null : hydration?.price ??
    (jsonLdOfferSeen ? (conflictingPublishedPrices ? null : jsonLdPrice) : null) ??
    (!jsonLdOfferSeen && !hasPriceTag && !hydrationSeen && exactPageIdentity ? renderedProductPrice(html) : null) ??
    (!jsonLdOfferSeen && !hydrationSeen && exactPageIdentity ? taggedPrice : null);
  const storeName = sellers.size === 1 ? [...sellers][0] ?? null : null;
  if (!title && !price && !imageUrl && !storeName) return { issue: malformed ? 'metadata_malformed' : 'metadata_missing' };
  return { metadata: { source: 'tokopedia', originalUrl, productUrl: 'https://www.tokopedia.com' + identity, title, price, imageUrl, storeName } };
}

async function readHtml(response: Response): Promise<{ html: string } | { issue: string }> {
  const encoding = response.headers.get('content-encoding');
  const issue = encoding && encoding.toLowerCase() !== 'identity' ? 'unsupported_encoding' :
    Number(response.headers.get('content-length')) > maxBytes ? 'response_too_large' : !response.body ? 'empty_response' : null;
  if (issue || !response.body) {
    void response.body?.cancel().catch(() => {});
    return { issue: issue ?? 'empty_response' };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return bytes ? { html: html + decoder.decode() } : { issue: 'empty_response' };
      bytes += value.byteLength;
      if (bytes > maxBytes) return { issue: 'response_too_large' };
      html += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function tokopediaHttpIssue(response: Response, shortLink: boolean) {
  if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') return 'captcha_required';
  switch (response.status) {
    case 200: return null;
    case 401: return 'authentication_required';
    case 403: return 'access_blocked';
    case 404:
    case 410: return shortLink ? 'short_link_unavailable' : 'listing_unavailable';
    case 429: return 'rate_limited';
    default: return 'http_failure';
  }
}

/** Extract from an authorized public listing. An optional transport is for trusted callers and fixtures. */
export async function extractTokopediaMetadata(originalUrl: string, transport: PageRequest = requestPublicPage,
  onDiagnostic?: Diagnostic): Promise<ProductMetadata | null> {
  if (originalUrl.length > 4096) return null;
  let current = safeHttps(originalUrl);
  let identity = current && listingKey(current);
  const controller = new AbortController();
  let host = current?.hostname ?? '';
  let hop = 0;
  const fail = (reason: string, status?: number) => {
    onDiagnostic?.(reason, host, status);
    return null;
  };
  const timeoutReason = () => hop > 0 ? 'destination_timeout' : 'timeout';
  const allowed = (url: URL) => {
    const key = listingKey(url);
    return url.href.length <= 4096 && (identity ? key === identity : Boolean(key) || shortHosts.has(url.hostname));
  };
  const extract = async () => {
    if (!current || !allowed(current)) return fail('redirect_disallowed');
    const visited = new Set<string>();
    for (; current && hop <= 4; hop++) {
      controller.signal.throwIfAborted();
      host = current.hostname;
      current.hash = '';
      const key = listingKey(current);
      identity ??= key;
      if (visited.has(current.href)) return fail('redirect_limit');
      visited.add(current.href);
      const response = await transport(current, controller.signal);
      if (redirectStatuses.has(response.status)) {
        const location = response.headers.get('location');
        void response.body?.cancel().catch(() => {});
        if (!location) return fail('redirect_missing_location', response.status);
        const next = safeHttps(location, current);
        if (!next || !allowed(next)) return fail('redirect_disallowed', response.status);
        current = next;
        continue;
      }
      const issue = tokopediaHttpIssue(response, shortHosts.has(current.hostname)) ??
        (!/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') ? 'not_html' : null);
      if (issue) {
        void response.body?.cancel().catch(() => {});
        return fail(issue, response.status);
      }
      const page = await readHtml(response);
      if ('issue' in page) return fail(page.issue, response.status);
      const result = parseMetadata(page.html, current, originalUrl);
      if (!key) {
        const reason = 'issue' in result && ['captcha_required', 'access_blocked', 'rate_limited'].includes(result.issue)
          ? result.issue : 'short_link_unresolved';
        return fail(reason, response.status);
      }
      return 'issue' in result ? fail(result.issue, response.status) : result.metadata;
    }
    return fail('redirect_limit');
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(fail(timeoutReason()));
    }, 5000);
  });
  try {
    return await Promise.race([extract().catch((error: unknown) => controller.signal.aborted ? null :
      fail(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? timeoutReason() : 'request_error')), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function boundedJpeg(bytes: Buffer) {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 ||
      bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return false;

  let frame = false;
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes[offset] !== 0xff) return false;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end >= bytes.length) return false;
    if (marker === 0xda) return frame && length >= 8 && end < bytes.length - 2;
    if (marker === 0xc0 || marker === 0xc2) {
      if (frame || length < 11 || bytes[offset + 4] !== 8) return false;
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      if (!width || !height || width > 1600 || height > 1600) return false;
      frame = true;
    }
    offset = end;
  }
  return false;
}

export async function downloadTokopediaImage(value: string, transport: PageRequest =
  (url, signal) => requestPublicPage(url, signal, 'image/jpeg')): Promise<Buffer | null> {
  const url = value.length <= 2048 ? safeHttps(value) : null;
  if (!url || !imageHosts.test(url.hostname)) return null;
  return downloadMarketplaceJpeg(url, transport);
}

export function downloadShopeeImage(value: string): Promise<Buffer | null> {
  return downloadMarketplaceImage('shopee', value);
}

export function downloadMarketplaceImage(merchant: 'tokopedia' | 'shopee', value: string, transport: PageRequest =
  (url, signal) => requestPublicPage(url, signal, 'image/jpeg,image/png,image/webp')): Promise<Buffer | null> {
  const url = value.length <= 2048 ? safeHttps(value) : null;
  const hosts = merchant === 'tokopedia' ? imageHosts : /(^|\.)susercontent\.com$|^cf\.shopee\.co\.id$/u;
  return url && hosts.test(url.hostname) ? downloadMarketplaceJpeg(url, transport, true) : Promise.resolve(null);
}

async function downloadMarketplaceJpeg(url: URL, transport: PageRequest, allowRasterFormats = false): Promise<Buffer | null> {
  const signal = AbortSignal.timeout(4000);
  try {
    const response = await Promise.race([
      transport(url, signal),
      new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    ]);
    // CDN URLs are expected to be final. Never fetch an image redirect.
    const allowedTypes = allowRasterFormats ? /^image\/(jpeg|png|webp)(?:\s*;|$)/i : /^image\/jpeg(?:\s*;|$)/i;
    if (response.status !== 200 || !allowedTypes.test(response.headers.get('content-type') ?? '') ||
        Number(response.headers.get('content-length')) > maxImageBytes || !response.body) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value: chunk, done } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += chunk.byteLength;
        if (size > maxImageBytes) return null;
        chunks.push(chunk);
      }
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks, size);
    return allowRasterFormats || boundedJpeg(bytes) ? bytes : null;
  } catch {
    return null;
  }
}
