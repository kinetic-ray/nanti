import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, vi } from 'vitest';
import { extractTokopediaMetadata } from '../server/tokopedia-metadata.js';

const product = 'https://www.tokopedia.com/shop/lamp';
const affiliate = 'https://tokopedia.link/abc?ref=123#saved';
const fixture = (name: string) => readFileSync(new URL('./fixtures/tokopedia/' + name + '.html', import.meta.url), 'utf8');
const html = (name: string) => new Response(fixture(name), { headers: { 'content-type': 'text/html' } });
const load = (name: string) => extractTokopediaMetadata(product, async () => html(name));

test('extracts exact listing metadata from Open Graph and JSON-LD', async () => {
  assert.deepEqual(await load('complete'), {
    source: 'tokopedia', originalUrl: product, productUrl: product, title: 'Lamp & Stand',
    price: { amount: 125000, currency: 'IDR' }, imageUrl: 'https://images.tokopedia.net/img/lamp.jpg',
    storeName: 'Lamp Shop',
  });
});
test('leaves a missing image null', async () => {
  const result = await load('missing-image');
  assert.equal(result?.title, 'Lamp');
  assert.equal(result?.imageUrl, null);
});
test('keeps an ambiguous price null even with a social price tag', async () => {
  assert.equal((await load('ambiguous'))?.price, null);
});
test('ignores other listings and GraphQL search results', async () => {
  assert.equal(await load('wrong-product'), null);
});
test('returns null for a blocked HTML page', async () => {
  assert.equal(await load('blocked'), null);
});
test('uses embedded state with an exact product URL', async () => {
  const result = await load('state');
  assert.equal(result?.storeName, 'Lamp Shop');
  assert.equal(result?.imageUrl, 'https://images.tokopedia.net/img/lamp.jpg');
});
test('preserves the original affiliate URL through an allowed redirect', async () => {
  const result = await extractTokopediaMetadata(affiliate, async (url) => url.hostname === 'tokopedia.link'
    ? new Response(fixture('redirect'), { status: 302, headers: { location: product + '?utm_source=affiliate' } })
    : html('complete'));
  assert.equal(result?.originalUrl, affiliate);
  assert.equal(result?.productUrl, product);
});
test('rejects unsafe redirects and direct listing identity changes before fetching', async () => {
  for (const location of ['https://127.0.0.1/', 'https://evil.tokopedia.com/shop/lamp',
    'https://www.tokopedia.com:8443/shop/lamp', '/shop/other']) {
    const requests: string[] = [];
    assert.equal(await extractTokopediaMetadata(product, async (url) => {
      requests.push(url.href);
      return new Response(fixture('redirect'), { status: 302, headers: { location } });
    }), null);
    assert.deepEqual(requests, [product]);
  }
});
test('rejects oversized HTML', async () => {
  assert.equal(await extractTokopediaMetadata(product, async () =>
    new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'text/html' } })), null);
});

test('shares one timeout across redirect hops and aborts a stalled request', async () => {
  vi.useFakeTimers();
  try {
    let signal: AbortSignal | undefined;
    const pending = extractTokopediaMetadata(affiliate, async (url, requestSignal) => {
      if (url.hostname === 'tokopedia.link') {
        return new Response(fixture('redirect'), { status: 302, headers: { location: product } });
      }
      signal = requestSignal;
      return new Promise<Response>(() => {});
    });
    await vi.advanceTimersByTimeAsync(5000);
    assert.equal(await pending, null);
    assert.equal(signal?.aborted, true);
  } finally {
    vi.useRealTimers();
  }
});

