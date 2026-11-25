import { expect, it, vi } from 'vitest';
import { extractShopeeMetadata } from '../server/shopee-metadata.js';
import embeddedFixtures from './fixtures/shopee-embedded-state.json' with { type: 'json' };

const listing = new URL('https://shopee.co.id/product/1601973354/28190565299');

it('identifies a metadata-free Shopee app shell with HTTP 200', async () => {
  const diagnostic = vi.fn();
  const page = '<!doctype html><head></head><body><div id="main"></div><script src="/app.js"></script></body>';
  const transport = vi.fn(async () => new Response(page, { headers: { 'content-type': 'text/html' } }));
  expect(await extractShopeeMetadata(listing, transport, diagnostic)).toBeNull();
  expect(diagnostic).toHaveBeenCalledWith('storefront_shell', 'shopee.co.id', 200);
  expect(transport).toHaveBeenCalledOnce();
});

it('accepts matching public body JSON-LD and ignores unrelated or unidentified products', async () => {
  const products = [
    { '@type': 'Product', name: 'Unrelated shoe', url: 'https://shopee.co.id/product/1/2' },
    { '@type': 'Product', name: 'Unidentified shoe' },
    { '@type': 'Product', name: 'Matching shoe', url: listing.href },
  ];
  const page = '<!doctype html><head></head><body><main><script type="application/ld+json">' +
    JSON.stringify(products) + '</script></main></body>';
  const transport = async () => new Response(page, { headers: { 'content-type': 'text/html' } });
  expect(await extractShopeeMetadata(listing, transport)).toMatchObject({ title: 'Matching shoe', productUrl: listing.href });
});

const [single, variants, empty] = embeddedFixtures as [typeof embeddedFixtures[number], typeof embeddedFixtures[number], typeof embeddedFixtures[number]];
const script = (source: string) => '<script type="text/mfe-initial-data">' + source + '</script>';
const embeddedPage = (url: string, body: string, head = '') =>
  '<!doctype html><head><link rel="canonical" href="' + url + '">' + head + '</head><body>' + body + '</body>';
const transportFor = (page: string): typeof fetch => async () =>
  new Response(page, { headers: { 'content-type': 'text/html' } });
const read = (url: string, page: string) => extractShopeeMetadata(new URL(url), transportFor(page));

it('reads a matched product beyond the previous cap and keeps variant and gallery data', async () => {
  const page = embeddedPage(variants.url, '<!--' + 'x'.repeat(540_000) + '-->' + script(JSON.stringify(variants.state)));
  expect(await read(variants.url, page)).toMatchObject({
    title: expect.stringContaining('ADVAN V11'), sellerName: 'Advan Notebook Official Store', price: null,
    image: 'https://down-id.img.susercontent.com/file/id-11134207-81ztc-mvrcph4zjtoh9d',
    shopeeDetails: {
      gallery: ['https://down-id.img.susercontent.com/file/id-11134207-81ztc-mvrcph4zjtoh9d',
        'https://down-id.img.susercontent.com/file/fixture-secondary-image'],
      tiers: [{ name: 'Unit', options: ['TABLET ONLY', 'TAB+KEYBOARD'] }],
      models: [{ name: 'TAB+KEYBOARD', id: '273032452298' }, { name: 'TABLET ONLY', id: '326286000094' }],
    },
  });
});

it('retains the default model without creating a selectable variant', async () => {
  expect(await read(single.url, embeddedPage(single.url, script(JSON.stringify(single.state)))))
    .toMatchObject({ shopeeDetails: { tiers: [], models: [{ name: '', id: '56471456350' }] } });
});

it('does not import generic Shopee social metadata from an empty cache', async () => {
  const body = script(JSON.stringify(empty.state));
  const page = '<meta property="og:title" content="Shopee Indonesia | Situs Belanja Online Terlengkap &amp; Terpercaya">' + body;
  expect(await read(empty.url, page)).toBeNull();
});

it.each(['malformed', 'unclosed', 'oversized script', 'oversized page'])('falls back to verified head on %s', async reason => {
  const state = JSON.stringify(variants.state);
  const body = reason === 'malformed' ? script('{' + state) :
    reason === 'unclosed' ? '<script type="text/mfe-initial-data">' + state :
    reason === 'oversized script' ? script(state + ' '.repeat(512 * 1024)) :
    '<!--' + 'x'.repeat(2 * 1024 * 1024) + '-->' + script(state);
  const page = embeddedPage(variants.url, body, '<meta property="og:title" content="Verified title">');
  const result = await read(variants.url, page);
  expect(result).toMatchObject({ title: 'Verified title', price: null });
  expect(result?.shopeeDetails).toBeUndefined();
});

