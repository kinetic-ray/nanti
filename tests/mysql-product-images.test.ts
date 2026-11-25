import { testDatabaseUrl } from './test-database-url.mjs';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/database.js';
import { createImageStorage } from '../server/image-storage.js';
import { createMysqlImageStorage, mysqlImageId } from '../server/mysql-image-storage.js';
import * as mysqlStorage from '../server/mysql-image-storage.js';
import { prismaWishlists } from '../server/prisma-wishlists.js';
import { previewProductMetadata } from '../server/product-preview.js';
import { downloadMarketplaceImage } from '../server/tokopedia-metadata.js';
import { compressProductImage } from '../server/product-image-jpeg.js';
import { createRuntime } from '../server/runtime.js';
import { signTokopediaImage, verifyTokopediaImage } from '../server/tokopedia-image-proof.js';
import { signShopeeImage, verifyShopeeImage } from '../server/shopee-image-proof.js';

const listings = [
  { merchant: 'tokopedia', url: 'https://www.tokopedia.com/fixture/helmet', host: 'images.tokopedia.net', format: 'jpeg' },
  { merchant: 'shopee', url: 'https://shopee.co.id/Helmet-i.123.456', host: 'down-id.img.susercontent.com', format: 'webp' },
] as const;
const mutation = { 'X-Nanti-Request': '1' };
const input = { name: 'Helmet', priceMinor: null, quantity: 1 };
const raster = (format: 'webp' | 'jpeg') => sharp({
  create: { width: 320, height: 240, channels: 3, background: '#443344' },
}).toFormat(format).toBuffer();

it('binds a Tokopedia preview image to the session and listing until the proof expires', () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const secret = randomUUID();
  const binding = { owner: randomUUID(), listing: 'https://tk.tokopedia.com/fixture/', product: listings[0].url,
    image: 'https://images.tokopedia.net/fixture.jpg' };
  try {
    const proof = signTokopediaImage(secret, binding);
    expect(verifyTokopediaImage(secret, binding, proof)).toBe(true);
    expect(verifyTokopediaImage(secret, { ...binding, owner: randomUUID() }, proof)).toBe(false);
    expect(verifyTokopediaImage(secret, { ...binding, listing: binding.product }, proof)).toBe(false);
    clock.mockReturnValue(now + 5 * 60_000);
    expect(verifyTokopediaImage(secret, binding, proof)).toBe(false);
  } finally {
    clock.mockRestore();
  }
});

it('binds a Shopee preview image to the owner, submitted link, product, and image until expiry', () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const secret = randomUUID();
  const binding = { owner: randomUUID(), listing: 'https://s.shopee.co.id/short?campaign=1',
    product: 'https://shopee.co.id/lamp-i.123.456', image: 'https://cf.shopee.co.id/file/lamp.webp' };
  try {
    const proof = signShopeeImage(secret, binding);
    expect(verifyShopeeImage(secret, binding, proof)).toBe(true);
    expect(verifyShopeeImage(secret, { ...binding, owner: randomUUID() }, proof)).toBe(false);
    expect(verifyShopeeImage(secret, { ...binding, image: 'https://cf.shopee.co.id/file/other.webp' }, proof)).toBe(false);
    clock.mockReturnValue(now + 5 * 60_000);
    expect(verifyShopeeImage(secret, binding, proof)).toBe(false);
  } finally { clock.mockRestore(); }
});

describe.each(listings)('$merchant downloader', ({ merchant, host, format }) => {
  it('accepts raster content from an allowed host and rejects other hosts and redirects', async () => {
    const url = `https://${host}/helmet`;
    const bytes = await raster(format);
    const transport = vi.fn(async () => new Response(Uint8Array.from(bytes), { headers: { 'content-type': `image/${format}` } }));
    await expect(downloadMarketplaceImage(merchant, url, transport)).resolves.toEqual(bytes);
    for (const blocked of [`http://${host}/helmet`, `https://${host}.example.org/helmet`, `https://${host}:444/helmet`]) {
      await expect(downloadMarketplaceImage(merchant, blocked, transport)).resolves.toBeNull();
    }
    expect(transport).toHaveBeenCalledOnce();
    const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://blocked.invalid/image' } }));
    await expect(downloadMarketplaceImage(merchant, url, redirect)).resolves.toBeNull();
    expect(redirect).toHaveBeenCalledOnce();
  });
});

