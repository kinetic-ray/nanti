import { testDatabaseUrl } from './test-database-url.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { connectDatabase } from '../server/database.js';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { Prisma } from '../server/generated/prisma/client.js';
import { createImageStorage } from '../server/image-storage.js';
import * as tokopedia from '../server/tokopedia-metadata.js';
import { prismaWishlists } from '../server/prisma-wishlists.js';
import type { WishlistRepository } from '../server/wishlist.js';
import type { Item, WishlistSummary } from '../shared/wishlist.js';
import { formatPrice, parsePrice, safeProductUrl } from '../shared/wishlist.js';

function memoryWishlists(): WishlistRepository {
  const lists = new Map<string, WishlistSummary & { ownerId: string; items: Item[] }>();
  function owned(ownerId: string, id: string) {
    const list = lists.get(id);
    return list?.ownerId === ownerId ? list : undefined;
  }
  function summary({ id, name, currency }: WishlistSummary) {
    return { id, name, currency };
  }
  return {
    async list(ownerId) {
      return [...lists.values()].filter((list) => list.ownerId === ownerId).map(summary);
    },
    async find(ownerId, id) {
      const list = owned(ownerId, id);
      return list ? { ...summary(list), items: list.items } : null;
    },
    async create(ownerId, { name, currency }) {
      const list = { id: randomUUID(), ownerId, name, currency, items: [] };
      lists.set(list.id, list);
      return summary(list);
    },
    async rename(ownerId, id, name) {
      const list = owned(ownerId, id);
      if (!list) return false;
      list.name = name;
      return true;
    },
    async remove(ownerId, id) {
      return Boolean(owned(ownerId, id) && lists.delete(id));
    },
    async addItem(ownerId, id, data) {
      const list = owned(ownerId, id);
      if (!list) return false;
      list.items.push({ ...data, id: randomUUID() });
      return true;
    },
    async updateItem(ownerId, listId, id, data) {
      const item = owned(ownerId, listId)?.items.find((entry) => entry.id === id);
      if (!item) return false;
      Object.assign(item, data);
      return true;
    },
    async removeItem(ownerId, listId, id) {
      const list = owned(ownerId, listId);
      const index = list?.items.findIndex((entry) => entry.id === id) ?? -1;
      if (!list || index < 0) return false;
      list.items.splice(index, 1);
      return true;
    },
  };
}

const mutation = { 'X-Nanti-Request': '1', 'Content-Type': 'application/json' };
const product = { name: 'Lamp', url: 'https://example.com/lamp', priceMinor: 10, quantity: 3 };

it('distinguishes a save transaction failure from validation and preserves retry identity', async () => {
  const repository = memoryWishlists();
  const add = vi.spyOn(repository, 'addItem').mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
    'Transaction expired', { code: 'P2028', clientVersion: 'test' },
  ));
  const app = createApp({ repository, preview: async () => null, secret: randomBytes(32).toString('hex'), secureCookies: false });
  const agent = request.agent(app);
  await agent.post('/api/session').set(mutation).send({}).expect(200);
  const { body } = await agent.post('/api/wishlists').set(mutation).send({ name: 'Fixture', currency: 'IDR' }).expect(201);
  const path = `/api/wishlists/${body.id}/items`;
  const key = randomUUID();
  await agent.post(path).set(mutation).set('Idempotency-Key', key).send({ ...product, quantity: 0 }).expect(400, {
    code: 'invalid_product_details', error: 'Enter a whole number from 1 to 999.',
  });
  const failed = await agent.post(path).set(mutation).set('Idempotency-Key', key).send(product).expect(503);
  expect(failed.body.code).toBe('product_save_transaction_unavailable');
  expect(failed.headers['x-nanti-request-id']).toMatch(/^[0-9a-f-]{36}$/u);
  await agent.post(path).set(mutation).set('Idempotency-Key', key).send(product).expect(201);
  expect(add.mock.calls.map(args => args[3])).toEqual([key, key]);
});

