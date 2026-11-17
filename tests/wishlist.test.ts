import { randomBytes, randomUUID } from 'node:crypto';
import { connectDatabase } from '../server/database.js';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
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
}

describe('Wishlist API', () => contract(memoryWishlists()));

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('Wishlist API with MySQL-compatible persistence', () => {
  const db = connectDatabase(databaseUrl ?? 'mysql://127.0.0.1/nanti_test');
  afterAll(() => db.$disconnect());
  contract(prismaWishlists(db));
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
    for (const price of ['', '0.001', '1e3', '1,200', '-1', '10000000']) {
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