test('extracts the exact non-variant price and seller from a captured PDP response', async () => {
  const url = 'https://www.tokopedia.com/lenovo-authorized-surabaya/charger-innergie-by-delta-180w-gaming-adaptor-laptop-universal-t18';
  const result = await extractTokopediaMetadata(url, async () => html('live-single'));
  assert.match(result?.title ?? '', /Charger INNERGIE/);
  assert.deepEqual(result?.price, { amount: 1735000, currency: 'IDR' });
  assert.equal(result?.storeName, 'Lenovo Authorized Surabaya');
  assert.equal(result?.imageUrl, 'https://images.tokopedia.net/fixtures/live-single.jpg');
});

test('retains the seller and leaves price null for a captured variant listing', async () => {
  const url = 'https://www.tokopedia.com/byfrags/byfrags-travel-size-5ml-decant-best-for-explore-1738205440494437853';
  const result = await extractTokopediaMetadata(affiliate, async (target) => target.hostname === 'tokopedia.link'
    ? new Response(null, { status: 302, headers: { location: url } })
    : html('live-variant'));
  assert.equal(result?.originalUrl, affiliate);
  assert.equal(result?.productUrl, url);
  assert.equal(result?.storeName, 'ByFrags');
  assert.equal(result?.imageUrl, 'https://images.tokopedia.net/fixtures/live-variant.jpg');
  assert.equal(result?.price, null);
});

test('uses the referenced PDP gallery when the captured social image is absent', async () => {
  const url = 'https://www.tokopedia.com/lenovo-authorized-surabaya/charger-innergie-by-delta-180w-gaming-adaptor-laptop-universal-t18';
  const body = fixture('live-single').replace(/^<meta property="og:image".*\r?\n/m, '');
  const result = await extractTokopediaMetadata(url, async () =>
    new Response(body, { headers: { 'content-type': 'text/html' } }));
  assert.equal(result?.imageUrl, 'https://images.tokopedia.net/fixtures/live-single-gallery.jpg');
});

test('withholds an exact price when social and hydrated amounts disagree', async () => {
  const url = 'https://www.tokopedia.com/lenovo-authorized-surabaya/charger-innergie-by-delta-180w-gaming-adaptor-laptop-universal-t18';
  const body = fixture('live-single').replace('property="product:price:amount" content="1735000"', 'property="product:price:amount" content="999"');
  const result = await extractTokopediaMetadata(url, async () =>
    new Response(body, { headers: { 'content-type': 'text/html' } }));
  assert.equal(result?.storeName, 'Lenovo Authorized Surabaya');
  assert.equal(result?.price, null);
});

test('rejects hydration from a different PDP even with matching social metadata', async () => {
  const url = 'https://www.tokopedia.com/lenovo-authorized-surabaya/charger-innergie-by-delta-180w-gaming-adaptor-laptop-universal-t18';
  const body = fixture('live-single').replace('"url":"' + url + '"', '"url":"https://www.tokopedia.com/other/shop-item"');
  const result = await extractTokopediaMetadata(url, async () =>
    new Response(body, { headers: { 'content-type': 'text/html' } }));
  assert.match(result?.title ?? '', /Charger INNERGIE/);
  assert.equal(result?.storeName, null);
  assert.equal(result?.price, null);
});

test('reads the exact product and its linked image, offer and seller from a JSON-LD graph', async () => {
  const graph = [
    { '@type': 'WebPage', url: product, mainEntity: { '@type': 'Product', name: 'Desk lamp',
      offers: { '@id': '#offer' }, image: [{ '@id': '#remote' }, { '@id': '#photo' }] } },
    { '@type': 'ImageObject', '@id': '#remote', contentUrl: 'https://unrelated.invalid/photo.jpg' },
    { '@type': 'ImageObject', '@id': product + '#photo', contentUrl: 'https://images.tokopedia.net/img/lamp.jpg' },
    { '@type': 'Offer', '@id': '#offer', price: '199000', priceCurrency: 'IDR', seller: { '@id': '#store' } },
    { '@type': 'Organization', '@id': '#store', name: 'Lamp Shop' },
    { '@type': 'Product', url: 'https://www.tokopedia.com/shop/other', name: 'Other lamp' },
  ];
  const transport = vi.fn(async () => new Response(graphHtml(graph), { headers: { 'content-type': 'text/html' } }));
  const result = await extractTokopediaMetadata(product, transport);
  assert.deepEqual(result, {
    source: 'tokopedia', originalUrl: product, productUrl: product, title: 'Desk lamp',
    price: { amount: 199000, currency: 'IDR' }, imageUrl: 'https://images.tokopedia.net/img/lamp.jpg', storeName: 'Lamp Shop',
  });
  assert.equal(transport.mock.calls.length, 1);
});