function contract(repository: WishlistRepository) {
  const preview = vi.fn(async (_url: URL) => null);
  const app = createApp({ repository, preview, secret: randomBytes(32).toString('hex'), secureCookies: false });

  it('creates, reads, edits and deletes lists and products with exact totals', async () => {
    const agent = request.agent(app);
    const session = await agent.post('/api/session').set(mutation).send({}).expect(200, []);
    expect(session.headers['set-cookie']?.[0]).toMatch(/HttpOnly; SameSite=Strict/);
    const created = await agent.post('/api/wishlists').set(mutation)
      .send({ name: ' Living room ', currency: 'USD' }).expect(201);
    const listPath = `/api/wishlists/${created.body.id}`;
    const itemsPath = `${listPath}/items`;
    await agent.patch(listPath).set(mutation).send({ name: 'Home' }).expect(204);
    await agent.patch(listPath).set(mutation).send({ name: 'Home' }).expect(204);
    await agent.post(itemsPath).set(mutation).send(product).expect(201);
    await agent.post(itemsPath).set(mutation)
      .send({ name: 'Chair', url: null, priceMinor: 20, quantity: 1 }).expect(201);
    await agent.post(itemsPath).set(mutation)
      .send({ name: 'Desk', url: null, priceMinor: null, quantity: 1 }).expect(201);
    const detail = await agent.get(listPath).expect(200);
    expect(detail.body).toMatchObject({ name: 'Home', totalMinor: '50', unpriced: 1 });
    const lamp = detail.body.items.find((item: Item) => item.name === 'Lamp');
    expect(lamp).toMatchObject(product);
    const itemPath = `${itemsPath}/${lamp.id}`;
    await agent.put(itemPath).set(mutation).send(product).expect(204);
    await agent.put(itemPath).set(mutation).send({ ...product, priceMinor: 0, quantity: 2 }).expect(204);
    const updated = await agent.get(listPath).expect(200);
    expect(updated.body).toMatchObject({ totalMinor: '20', unpriced: 1 });
    await agent.delete(itemPath).set(mutation).send({}).expect(204);
    const remaining = await agent.get(listPath).expect(200);
    expect(remaining.body.items).toHaveLength(2);
    const reopened = await agent.post('/api/session').set(mutation).send({}).expect(200);
    expect(reopened.body).toEqual([{ id: created.body.id, name: 'Home', currency: 'USD' }]);
    await agent.delete(listPath).set(mutation).send({}).expect(204);
    await agent.get(listPath).expect(404);
    await agent.get('/api/wishlists').expect(200, []);
  });

  it('enforces ownership on every operation and scopes products to their wishlist', async () => {
    const owner = request.agent(app);
    const other = request.agent(app);
    await owner.post('/api/session').set(mutation).send({}).expect(200);
    await other.post('/api/session').set(mutation).send({}).expect(200);
    const create = (name: string) => owner.post('/api/wishlists').set(mutation).send({ name, currency: 'USD' }).expect(201);
    const first = await create('First');
    const second = await create('Second');
    const firstPath = `/api/wishlists/${first.body.id}`;
    const secondPath = `/api/wishlists/${second.body.id}`;
    await owner.post(`${firstPath}/items`).set(mutation).send(product).expect(201);
    const detail = await owner.get(firstPath).expect(200);
    const itemId = detail.body.items[0].id;
    const itemPath = `${firstPath}/items/${itemId}`;
    await request(app).get(firstPath).expect(401);
    await request(app).get(firstPath).set('Cookie', `nanti=${randomUUID()}`).expect(401);
    await other.get('/api/wishlists').expect(200, []);
    await other.get(firstPath).expect(404);
    await other.patch(firstPath).set(mutation).send({ name: 'Changed' }).expect(404);
    await other.delete(firstPath).set(mutation).send({}).expect(404);
    await other.post(`${firstPath}/items`).set(mutation).send(product).expect(404);
    await other.put(itemPath).set(mutation).send(product).expect(404);
    await other.delete(itemPath).set(mutation).send({}).expect(404);
    await owner.put(`${secondPath}/items/${itemId}`).set(mutation).send(product).expect(404);
    await owner.delete(`${secondPath}/items/${itemId}`).set(mutation).send({}).expect(404);
    await owner.get(firstPath).expect(200, detail.body);
    await owner.delete(firstPath).set(mutation).send({}).expect(204);
    await owner.delete(secondPath).set(mutation).send({}).expect(204);
  });

  it('rejects invalid fields and unverified writes, with manual entry available after a lookup miss', async () => {
    const agent = request.agent(app);
    await agent.post('/api/session').send({}).expect(403);
    await agent.post('/api/session').set(mutation).send({}).expect(200);
    await agent.post('/api/wishlists').set(mutation).send({ name: ' ', currency: 'USD' }).expect(400);
    await agent.post('/api/wishlists').set(mutation).send({ name: 'Home', currency: 'ZZZ' }).expect(400);
    await agent.post('/api/wishlists').set(mutation).send({ name: 'Home', currency: 'USD', ownerId: randomUUID() }).expect(400);
    await agent.post('/api/wishlists').send({ name: 'Home', currency: 'USD' }).expect(403);
    const list = await agent.post('/api/wishlists').set(mutation).send({ name: 'Home', currency: 'USD' }).expect(201);
    const path = `/api/wishlists/${list.body.id}`;
    for (const data of [{ priceMinor: -1 }, { priceMinor: 0.1 }, { quantity: 0 }, { url: 'ftp://example.com' }]) {
      await agent.post(`${path}/items`).set(mutation).send({ ...product, ...data }).expect(400);
    }
    await agent.post('/api/products/preview').set(mutation).send({ url: 'not-a-url' }).expect(400);
    expect(preview).not.toHaveBeenCalled();
    await agent.post('/api/products/preview').set(mutation).send({ url: product.url }).expect(200, { name: null });
    await agent.post(`${path}/items`).set(mutation).send(product).expect(201);
    await agent.delete(path).set(mutation).send({}).expect(204);
  });

  it('accepts imported prices up to the Prisma integer limit and rejects overflow', async () => {
    const agent = request.agent(app);
    await agent.post('/api/session').set(mutation).send({}).expect(200);
    const list = await agent.post('/api/wishlists').set(mutation)
      .send({ name: 'High value product', currency: 'IDR' }).expect(201);
    const path = `/api/wishlists/${list.body.id}/items`;
    const amount = { ...product, priceMinor: 1_735_000_000 };
    await agent.post(path).set(mutation).send(amount).expect(201);
    await expect(agent.get(`/api/wishlists/${list.body.id}`).expect(200))
      .resolves.toMatchObject({ body: { items: [expect.objectContaining({ priceMinor: 1_735_000_000 })] } });
    await agent.post(path).set(mutation).send({ ...product, priceMinor: 2_147_483_648 }).expect(400);
  });
}

