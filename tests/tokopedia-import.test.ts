import { readFileSync } from 'node:fs';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { previewProduct, previewProductMetadata } from '../server/product-preview.js';
import * as tokopedia from '../server/tokopedia-metadata.js';
import { createImageStorage } from '../server/image-storage.js';
import type { WishlistRepository } from '../server/wishlist.js';

const listing = 'https://www.tokopedia.com/shop/lamp';
const affiliate = 'https://TOKOPEDIA.LINK:443/abc?affiliate=fixture%2f#original';
const fixture = (name: string, status = 200) => new Response(
  readFileSync(new URL('./fixtures/tokopedia/' + name + '.html', import.meta.url), 'utf8'),
  { status, headers: { 'content-type': 'text/html' } },
);
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
const appFor = (upstream: typeof fetch) => createApp({
  repository: { list: async () => [] } as unknown as WishlistRepository,
  secret: 'fixture-secret', secureCookies: false,
  preview: (url) => previewProduct(url, upstream),
  lookupMetadata: (url, _request, diagnostic) => previewProductMetadata(url, upstream, diagnostic),
});
const post = (app: ReturnType<typeof createApp>, endpoint: 'import' | 'preview', url = listing) => ({
  async expect(status: number, body?: object) {
    const agent = request.agent(app);
    await agent.post('/api/session').set('X-Nanti-Request', '1').send({}).expect(200);
    const response = agent.post('/api/products/' + endpoint).set('X-Nanti-Request', '1').send({ url }).expect(status);
    return body ? response.expect(body) : response;
  },
});

describe('Tokopedia preview and import integration', () => {
  it('exposes the listing metadata through import and the title through legacy preview', async () => {
    const app = appFor(async () => fixture('complete'));
    const result = await post(app, 'import').expect(200);
    expect(result.body).toMatchObject({
      merchant: 'tokopedia', originalUrl: listing, name: 'Lamp & Stand', sellerName: 'Lamp Shop',
      price: { priceMinor: 12500000, currency: 'IDR' },
      imagePath: 'https://images.tokopedia.net/img/lamp.jpg', status: 'details_available',
    });
    await post(app, 'preview').expect(200, { name: 'Lamp & Stand' });
  });

  it.each(['missing-image', 'ambiguous'])('imports partial data from %s without filling gaps', async (name) => {
    const { body } = await post(appFor(async () => fixture(name)), 'import').expect(200);
    expect(body).toMatchObject({ name: 'Lamp', status: 'name_available', originalUrl: listing });
    expect(body).not.toHaveProperty('imagePath');
    expect(body).not.toHaveProperty('price');
    expect(body).not.toHaveProperty('sellerName');
  });

  it('retains the original affiliate link while following a safe redirect', async () => {
    const upstream = vi.fn<typeof fetch>(async (url) =>
      new URL(String(url)).hostname === 'tokopedia.link' ? redirect(listing) : fixture('complete'));
    const { body } = await post(appFor(upstream), 'import', affiliate).expect(200);
    expect(body).toMatchObject({ name: 'Lamp & Stand', originalUrl: affiliate });
    expect(upstream.mock.calls.map(([url]) => String(url))).toEqual([new URL(affiliate.split('#')[0]!).href, listing]);
  });

  it('preserves a blocked response diagnostic and offers manual entry', async () => {
    const { body } = await post(appFor(async () => fixture('blocked', 403)), 'import', affiliate).expect(200);
    expect(body).toMatchObject({
      originalUrl: affiliate, status: 'manual_required', name: null,
      diagnostic: { code: 'http_failure', host: 'tokopedia.link', httpStatus: 403 },
    });
  });

  it('keeps mismatched metadata and unsafe redirects in manual entry', async () => {
    const wrong = await post(appFor(async () => fixture('wrong-product')), 'import').expect(200);
    expect(wrong.body).toMatchObject({ status: 'manual_required', name: null });
    const upstream = vi.fn<typeof fetch>(async () => redirect('https://127.0.0.1/'));
    const unsafe = await post(appFor(upstream), 'import', affiliate).expect(200);
    expect(unsafe.body).toMatchObject({ status: 'manual_required', diagnostic: { code: 'redirect_disallowed' } });
    expect(upstream).toHaveBeenCalledOnce();
  });
});