function graphHtml(entries: unknown[]) {
  return '<script type="application/ld+json">' + JSON.stringify({ '@graph': entries }) + '</script>';
}

test('keeps an exact PDP cache entry when another query key is malformed', async () => {
  const url = 'https://www.tokopedia.com/lenovo-authorized-surabaya/charger-innergie-by-delta-180w-gaming-adaptor-laptop-universal-t18';
  const body = fixture('live-single').replace('"ROOT_QUERY":{', '"ROOT_QUERY":{"pdpMainInfo(invalid)":null,');
  const result = await extractTokopediaMetadata(url, async () =>
    new Response(body, { headers: { 'content-type': 'text/html' } }));
  assert.deepEqual(result?.price, { amount: 1735000, currency: 'IDR' });
  assert.equal(result?.storeName, 'Lenovo Authorized Surabaya');
});

test('ignores cross-listing graph references and ambiguous duplicate graph IDs', async () => {
  const body = graphHtml([
    { '@type': 'Product', url: product, name: 'Desk lamp', offers: { '@id': 'https://www.tokopedia.com/shop/other#offer' },
      image: { '@id': '#image' } },
    { '@type': 'Offer', '@id': 'https://www.tokopedia.com/shop/other#offer', price: '1', priceCurrency: 'IDR' },
    { '@type': 'ImageObject', '@id': '#image', contentUrl: 'https://images.tokopedia.net/img/first.jpg' },
    { '@type': 'ImageObject', '@id': '#image', contentUrl: 'https://images.tokopedia.net/img/second.jpg' },
  ]);
  const result = await extractTokopediaMetadata(product, async () =>
    new Response(body, { headers: { 'content-type': 'text/html' } }));
  assert.equal(result?.title, 'Desk lamp');
  assert.equal(result?.price, null);
  assert.equal(result?.imageUrl, null);
});

test('keeps the original URL through legitimate multi-hop redirects to the exact listing', async () => {
  const original = 'https://tokopedia.link/fixture?ref=one#saved';
  const redirect = 'https://tk.tokopedia.com/short';
  const requested: string[] = [];
  const result = await extractTokopediaMetadata(original, async (url) => {
    requested.push(url.href);
    if (url.href === product + '?utm_source=sharing') return html('complete');
    return new Response(null, { status: 302, headers: {
      location: url.hostname === 'tokopedia.link' ? redirect : product + '?utm_source=sharing',
    } });
  });
  assert.deepEqual(requested, [original.split('#')[0], redirect, product + '?utm_source=sharing']);
  assert.equal(result?.originalUrl, original);
  assert.equal(result?.productUrl, product);
});