it('rejects invalid image bytes and enforces the stored byte ceiling', async () => {
  await expect(compressProductImage(Buffer.from('not a photo'), true)).resolves.toBeNull();
  const noise = Buffer.alloc(700 * 700 * 3);
  let state = 7;
  for (let i = 0; i < noise.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    noise[i] = state >>> 24;
  }
  const source = await sharp(noise, { raw: { width: 700, height: 700, channels: 3 } }).jpeg({ quality: 48 }).toBuffer();
  expect(source.length).toBeLessThanOrEqual(195_000);
  const compressed = await compressProductImage(source, true);
  expect(compressed?.length).toBeGreaterThanOrEqual(100_000);
  expect(compressed?.length).toBeLessThanOrEqual(195_000);
});

const databaseUrl = testDatabaseUrl;
describe.skipIf(!databaseUrl)('MySQL product photos', () => {
  const db = databaseUrl ? connectDatabase(databaseUrl) : undefined!;
  afterAll(async () => { await db?.$disconnect(); });

  it('keeps embedded Shopee title, seller, and image bound through save and reload', async () => {
    const originalUrl = 'https://s.shopee.co.id/fixture?campaign=one';
    const productUrl = 'https://shopee.co.id/lamp-i.123.456';
    const imageUrl = 'https://down-id.img.susercontent.com/file/fixture-lamp';
    const webp = await raster('webp');
    const html = '<link rel="canonical" href="' + productUrl + '"><script type="text/mfe-initial-data">' +
      JSON.stringify({ initialState: {
        DOMAIN_CONTEXT: { data: { shopId: 123, itemId: 456 } },
        DOMAIN_PDP: { data: { PDP_BFF_DATA: { cachedMap: { '123/456': {
          item: { shop_id: 123, item_id: 456, title: 'Lamp', image: 'fixture-lamp',
            images: ['fixture-lamp', 'fixture-angle'], models: [{ model_id: 789, name: '' }] },
          shop_vouchers: [{ shop_id: 123, shop_name: 'Lamp Shop' }],
        } } } } },
      } }) + '</script>';
    const metadataRequest: typeof fetch = async target => String(target) === originalUrl
      ? new Response(null, { status: 302, headers: { location: productUrl } })
      : new Response(html, { headers: { 'content-type': 'text/html' } });
    const imageRequest = vi.fn(async target => {
      expect(target.href).toBe(imageUrl);
      return new Response(Uint8Array.from(webp), { headers: { 'content-type': 'image/webp' } });
    });
    const secret = randomUUID() + randomUUID();
    const agent = request.agent(createApp({ secret, secureCookies: false, preview: async () => null,
      repository: prismaWishlists(db), mysqlImages: createMysqlImageStorage(db),
      lookupMetadata: target => previewProductMetadata(target, metadataRequest), marketplaceImageRequest: imageRequest }));
    await agent.post('/api/session').set(mutation).send({}).expect(200);
    const { body: list } = await agent.post('/api/wishlists').set(mutation)
      .send({ name: 'Shopee preview consistency', currency: 'IDR' }).expect(201);
    const path = `/api/wishlists/${list.id}`;
    const id = randomUUID();
    try {
      const { body: preview } = await agent.post('/api/products/import').set(mutation).send({ url: originalUrl }).expect(200);
      expect(preview).toMatchObject({ name: 'Lamp', sellerName: 'Lamp Shop', productUrl,
        imagePath: imageUrl, canSaveImage: true, shopeeImageProof: expect.any(String),
        shopeeDetails: { gallery: [imageUrl, 'https://down-id.img.susercontent.com/file/fixture-angle'],
          tiers: [], models: [{ id: '789', name: '' }] } });
      expect(preview).not.toHaveProperty('price');
      await agent.post(path + '/items').set(mutation).set('Idempotency-Key', id).send({
        ...input, name: preview.name, url: originalUrl, sellerName: preview.sellerName, priceMinor: 12_900_000,
        saveMarketplaceImage: true,
        shopeeProductUrl: preview.productUrl,
        shopeeImage: { url: preview.imagePath, proof: preview.shopeeImageProof },
      }).expect(201, { photoStatus: 'saved' });
      expect(imageRequest).toHaveBeenCalledOnce();
      const saved = await agent.get(path).expect(200);
      expect(saved.body.items).toEqual([expect.objectContaining({ id, url: originalUrl,
        name: 'Lamp', sellerName: 'Lamp Shop', priceMinor: 12_900_000, imageKey: expect.any(String) })]);
      const photo = await agent.get(`${path}/items/${id}/uploaded-image`).expect(200).expect('Content-Type', /image\/jpeg/u);
      expect((await sharp(photo.body).metadata()).format).toBe('jpeg');
      const center = async (bytes: Buffer) => sharp(bytes).resize(1, 1).raw().toBuffer();
      const [sourcePixel, savedPixel] = await Promise.all([center(webp), center(photo.body)]);
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(sourcePixel[channel]! - savedPixel[channel]!)).toBeLessThanOrEqual(12);
      }
    } finally {
      await agent.delete(path).set(mutation).send({}).expect(204);
    }
  });

  it('saves a preview-proven Shopee WebP through S3 storage as a private JPEG', async () => {
    const originalUrl = 'https://s.shopee.co.id/fixture?campaign=s3';
    const productUrl = 'https://shopee.co.id/lamp-i.123.456';
    const imageUrl = 'https://down-id.img.susercontent.com/file/lamp.webp';
    const source = await raster('webp');
    const storage = createImageStorage({ NANTI_S3_ENDPOINT: 'https://storage.example.com', NANTI_S3_BUCKET: 'nanti-test',
      NANTI_S3_REGION: 'auto', NANTI_S3_ACCESS_KEY_ID: 'test', NANTI_S3_SECRET_ACCESS_KEY: 'test' })!;
    let stored: Buffer | null = null;
    vi.spyOn(storage, 'storeJpeg').mockImplementation(async (owner, bytes, key) => {
      stored = Buffer.from(bytes);
      return key ?? storage.createUpload(owner).key;
    });
    vi.spyOn(storage, 'exists').mockResolvedValue(true);
    vi.spyOn(storage, 'readJpeg').mockImplementation(async () => stored ? Buffer.from(stored) : null);
    const imageRequest = vi.fn(async (target: URL) => {
      expect(target.href).toBe(imageUrl);
      return new Response(Uint8Array.from(source), { headers: { 'content-type': 'image/webp' } });
    });
    const secret = randomUUID() + randomUUID();
    const metadata = { title: 'Shopee lamp', image: imageUrl, productUrl,
      price: { priceMinor: 129000, currency: 'IDR' as const } };
    const options = { secret, secureCookies: false, preview: async () => null, imageStorage: storage,
      lookupMetadata: async () => metadata, marketplaceImageRequest: imageRequest };
    const app = createApp({ ...options, repository: prismaWishlists(db) });
    const owner = request.agent(app);
    const session = await owner.post('/api/session').set(mutation).send({}).expect(200);
    const cookie = session.headers['set-cookie']![0]!.split(';')[0]!;
    const { body: list } = await owner.post('/api/wishlists').set(mutation)
      .send({ name: 'Shopee S3 photo', currency: 'IDR' }).expect(201);
    const listPath = `/api/wishlists/${list.id}`;
    const id = randomUUID();
    try {
      const { body: preview } = await owner.post('/api/products/import').set(mutation).send({ url: originalUrl }).expect(200);
      expect(preview).toMatchObject({ imagePath: imageUrl, productUrl, canSaveImage: true,
        shopeeImageProof: expect.any(String), price: { priceMinor: 129000, currency: 'IDR' } });
      const input = { name: preview.name, url: originalUrl, sellerName: preview.sellerName, priceMinor: preview.price.priceMinor,
        quantity: 1, priceSource: 'imported_unverified', saveMarketplaceImage: true, shopeeProductUrl: preview.productUrl,
        shopeeImage: { url: preview.imagePath, proof: preview.shopeeImageProof } };
      await owner.post(listPath + '/items').set(mutation).set('Idempotency-Key', id).send(input)
        .expect(201, { photoStatus: 'saved' });
      await owner.post(listPath + '/items').set(mutation).set('Idempotency-Key', id).send(input)
        .expect(201, { photoStatus: 'saved' });
      expect(imageRequest).toHaveBeenCalledOnce();
      expect(stored).not.toBeNull();
      expect((await sharp(stored!).metadata()).format).toBe('jpeg');
      const fresh = createApp({ ...options, repository: prismaWishlists(db) });
      const { body: reloaded } = await request(fresh).get(listPath).set('Cookie', cookie).expect(200);
      expect(reloaded.items).toEqual([expect.objectContaining({ id, url: originalUrl, imageKey: expect.stringMatching(/^products\//) })]);
      const photoPath = `${listPath}/items/${id}/uploaded-image`;
      const response = await request(fresh).get(photoPath).set('Cookie', cookie).expect(200).expect('Content-Type', /image\/jpeg/u);
      expect(response.body).toEqual(stored);
      const stranger = request.agent(fresh);
      await stranger.post('/api/session').set(mutation).send({}).expect(200);
      await stranger.get(photoPath).expect(404);
    } finally {
      await owner.delete(listPath).set(mutation).send({}).expect(204);
    }
  });

  describe.each(listings)('$merchant save', ({ url, host, format }) => {
    async function setup(mode: 'valid' | 'missing' | 'blocked' | 'redirect' | 'bad-content' | 'write-failure' = 'valid') {
      const bytes = await raster(format);
      const cdnUrl = mode === 'blocked' ? 'https://blocked.invalid/helmet' : `https://${host}/helmet`;
      const metadataHtml = mode === 'missing' ? '<html></html>'
        : `<meta property="og:title" content="Helmet"><meta property="og:image" content="${cdnUrl}">
           <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","url":"${url}","name":"Helmet","image":"${cdnUrl}"}</script>`;
      const metadataRequest: typeof fetch = async () => new Response(metadataHtml, { headers: { 'content-type': 'text/html' } });
      const marketplaceImageRequest = vi.fn(async () => mode === 'redirect'
        ? new Response(null, { status: 302, headers: { location: 'https://blocked.invalid/photo' } })
        : new Response(mode === 'bad-content' ? 'invalid' : Uint8Array.from(bytes), { headers: { 'content-type': `image/${format}` } }));
      const options = {
        secret: randomUUID() + randomUUID(), secureCookies: false, preview: async () => null,
        lookupMetadata: (target: URL) => previewProductMetadata(target, metadataRequest),
        marketplaceImageRequest,
      };
      const app = createApp({ ...options, repository: prismaWishlists(db), mysqlImages: createMysqlImageStorage(db) });
      const agent = request.agent(app);
      const session = await agent.post('/api/session').set(mutation).send({}).expect(200);
      const cookie = session.headers['set-cookie']![0]!.split(';')[0]!;
      const { body: list } = await agent.post('/api/wishlists').set(mutation).send({ name: 'Photos', currency: 'IDR' }).expect(201);
      const path = `/api/wishlists/${list.id}`;
      const idempotencyKey = randomUUID();
      const itemPath = `${path}/items/${idempotencyKey}`;
      const save = () => agent.post(path + '/items').set(mutation).set('Idempotency-Key', idempotencyKey)
        .send({ ...input, url, saveMarketplaceImage: true });
      return { agent, options, cookie, path, itemPath, save, idempotencyKey, marketplaceImageRequest };
    }

    it('previews and saves a private JPEG, replays one write, and reloads with a fresh app and DB client', async () => {
      const { agent, options, cookie, path, itemPath, save, idempotencyKey, marketplaceImageRequest } = await setup();
      const { body: preview } = await agent.post('/api/products/import').set(mutation).send({ url }).expect(200);
      expect(preview).toMatchObject({ name: 'Helmet', canSaveImage: true });
      await save().expect(201, { photoStatus: 'saved' });
      await save().expect(201, { photoStatus: 'saved' });
      expect(marketplaceImageRequest).toHaveBeenCalledOnce();
      const freshDb = connectDatabase(databaseUrl!);
      try {
        const fresh = createApp({ ...options, repository: prismaWishlists(freshDb), mysqlImages: createMysqlImageStorage(freshDb) });
        const { body } = await request(fresh).get(path).set('Cookie', cookie).expect(200);
        expect(body.items).toEqual([expect.objectContaining({ id: idempotencyKey, imageKey: expect.stringMatching(/^mysql\//) })]);
        expect(body.items[0]).not.toHaveProperty('bytes');
        const response = await request(fresh).get(itemPath + '/uploaded-image').set('Cookie', cookie).expect(200)
          .expect('Content-Type', /image\/jpeg/).expect('Cache-Control', 'private, no-store').expect('X-Content-Type-Options', 'nosniff');
        const row = await freshDb.productImage.findUniqueOrThrow({ where: { itemId: idempotencyKey } });
        expect(row).toMatchObject({ mimeType: 'image/jpeg', size: response.body.length, checksum: createHash('sha256').update(response.body).digest('hex') });
        expect((await sharp(response.body).metadata()).format).toBe('jpeg');
        const other = request.agent(fresh);
        await other.post('/api/session').set(mutation).send({}).expect(200);
        await other.get(itemPath + '/uploaded-image').expect(404);
      } finally {
        await freshDb.$disconnect();
        await agent.delete(path).set(mutation).send({}).expect(204);
      }
      expect(await db.productImage.count({ where: { itemId: idempotencyKey } })).toBe(0);
    });

    it('coalesces concurrent saves using the same request key without duplicate image rows', async () => {
      const { agent, path, itemPath, save, idempotencyKey } = await setup();
      try {
        const responses = await Promise.all([save(), save()]);
        for (const response of responses) {
          expect(response.status).toBe(201);
          expect(response.body).toEqual({ photoStatus: 'saved' });
        }
        const { body: list } = await agent.get(path).expect(200);
        expect(list.items.filter((item: { id: string }) => item.id === idempotencyKey)).toHaveLength(1);
        expect(await db.productImage.count({ where: { itemId: idempotencyKey } })).toBe(1);
        await agent.get(itemPath + '/uploaded-image').expect(200).expect('Content-Type', /image\/jpeg/);
      } finally {
        await agent.delete(path).set(mutation).send({}).expect(204);
      }
    });

    it.each(['missing', 'blocked', 'redirect', 'bad-content', 'write-failure'] as const)('saves text with %s', async (mode) => {
      const { agent, itemPath, path, idempotencyKey, save, marketplaceImageRequest } = await setup(mode);
      const write = mysqlStorage.writeProductImage;
      const failure = mode === 'write-failure' ? vi.spyOn(mysqlStorage, 'writeProductImage')
        .mockImplementationOnce(async (...args) => {
          await write(...args);
          throw new mysqlStorage.ProductImageWriteError(new Error('Simulated image write failure'));
        }) : undefined;
      try {
        await save().expect(201, { photoStatus: 'unavailable' });
        if (failure) expect(failure).toHaveBeenCalledOnce();
        const { body } = await agent.get(path).expect(200);
        expect(body.items).toEqual([expect.objectContaining({ id: idempotencyKey, imageKey: null })]);
        expect(await db.productImage.count({ where: { itemId: idempotencyKey } })).toBe(0);
        await agent.get(itemPath + '/uploaded-image').expect(404);
        if (mode === 'missing' || mode === 'blocked') expect(marketplaceImageRequest).not.toHaveBeenCalled();
        else expect(marketplaceImageRequest).toHaveBeenCalledOnce();
      } finally {
        failure?.mockRestore();
        await agent.delete(path).set(mutation).send({}).expect(204);
      }
    });
  });

  it('imports a Tokopedia short link with linked metadata and serves its saved image from a new runtime', async () => {
    const originalUrl = 'https://tokopedia.link/fixture-helmet?ref=one#saved';
    const { url: productUrl } = listings[0];
    const imageUrl = 'https://images.tokopedia.net/fixture/helmet.jpg';
    const jpeg = await raster('jpeg');
    const html = '<script type="application/ld+json">' + JSON.stringify({ '@graph': [
      { '@type': 'WebPage', url: productUrl, mainEntity: { '@type': 'Product', name: 'Helmet',
        image: { '@id': '#photo' }, offers: { '@id': '#offer' } } },
      { '@type': 'ImageObject', '@id': '#photo', contentUrl: imageUrl },
      { '@type': 'Offer', '@id': '#offer', price: '175000', priceCurrency: 'IDR', seller: { '@id': '#store' } },
      { '@type': 'Organization', '@id': '#store', name: 'Helmet Shop' },
    ] }) + '</script>';
    const requests: string[] = [];
    const metadataRequest: typeof fetch = async (target, options) => {
      expect(options?.redirect).toBe('manual');
      requests.push(String(target));
      if (requests.length > 2) throw new Error('Fixture marketplace lookup timed out after preview');
      return String(target) === productUrl
        ? new Response(html, { headers: { 'content-type': 'text/html' } })
        : new Response(null, { status: 302, headers: { location: productUrl } });
    };
    const secret = randomUUID() + randomUUID();
    const marketplaceImageRequest = vi.fn(async (target: URL) => {
      expect(target.href).toBe(imageUrl);
      return new Response(Uint8Array.from(jpeg), { headers: { 'content-type': 'image/jpeg' } });
    });
    const agent = request.agent(createApp({
      secret, secureCookies: false, preview: async () => null,
      repository: prismaWishlists(db), mysqlImages: createMysqlImageStorage(db),
      lookupMetadata: target => previewProductMetadata(target, metadataRequest),
      marketplaceImageRequest,
    }));
    const session = await agent.post('/api/session').set(mutation).send({}).expect(200);
    const cookie = session.headers['set-cookie']![0]!.split(';')[0]!;
    const { body: list } = await agent.post('/api/wishlists').set(mutation).send({ name: 'Tokopedia', currency: 'IDR' }).expect(201);
    const path = `/api/wishlists/${list.id}`;
    try {
      const { body: preview } = await agent.post('/api/products/import').set(mutation).send({ url: originalUrl }).expect(200);
      expect(preview).toMatchObject({ originalUrl, productUrl, name: 'Helmet', price: { priceMinor: 17_500_000, currency: 'IDR' },
        sellerName: 'Helmet Shop', imagePath: imageUrl, canSaveImage: true, tokopediaImageProof: expect.any(String) });
      const id = randomUUID();
      const item = {
        ...input, url: originalUrl, priceMinor: preview.price.priceMinor, priceSource: 'imported_unverified',
        sellerName: preview.sellerName, saveMarketplaceImage: true, tokopediaProductUrl: preview.productUrl,
      };
      await agent.post(path + '/items').set(mutation).set('Idempotency-Key', id).send({
        ...item, tokopediaImage: { url: preview.imagePath, proof: preview.tokopediaImageProof },
      }).expect(201, { photoStatus: 'saved' });
      expect(requests).toEqual([originalUrl.split('#')[0], productUrl]);

      const restarted = await createRuntime({ DATABASE_URL: databaseUrl!, SESSION_SECRET: secret, NODE_ENV: 'test' }, {});
      try {
        await restarted.checkDatabase();
        const { body: saved } = await request(restarted.app).get(path).set('Cookie', cookie).expect(200);
        expect(saved.items).toEqual([expect.objectContaining({ id, url: originalUrl, sellerName: 'Helmet Shop',
          priceMinor: 17_500_000, imageKey: expect.stringMatching(/^mysql\//u) })]);
        const photo = await request(restarted.app).get(path + '/items/' + id + '/uploaded-image').set('Cookie', cookie)
          .expect(200).expect('Content-Type', /image\/jpeg/u).expect('Cache-Control', 'private, no-store');
        expect((await sharp(photo.body).metadata()).format).toBe('jpeg');
      } finally {
        await restarted.db.$disconnect();
      }
      await agent.post(path + '/items').set(mutation).set('Idempotency-Key', randomUUID()).send({
        ...item, tokopediaImage: { url: 'https://images.tokopedia.net/fixture/another.jpg', proof: preview.tokopediaImageProof },
      }).expect(201, { photoStatus: 'unavailable' });
      expect(requests).toEqual([originalUrl.split('#')[0], productUrl, originalUrl.split('#')[0]]);
      expect(marketplaceImageRequest).toHaveBeenCalledOnce();
    } finally {
      await agent.delete(path).set(mutation).send({}).expect(204);
    }
  });

  it('prioritizes manual uploads, rejects reuse by another owner, and cleans up replaced, removed, and expired photos', async () => {
    const lookupMetadata = vi.fn();
    const storage = createMysqlImageStorage(db);
    const app = createApp({ secret: randomUUID() + randomUUID(), secureCookies: false, preview: async () => null,
      repository: prismaWishlists(db), mysqlImages: storage, lookupMetadata });
    const session = async () => {
      const agent = request.agent(app);
      await agent.post('/api/session').set(mutation).send({}).expect(200);
      const { body: list } = await agent.post('/api/wishlists').set(mutation).send({ name: 'Photos', currency: 'IDR' }).expect(201);
      return { agent, path: `/api/wishlists/${list.id}` };
    };
    const { agent, path } = await session();
    const other = await session();
    const jpeg = await raster('jpeg');
    const upload = async () => (await agent.post('/api/uploads/product-image/content').set(mutation)
      .set('Content-Type', 'image/jpeg').send(jpeg).expect(201)).body.key as string;
    const first = await upload();
    const product = { ...input, url: listings[1].url, imageKey: first };
    await other.agent.post(other.path + '/items').set(mutation).send(product).expect(400);
    await agent.post(path + '/items').set(mutation).send({ ...product, saveMarketplaceImage: true }).expect(201);
    expect(lookupMetadata).not.toHaveBeenCalled();
    const { body: list } = await agent.get(path).expect(200);
    const itemPath = `${path}/items/${list.items[0].id}`;
    await agent.get(itemPath + '/uploaded-image').expect(200);
    const second = await upload();
    await agent.put(itemPath).set(mutation).send({ ...product, imageKey: second }).expect(204);
    expect(await db.productImage.count({ where: { id: mysqlImageId(first) } })).toBe(0);
    await agent.delete(itemPath).set(mutation).send({}).expect(204);
    expect(await db.productImage.count({ where: { id: mysqlImageId(second) } })).toBe(0);
    const abandoned = mysqlImageId(await upload())!;
    await db.productImage.update({ where: { id: abandoned }, data: { createdAt: new Date(0) } });
    await storage.prune();
    expect(await db.productImage.count({ where: { id: abandoned } })).toBe(0);
    await agent.delete(path).set(mutation).send({}).expect(204);
    await other.agent.delete(other.path).set(mutation).send({}).expect(204);
  });

  it('reads and preserves pre-existing legacy keys without issuing an S3 delete', async () => {
    const legacy = createImageStorage({ NANTI_S3_ENDPOINT: 'https://storage.example.com', NANTI_S3_BUCKET: 'nanti-test',
      NANTI_S3_REGION: 'auto', NANTI_S3_ACCESS_KEY_ID: 'test', NANTI_S3_SECRET_ACCESS_KEY: 'test' })!;
    const jpg = await raster('jpeg');
    const read = vi.spyOn(legacy, 'readJpeg').mockResolvedValue(jpg);
    const discard = vi.spyOn(legacy, 'discard');
    const agent = request.agent(createApp({ secret: randomUUID() + randomUUID(), secureCookies: false, preview: async () => null,
      repository: prismaWishlists(db), imageStorage: legacy, mysqlImages: createMysqlImageStorage(db) }));
    await agent.post('/api/session').set(mutation).send({}).expect(200);
    const { body: list } = await agent.post('/api/wishlists').set(mutation).send({ name: 'Legacy photo', currency: 'IDR' }).expect(201);
    const { ownerId } = await db.wishlist.findUniqueOrThrow({ where: { id: list.id }, select: { ownerId: true } });
    const key = legacy.createUpload(ownerId).key;
    const item = await db.item.create({ data: { ...input, ownerId, wishlistId: list.id, imageKey: key } });
    const path = `/api/wishlists/${list.id}/items/${item.id}`;
    await agent.get(path + '/uploaded-image').expect(200, jpg);
    await agent.put(path).set(mutation).send({ ...input, url: null, imageKey: key }).expect(204);
    await agent.get(path + '/uploaded-image').expect(200, jpg);
    expect(read).toHaveBeenCalledWith(key);
    await agent.delete(path).set(mutation).send({}).expect(204);
    expect(discard).not.toHaveBeenCalled();
    await agent.delete(`/api/wishlists/${list.id}`).set(mutation).send({}).expect(204);
  });
});