it('revalidates the resolved listing and issues only an owner-scoped stored photo key', async () => {
  const storage = createImageStorage({
    NANTI_S3_ENDPOINT: 'https://storage.example.com', NANTI_S3_BUCKET: 'nanti-test',
    NANTI_S3_REGION: 'auto', NANTI_S3_ACCESS_KEY_ID: 'test', NANTI_S3_SECRET_ACCESS_KEY: 'test',
  })!;
  const upload = vi.spyOn(storage, 'storeJpeg').mockImplementation(async (owner) => storage.createUpload(owner).key);
  const download = vi.spyOn(tokopedia, 'downloadTokopediaImage').mockResolvedValue(Buffer.from('fixture'));
  try {
    const app = createApp({
      repository: { list: async () => [] } as unknown as WishlistRepository,
      secret: 'fixture-secret', secureCookies: false, imageStorage: storage,
      preview: async () => null,
      lookupMetadata: (url) => previewProductMetadata(url, async () => fixture('complete')),
    });
    const agent = request.agent(app);
    await agent.post('/api/session').set('X-Nanti-Request', '1').send({}).expect(200);
    const lookup = await agent.post('/api/products/import').set('X-Nanti-Request', '1').send({ url: listing }).expect(200);
    expect(lookup.body).toMatchObject({ productUrl: listing, canSaveImage: true });
    const path = '/api/products/import/tokopedia-image';
    await agent.post(path).set('X-Nanti-Request', '1').send({ url: affiliate }).expect(422);
    expect(download).not.toHaveBeenCalled();
    const saved = await agent.post(path).set('X-Nanti-Request', '1').send({ url: listing }).expect(201);
    const owner = upload.mock.calls[0]![0];
    expect(saved.body).toEqual({ imageKey: expect.any(String) });
    expect(storage.validKey(owner, saved.body.imageKey)).toBe(true);
    expect(storage.validKey('other', saved.body.imageKey)).toBe(false);
    expect(download).toHaveBeenCalledWith('https://images.tokopedia.net/img/lamp.jpg');
  } finally {
    download.mockRestore();
    upload.mockRestore();
  }
});

describe.each([
  { short: 'https://s.shopee.co.id/114aBAsydf', product: 'https://www.shopee.co.id/lamp-i.123.456' },
  { short: 'https://tk.tokopedia.com/ZSp76BWQL/', product: listing },
])('marketplace short-link fallback for $short', ({ short, product }) => {
  it.each([403, 410])('retains the pasted link and destination HTTP %i', async (status) => {
    const upstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(redirect(product))
      .mockResolvedValueOnce(fixture('blocked', status));
    const { body } = await post(appFor(upstream), 'import', short).expect(200);
    expect(body).toMatchObject({ originalUrl: short, status: 'manual_required', name: null,
      diagnostic: { code: 'http_failure', host: new URL(product).hostname, httpStatus: status } });
    expect(upstream.mock.calls.map(([url]) => String(url))).toEqual([short, product]);
  });
});

describe('Shopee product identity at the import API', () => {
  const short = 'https://s.shopee.co.id/fixture';
  const product = 'https://shopee.co.id/product/123/456';
  const tags = '<meta property="og:title" content="Store page"><meta property="og:image" content="https://cf.shopee.co.id/file/demo">';
  it.each([
    [short, 'https://shopee.co.id/login', '', 'text/html'],
    [product, 'https://shopee.co.id/other-i.123.789', '', 'text/html'],
    [short, product, '<link rel="canonical" href="/product/123/789">', 'text/html'],
    [short, product, '', 'text/html-preview'],
  ])('keeps manual entry for %s redirected to %s with %s %s', async (original, destination, canonical, type) => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(redirect(destination!))
      .mockResolvedValueOnce(new Response('<head>' + tags + canonical + '</head>', { headers: { 'content-type': type! } }));
    const { body } = await post(appFor(upstream), 'import', original).expect(200);
    expect(body).toMatchObject({ originalUrl: original, name: null, status: 'manual_required' });
    for (const key of ['imagePath', 'price', 'sellerName']) expect(body).not.toHaveProperty(key);
  });

  it('recognizes the same listing across slug, www and product URLs', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(redirect('https://www.shopee.co.id/lamp-i.123.456'))
      .mockResolvedValueOnce(new Response('<head>' + tags + '<link rel="canonical" href="' + product + '"></head>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const { body } = await post(appFor(upstream), 'import', product).expect(200);
    expect(body).toMatchObject({ originalUrl: product, status: 'details_available', name: 'Store page' });
  });
});