test.each([
  { code: 'access_blocked', status: 403, body: '', url: product },
  { code: 'access_blocked', status: 200, body: fixture('blocked'), url: product },
  { code: 'captcha_required', status: 200, body: '<title>Verify you are human</title>' + fixture('complete'), url: product },
  { code: 'authentication_required', status: 401, body: '', url: product },
  { code: 'rate_limited', status: 429, body: '', url: product },
  { code: 'short_link_unavailable', status: 404, body: '', url: affiliate },
  { code: 'short_link_unavailable', status: 410, body: '', url: affiliate },
  { code: 'listing_unavailable', status: 404, body: '', url: product },
  { code: 'short_link_unresolved', status: 200, body: '<meta http-equiv="refresh" content="0; URL=/another">', url: affiliate },
  { code: 'metadata_malformed', status: 200, body: '<script type="application/ld+json">{bad</script>', url: product },
  { code: 'metadata_missing', status: 200, body: '<html></html>', url: product },
  { code: 'listing_mismatch', status: 200, body: fixture('wrong-product'), url: product },
  { code: 'response_too_large', status: 200, body: 'a'.repeat(1024 * 1024 + 1), url: product },
])('reports $code for HTTP $status and stops the lookup', async ({ code, status, body, url }) => {
  const diagnostic = vi.fn();
  const transport = vi.fn(async () => new Response(body, { status, headers: { 'content-type': 'text/html' } }));
  assert.equal(await extractTokopediaMetadata(url, transport, diagnostic), null);
  assert.deepEqual(diagnostic.mock.calls, [[code, new URL(url).hostname, status]]);
  assert.equal(transport.mock.calls.length, 1);
});

test('reports a network failure without publishing the underlying error message', async () => {
  const diagnostic = vi.fn();
  assert.equal(await extractTokopediaMetadata(product, async () => { throw new Error('private connection details'); }, diagnostic), null);
  assert.deepEqual(diagnostic.mock.calls, [['request_error', 'www.tokopedia.com', undefined]]);
});

test('resolves linked nodes in a flattened JSON-LD array without fetching references', async () => {
  const data = [
    { '@type': 'Product', url: product, name: 'Lamp', image: { '@id': '#photo' }, offers: { '@id': '#offer' } },
    { '@type': 'ImageObject', '@id': '#photo', contentUrl: 'https://images.tokopedia.net/fixture/lamp.jpg' },
    { '@type': 'Offer', '@id': '#offer', price: '12000', priceCurrency: 'IDR', seller: { name: 'Lamp Shop' } },
  ];
  const transport = vi.fn(async () => new Response('<script type="application/ld+json">' + JSON.stringify(data) + '</script>', {
    headers: { 'content-type': 'text/html' },
  }));
  const result = await extractTokopediaMetadata(product, transport);
  assert.equal(result?.imageUrl, data[1]?.contentUrl);
  assert.deepEqual(result?.price, { amount: 12000, currency: 'IDR' });
  assert.equal(result?.storeName, 'Lamp Shop');
  assert.equal(transport.mock.calls.length, 1);
});

test('preserves verified product metadata when a product heading resembles a block page', async () => {
  const body = '<h1>Access Denied</h1>' + graphHtml([{ '@type': 'Product', url: product, name: 'Access Denied' }]);
  const result = await extractTokopediaMetadata(product, async () =>
    new Response(body, { headers: { 'content-type': 'text/html' } }));
  assert.equal(result?.title, 'Access Denied');
});

test.each([
  [{ '@type': 'Product', url: product, name: 'Lamp',
    offers: { '@type': 'Offer', url: product + '?variant=blue', price: '12000', priceCurrency: 'IDR' } }],
  [{ '@type': 'ProductGroup', url: product, hasVariant: [{ '@id': '#red' }, { '@id': '#blue' }] },
    { '@type': 'Product', '@id': '#red', url: product, name: 'Lamp',
      offers: { '@type': 'Offer', price: '12000', priceCurrency: 'IDR' } }],
  [{ '@type': 'Product', url: product, name: 'Lamp', isVariantOf: { '@id': '#group' },
    offers: { '@type': 'Offer', price: '12000', priceCurrency: 'IDR' } }],
].map(entries => ({ entries })))('withholds variant prices from structured metadata', async ({ entries }) => {
  const result = await extractTokopediaMetadata(product, async () =>
    new Response(graphHtml(entries), { headers: { 'content-type': 'text/html' } }));
  assert.equal(result?.title, 'Lamp');
  assert.equal(result?.price, null);
});