describe('Wishlist API', () => contract(memoryWishlists()));

const databaseUrl = testDatabaseUrl;
describe.skipIf(!databaseUrl)('Wishlist API with MySQL-compatible persistence', () => {
  const db = connectDatabase(databaseUrl ?? 'mysql://127.0.0.1/nanti_test');
  afterAll(() => db.$disconnect());
  contract(prismaWishlists(db));
  it('saves a Tokopedia preview with an optional preview-only image and isolates the saved item by owner', async () => {
    const url = 'https://TOKOPEDIA.LINK:443/helm?ref=%2f#saved';
    const name = 'Helm Full Face MLA Crypton';
    const sellerName = 'Fixture Helmet Shop';
    const options = {
      secret: randomBytes(32).toString('hex'), secureCookies: false, preview: async () => null,
      lookupMetadata: async () => ({
        title: name, sellerName, image: 'https://images.tokopedia.net/fixture.jpg',
        productUrl: 'https://www.tokopedia.com/shop/helm',
        price: { priceMinor: 1735000000, currency: 'IDR' as const },
      }),
    };
    const app = createApp({ ...options, repository: prismaWishlists(db) });
    const agent = request.agent(app);
    const session = await agent.post('/api/session').set(mutation).send({}).expect(200);
    const cookie = session.headers['set-cookie']![0]!.split(';')[0]!;
    const { body: list } = await agent.post('/api/wishlists').set(mutation)
      .send({ name: 'Helmet save regression', currency: 'IDR' }).expect(201);
    const { body: preview } = await agent.post('/api/products/import').set(mutation).send({ url }).expect(200);
    expect(preview).toMatchObject({ originalUrl: url, name, sellerName,
      price: { priceMinor: 1735000000, currency: 'IDR' }, imagePath: expect.any(String) });
    expect(preview.canSaveImage).toBeUndefined();
    const input = { name: preview.name, url: preview.originalUrl, sellerName: preview.sellerName,
      priceMinor: preview.price.priceMinor, quantity: 1, imageKey: null, priceSource: 'imported_unverified' };
    const listPath = '/api/wishlists/' + list.id;
    await agent.post(listPath + '/items').set(mutation).send(input).expect(201);
    const fresh = createApp({ ...options, repository: prismaWishlists(db) });
    const { body: reloaded } = await request(fresh).get(listPath).set('Cookie', cookie).expect(200);
    expect(reloaded.items).toEqual([{ id: expect.any(String), name, url, sellerName,
      priceMinor: 1735000000, quantity: 1, imageKey: null }]);
    const other = request.agent(fresh);
    await other.post('/api/session').set(mutation).send({}).expect(200);
    await other.get(listPath).expect(404);
    await other.post(listPath + '/items').set(mutation).send(input).expect(404);
  });
  it('copies a Tokopedia photo on save, deduplicates retries, and reloads private bytes', async () => {
    const storage = createImageStorage({
      NANTI_S3_ENDPOINT: 'https://storage.example.com', NANTI_S3_BUCKET: 'nanti-test',
      NANTI_S3_REGION: 'auto', NANTI_S3_ACCESS_KEY_ID: 'test', NANTI_S3_SECRET_ACCESS_KEY: 'test',
    })!;
    const bytes = Buffer.from([255, 216, 255, 217]);
    const download = vi.spyOn(tokopedia, 'downloadTokopediaImage').mockResolvedValue(bytes);
    const store = vi.spyOn(storage, 'storeJpeg').mockImplementation(async (owner, _body, key) => key ?? storage.createUpload(owner).key);
    vi.spyOn(storage, 'readJpeg').mockResolvedValue(bytes);
    const options = {
      secret: randomBytes(32).toString('hex'), secureCookies: false, imageStorage: storage, preview: async () => null,
      lookupMetadata: async () => ({ title: 'Helmet', price: null, image: 'https://images.tokopedia.net/helmet.jpg' }),
    };
    try {
      const agent = request.agent(createApp({ ...options, repository: prismaWishlists(db) }));
      const session = await agent.post('/api/session').set(mutation).send({}).expect(200);
      const cookie = session.headers['set-cookie']![0]!.split(';')[0]!;
      const { body: list } = await agent.post('/api/wishlists').set(mutation)
        .send({ name: 'Automatic photo', currency: 'IDR' }).expect(201);
      const path = '/api/wishlists/' + list.id;
      const url = 'https://tokopedia.link/helmet?ref=%2f#saved';
      const input = { name: 'Helmet', url, priceMinor: 34500000, quantity: 1, saveTokopediaImage: true };
      const key = randomUUID();
      for (let retry = 0; retry < 2; retry++) {
        await agent.post(path + '/items').set(mutation).set('Idempotency-Key', key).send(input)
          .expect(201, { photoStatus: 'saved' });
      }
      expect(download).toHaveBeenCalledOnce();
      expect(store).toHaveBeenCalledOnce();
      const fresh = createApp({ ...options, repository: prismaWishlists(db) });
      const { body } = await request(fresh).get(path).set('Cookie', cookie).expect(200);
      expect(body.items).toEqual([expect.objectContaining({ id: key, url, imageKey: expect.stringMatching(/^products\//) })]);
      const imagePath = path + '/items/' + key + '/uploaded-image';
      await request(fresh).get(imagePath).set('Cookie', cookie).expect(200, bytes);
      const other = request.agent(fresh);
      await other.post('/api/session').set(mutation).send({}).expect(200);
      await other.get(imagePath).expect(404);
    } finally {
      download.mockRestore();
    }
  });
  it('saves text and discards an uncertain upload when automatic photo storage fails', async () => {
    const storage = createImageStorage({
      NANTI_S3_ENDPOINT: 'https://storage.example.com', NANTI_S3_BUCKET: 'nanti-test',
      NANTI_S3_REGION: 'auto', NANTI_S3_ACCESS_KEY_ID: 'test', NANTI_S3_SECRET_ACCESS_KEY: 'test',
    })!;
    const download = vi.spyOn(tokopedia, 'downloadTokopediaImage').mockResolvedValue(Buffer.from('fixture'));
    const store = vi.spyOn(storage, 'storeJpeg').mockRejectedValue(new Error('Fixture PUT timed out'));
    const discard = vi.spyOn(storage, 'discard').mockResolvedValue(true);
    try {
      const app = createApp({
        repository: prismaWishlists(db), secret: randomBytes(32).toString('hex'), secureCookies: false,
        imageStorage: storage, preview: async () => null,
        lookupMetadata: async () => ({ title: 'Helmet', price: null, image: 'https://images.tokopedia.net/helmet.jpg' }),
      });
      const owner = request.agent(app);
      await owner.post('/api/session').set(mutation).send({}).expect(200);
      const { body: list } = await owner.post('/api/wishlists').set(mutation)
        .send({ name: 'Photo fallback', currency: 'IDR' }).expect(201);
      const path = '/api/wishlists/' + list.id;
      const input = { name: 'Helmet', url: 'https://tokopedia.link/helm?ref=%2f#save', priceMinor: null,
        quantity: 1, saveTokopediaImage: true };
      const key = randomUUID();
      await owner.post(path + '/items').set('Idempotency-Key', key).send(input).expect(403);
      expect(store).not.toHaveBeenCalled();
      for (let retry = 0; retry < 2; retry++) {
        await owner.post(path + '/items').set(mutation).set('Idempotency-Key', key).send(input)
          .expect(201, { photoStatus: 'unavailable' });
      }
      expect(store).toHaveBeenCalledOnce();
      expect(discard).toHaveBeenCalledExactlyOnceWith(store.mock.calls[0]![2]);
      const { body } = await owner.get(path).expect(200);
      expect(body.items).toEqual([expect.objectContaining({ id: key, url: input.url, imageKey: null })]);
    } finally {
      download.mockRestore();
    }
  });
  it('reloads the original affiliate URL, seller and private photo through the API', async () => {
    const storage = createImageStorage({
      NANTI_S3_ENDPOINT: 'https://storage.example.com', NANTI_S3_BUCKET: 'nanti-test',
      NANTI_S3_REGION: 'auto', NANTI_S3_ACCESS_KEY_ID: 'test', NANTI_S3_SECRET_ACCESS_KEY: 'test',
    })!;
    const bytes = Buffer.from([255, 216, 255, 217]);
    vi.spyOn(storage, 'exists').mockResolvedValue(true);
    const read = vi.spyOn(storage, 'readJpeg').mockResolvedValue(bytes);
    const options = { secret: randomBytes(32).toString('hex'), secureCookies: false,
      preview: async () => null, imageStorage: storage };
    const app = createApp({ ...options, repository: prismaWishlists(db) });
    const agent = request.agent(app);
    const session = await agent.post('/api/session').set(mutation).send({}).expect(200);
    const cookie = session.headers['set-cookie']![0]!.split(';')[0]!;
    const { body: { id } } = await agent.post('/api/wishlists').set(mutation)
      .send({ name: 'Tokopedia photo', currency: 'IDR' }).expect(201);
    const { body: { key: imageKey } } = await agent.post('/api/uploads/product-image').set(mutation)
      .send({ contentType: 'image/jpeg', size: bytes.length }).expect(200);
    const url = 'https://TOKOPEDIA.LINK:443/abc?ref=%2f#saved';
    const input = { name: 'Product', url, sellerName: 'Tokopedia shop', imageKey, priceMinor: 173500000, quantity: 1 };
    const list = '/api/wishlists/' + id;
    await agent.post(list + '/items').set(mutation).send(input).expect(201);
    const fresh = createApp({ ...options, repository: prismaWishlists(db) });
    const { body: reloaded } = await request(fresh).get(list).set('Cookie', cookie).expect(200);
    expect(reloaded.items[0]).toMatchObject(input);
    const item = list + '/items/' + reloaded.items[0].id;
    const response = await request(fresh).get(item + '/uploaded-image').set('Cookie', cookie)
      .expect('Content-Type', /image\/jpeg/).expect('Cache-Control', 'private, no-store').expect(200);
    expect(response.body).toEqual(bytes);
    const stranger = request.agent(fresh);
    await stranger.post('/api/session').set(mutation).send({}).expect(200);
    await stranger.get(item + '/uploaded-image').expect(404);
    expect(read).toHaveBeenCalledExactlyOnceWith(imageKey);
    await request(fresh).put(item).set(mutation).set('Cookie', cookie)
      .send({ ...input, sellerName: null, imageKey: null }).expect(204);
    const { body: cleared } = await request(fresh).get(list).set('Cookie', cookie).expect(200);
    expect(cleared.items[0]).toMatchObject({ url, sellerName: null, imageKey: null });
  });
  it('cascades wishlist deletion to persisted products', async () => {
    const repository = prismaWishlists(db);
    const ownerId = randomUUID();
    const { id } = await repository.create(ownerId, { name: 'Cascade', currency: 'THB' });
    await repository.addItem(ownerId, id, product);
    expect(await db.item.count({ where: { ownerId, wishlistId: id } })).toBe(1);
    await repository.remove(ownerId, id);
    expect(await db.item.count({ where: { ownerId, wishlistId: id } })).toBe(0);
  });
});

describe('price and URL validation', () => {
  it('converts exact minor units and rejects ambiguous decimal prices', () => {
    expect(parsePrice('0.10')).toBe(10);
    expect(parsePrice(' 0.2 ')).toBe(20);
    expect(parsePrice('0')).toBe(0);
    expect(parsePrice('9999999.99')).toBe(999999999);
    expect(parsePrice('10000000')).toBe(1000000000);
    expect(parsePrice('21474836.47')).toBe(2147483647);
    for (const price of ['', '0.001', '1e3', '1,200', '-1', '21474836.48']) {
      expect(parsePrice(price)).toBeNull();
    }
    const digits = formatPrice('900719925474099501', 'USD').replace(/[^0-9]/g, '');
    expect(digits).toBe('900719925474099501');
  });

  it('rejects URL schemes, embedded credentials and ambiguous separators', () => {
    for (const url of ['ftp://example.com', 'https://a:b@example.com', '//example.com', 'https://example.com/a b']) {
      expect(safeProductUrl(url)).toBeNull();
    }
    expect(safeProductUrl('https://example.com')?.href).toBe('https://example.com/');
  });
});