it.each(['canonical', 'missing canonical', 'route', 'cache', 'item', 'shop'])('rejects mismatched embedded %s identity', async kind => {
  let state = JSON.stringify(variants.state);
  if (kind === 'route') state = state.replace('"shopId":919692407', '"shopId":1');
  if (kind === 'cache') state = state.replace('"919692407/51864967214":', '"1/2":');
  if (kind === 'item') state = state.replace('"item_id":51864967214', '"item_id":2');
  if (kind === 'shop') state = state.replace('"shop_id":919692407', '"shop_id":1');
  const page = kind === 'missing canonical' ? script(state) : embeddedPage(
    kind === 'canonical' ? 'https://shopee.co.id/product/1/2' : variants.url, script(state));
  expect(await read(variants.url, page)).toBeNull();
});

it('withholds conflicting sellers and prices while retaining the matched product', async () => {
  const ld = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', url: variants.url, offers: { '@type': 'Offer', priceCurrency: 'IDR', price: '129000',
      seller: { name: 'Conflicting Shop' } },
  }) + '</script>';
  const result = await read(variants.url, embeddedPage(variants.url, script(JSON.stringify(variants.state)), ld));
  expect(result).toMatchObject({ title: expect.stringContaining('ADVAN V11'), price: null });
  expect(result?.sellerName).toBeUndefined();
});

it('uses only matching shop records and withholds conflicting matched records', async () => {
  const original = JSON.stringify(variants.state);
  const matching = '{"shop_id":919692407,"shop_name":"Second Shop"}';
  const unrelated = '{"shop_id":123,"shop_name":"Second Shop"}';
  const withShop = (row: string) => original.replace('"shop_vouchers":[', '"shop_vouchers":[' + row + ',');
  const readShop = (row: string) => read(variants.url, embeddedPage(variants.url, script(withShop(row))));
  expect((await readShop(unrelated))?.sellerName).toBe('Advan Notebook Official Store');
  expect((await readShop(matching))?.sellerName).toBeUndefined();
});

it('accepts verified embedded metadata after a direct HTTP product redirect without JSON-LD', async () => {
  const short = new URL('https://s.shopee.co.id/fixture');
  const transport = vi.fn<typeof fetch>(async target => String(target) === short.href
    ? new Response(null, { status: 302, headers: { location: variants.url } })
    : transportFor(embeddedPage(variants.url, script(JSON.stringify(variants.state))))(target));
  expect(await extractShopeeMetadata(short, transport)).toMatchObject({
    title: expect.stringContaining('ADVAN V11'), productUrl: variants.url, price: null,
  });
  expect(transport).toHaveBeenCalledTimes(2);
});

it('rejects self-identifying JSON-LD on a non-product affiliate destination', async () => {
  const short = new URL('https://s.shopee.co.id/fixture');
  const landing = new URL('https://shopee.co.id/opaanlp/919692407/51864967214');
  const body = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', url: landing.href, name: 'Unverified affiliate product',
  }) + '</script>';
  const transport: typeof fetch = async target => String(target) === short.href
    ? new Response(null, { status: 301, headers: { location: landing.href } })
    : transportFor(embeddedPage(landing.href, body))(target);
  expect(await extractShopeeMetadata(short, transport)).toBeNull();
});

it('counts raw script bytes before HTML newline normalization', async () => {
  const state = JSON.stringify(variants.state);
  const body = script(state + '\r\n'.repeat(270_000));
  const page = embeddedPage(variants.url, body, '<meta property="og:title" content="Verified title">');
  const result = await read(variants.url, page);
  expect(result).toMatchObject({ title: 'Verified title', price: null });
  expect(result?.shopeeDetails).toBeUndefined();
});

it('rejects fallback from a head cut off before conflicting identity metadata', async () => {
  const head = '<head><link rel="canonical" href="' + variants.url +
    '"><meta property="og:title" content="Unverified prefix"><!--' + 'x'.repeat(2 * 1024 * 1024) +
    '--><meta property="og:url" content="https://shopee.co.id/product/1/2"></head>';
  expect(await read(variants.url, head)).toBeNull();
});

it('keeps verified head fallback when the 2 MiB read cuts off an otherwise valid script', async () => {
  const head = '<head><link rel="canonical" href="' + variants.url +
    '"><meta property="og:title" content="Verified title"></head><body>';
  const state = '<script type="text/mfe-initial-data">' + JSON.stringify(variants.state);
  const padding = ' '.repeat(2 * 1024 * 1024 - Buffer.byteLength(head + state));
  const result = await read(variants.url, head + padding + state + '</script></body>');
  expect(result).toMatchObject({ title: 'Verified title', price: null });
  expect(result?.shopeeDetails).toBeUndefined();
});
