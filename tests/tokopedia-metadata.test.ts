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
