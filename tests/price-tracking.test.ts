import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/database.js';
import { prismaAccounts, tokenHash } from '../server/prisma-accounts.js';
import { prismaIntelligence } from '../server/prisma-intelligence.js';
import { prismaPrices } from '../server/prisma-prices.js';
import { prismaWishlists } from '../server/prisma-wishlists.js';

const mutation = { 'X-Nanti-Request': '1', 'Content-Type': 'application/json' };
const link = 'https://retailer.example.test/p/lamp?utm_source=user';
const testDatabase = process.env.TEST_DATABASE_URL;

it('recognizes supported storefronts, preserves original destinations, and fetches only an explicitly enabled IKEA adapter', async () => {
  const preview = vi.fn().mockResolvedValueOnce('Fixture retailer title').mockResolvedValueOnce(null);
  const app = createApp({ preview, secureCookies: false, secret: randomUUID(),
    repository: { list: vi.fn().mockResolvedValue([]), find: vi.fn(), create: vi.fn(), rename: vi.fn(),
      remove: vi.fn(), addItem: vi.fn(), updateItem: vi.fn(), removeItem: vi.fn() } });
  const guest = request.agent(app);
  await guest.post('/api/session').set(mutation).send({}).expect(200);
  for (const [url, merchant] of [
    ['https://shopee.co.id/item-i.12.34?sp_atk=keep', 'shopee'],
    ['https://tokopedia.link/fixture', 'tokopedia'],
    ['https://www.ikea.co.id/en/products/fixture', 'ikea'],
    [link, 'other'],
  ] as const) {
    await guest.post('/api/products/import').set(mutation).send({ url }).expect(200, {
      merchant, hostname: new URL(url).hostname, originalUrl: url, name: null, status: 'manual_required',
    });
  }
  expect(preview).not.toHaveBeenCalled();
  const ikea = 'https://www.ikea.com/us/en/p/fixture-12345678/?utm_source=user';
  await guest.post('/api/products/import').set(mutation).send({ url: ikea }).expect(200, {
    merchant: 'ikea', hostname: 'www.ikea.com', originalUrl: ikea, name: 'Fixture retailer title', status: 'name_available',
  });
  await guest.post('/api/products/import').set(mutation).send({ url: ikea }).expect(200).expect(({ body }) =>
    expect(body.status).toBe('manual_required'));
  for (const url of ['file:///tmp/test', 'http://localhost:9999/', 'http://10.0.0.1/',
    'https://store.example.test/?redirect=https%3A%2F%2Fother.example.test']) {
    await guest.post('/api/products/import').set(mutation).send({ url }).expect(400);
  }
  expect(preview).toHaveBeenCalledTimes(2);
});

it('returns a reviewable authorized preview while keeping external image URLs out of the response', async () => {
  const listing = 'https://www.ikea.com/us/en/p/fixture-12345678/';
  const productMedia = vi.fn().mockResolvedValue({ type: 'image/jpeg', bytes: Buffer.from([255, 216, 255, 217]) });
  const lookupMetadata = vi.fn().mockResolvedValue({ title: 'Fixture lamp',
    image: 'https://www.ikea.com/us/en/images/products/lamp.jpg', price: { priceMinor: 1234, currency: 'USD' } });
  const app = createApp({ preview: async () => null, lookupMetadata, productMedia, secureCookies: false, secret: randomUUID(),
    repository: { list: vi.fn().mockResolvedValue([]), find: vi.fn(), create: vi.fn(), rename: vi.fn(),
      remove: vi.fn(), addItem: vi.fn(), updateItem: vi.fn(), removeItem: vi.fn() } });
  const guest = request.agent(app);
  await guest.post('/api/session').set(mutation).send({}).expect(200);
  const { body } = await guest.post('/api/products/import').set(mutation).send({ url: listing + '?utm_source=fixture' }).expect(200);
  expect(body).toEqual({ originalUrl: listing + '?utm_source=fixture', merchant: 'ikea', hostname: 'www.ikea.com',
    status: 'details_available', name: 'Fixture lamp', price: { priceMinor: 1234, currency: 'USD' },
    imagePath: `/api/products/import/image?url=${encodeURIComponent(listing)}` });
  await request(app).get(body.imagePath).expect(401);
  await guest.get('/api/products/import/image').query({ url: 'https://retailer.example.test/image.jpg' }).expect(404);
  expect(productMedia).not.toHaveBeenCalled();
  await guest.get(body.imagePath).expect('Content-Type', 'image/jpeg').expect(200);
  expect(productMedia).toHaveBeenCalledExactlyOnceWith(listing);
});

describe.skipIf(!testDatabase)('Prices through MySQL and the consumer HTTP API', () => {
  const db = connectDatabase(testDatabase ?? 'mysql://127.0.0.1/nanti_test');
  const accounts = prismaAccounts(db);
  const guestOwners = new Set<string>();
  const users = new Set<string>();
  const app = createApp({
    repository: prismaWishlists(db), intelligence: prismaIntelligence(db), prices: prismaPrices(db),
    consumer: { accounts, providers: {} }, preview: async () => null,
    secret: randomBytes(32).toString('hex'), secureCookies: false,
  });
  const http = request(app);
  const alerts = '/api/prices/alerts';

  async function guest() {
    const response = await http.post('/api/session').set(mutation).send({}).expect(200);
    const header = (response.headers as Record<string, unknown>)['set-cookie'];
    const cookie = Array.isArray(header) ? String(header[0]).split(';')[0]! : '';
    const ownerId = decodeURIComponent(cookie.slice('nanti='.length)).slice(2).split('.')[0]!;
    guestOwners.add(ownerId);
    return { cookie, ownerId };
  }

  async function product(cookie: string, priceMinor: number | null = 10_001) {
    const { body: list } = await http.post('/api/wishlists').set(mutation).set('Cookie', cookie)
      .send({ currency: 'IDR', name: 'Price fixture' }).expect(201);
    const wishlist = `/api/wishlists/${list.id}`;
    await http.post(`${wishlist}/items`).set(mutation).set('Cookie', cookie)
      .send({ name: 'Lamp', quantity: 2, priceMinor, url: link }).expect(201);
    const { body: detail } = await http.get(wishlist).set('Cookie', cookie).expect(200);
    const item = `${wishlist}/items/${detail.items[0].id}`;
    return { item, prices: `${item}/prices`, timing: `/api/intelligence/wishlists/${list.id}/timing`, itemId: detail.items[0].id };
  }

  async function signIn(subject: string, ownerId: string | null = null) {
    const session = await accounts.signin('google', subject, null, ownerId);
    const stored = await db.userSession.findUniqueOrThrow({ where: { tokenHash: tokenHash(session) } });
    users.add(stored.userId);
    return `nanti-user=${session}`;
  }

  afterEach(async () => {
    await db.user.deleteMany({ where: { id: { in: [...users] } } });
    await db.dataOwner.deleteMany({ where: { id: { in: [...guestOwners] } } });
    users.clear();
    guestOwners.clear();
  });
  afterAll(() => db.$disconnect());

  it('keeps an imported price unverified when saving a product and records a manual change separately', async () => {
    const { cookie } = await guest();
    const { body: list } = await http.post('/api/wishlists').set(mutation).set('Cookie', cookie)
      .send({ currency: 'IDR', name: 'Import fixture' }).expect(201);
    const path = `/api/wishlists/${list.id}`;
    const data = { name: 'Lamp', quantity: 1, priceMinor: 12_345, url: link };
    await http.post(`${path}/items`).set(mutation).set('Cookie', cookie)
      .send({ ...data, priceSource: 'imported_unverified' }).expect(201);
    const { body: detail } = await http.get(path).set('Cookie', cookie).expect(200);
    const item = `${path}/items/${detail.items[0].id}`;
    await http.get(`${item}/prices`).set('Cookie', cookie).expect(200).expect(({ body }) => {
      expect(body.observations).toHaveLength(1);
      expect(body.observations[0]).toMatchObject({ source: 'imported_unverified', priceMinor: 12_345 });
      expect(body.lastVerifiedAt).toBeNull();
    });
    await http.put(item).set(mutation).set('Cookie', cookie).send({ ...data, priceMinor: 22_345 }).expect(204);
    await http.get(`${item}/prices`).set('Cookie', cookie).expect(200).expect(({ body }) => {
      expect(body.observations.map((entry: { source: string }) => entry.source)).toEqual(['manual', 'imported_unverified']);
    });
  });

  it('records exact changes, deduplicates parallel writes, and refreshes saved assessments', async () => {
    const { cookie } = await guest();
    const entry = await product(cookie);
    const target = `${entry.prices}/target`;
    await http.get(entry.prices).set('Cookie', cookie).expect(200).expect(({ body }) => {
      expect(body.observations).toHaveLength(1);
      expect(body.observations[0]).toMatchObject({ priceMinor: 10_001, currency: 'IDR', source: 'manual' });
      expect(body.previousMinor).toBeNull();
      expect(body.lastVerifiedAt).toBeNull();
    });
    await http.get(`${entry.prices}?before=not-a-number`).set('Cookie', cookie).expect(400);
    await http.get(`${entry.prices}?before=18446744073709551616`).set('Cookie', cookie).expect(400);
    await http.post(`${entry.timing}/history`).set(mutation).set('Cookie', cookie)
      .send({ liquidMinor: '40000', obligationsMinor: '500', reserveMinor: '1500' }).expect(201);
    await http.put(target).set(mutation).set('Cookie', cookie).send({ priceMinor: 9000, notify: true }).expect(204);
    const record = (priceMinor: number, source = 'manual') => http.post(entry.prices).set(mutation).set('Cookie', cookie)
      .send({ priceMinor, source });
    await record(8997, 'marketplace_verified').expect(400);
    const parallel = await Promise.all([record(8997, 'imported_unverified'), record(8997, 'imported_unverified')]);
    expect(parallel.map(result => result.status).sort()).toEqual([200, 201]);
    await http.get(entry.prices).set('Cookie', cookie).expect(200).expect(({ body }) => {
      expect(body).toMatchObject({ currentMinor: 8997, previousMinor: 10_001, lowestMinor: 8997, highestMinor: 10_001,
        observations: [{ priceMinor: 8997, source: 'imported_unverified' }, { priceMinor: 10_001, source: 'manual' }],
        target: { priceMinor: 9000, lastReachedAt: expect.any(String) } });
      expect(Number.isNaN(Date.parse(body.observations[0].observedAt))).toBe(false);
    });
    await http.get(`${entry.timing}/history`).set('Cookie', cookie).expect(200).expect(({ body }) =>
      expect(body.records[0].review).toContainEqual(expect.objectContaining({ kind: 'price', before: 10_001, after: 8997 })));
    await record(8990).expect(201);
    await http.get(alerts).set('Cookie', cookie).expect(200).expect(({ body }) => {
      expect(body.unread).toBe(1);
      expect(body.alerts).toHaveLength(1);
      expect(body.alerts[0]).toMatchObject({ itemName: 'Lamp', targetMinor: 9000,
        observation: { priceMinor: 8997, source: 'imported_unverified' } });
    });
    await record(9500).expect(201);
    await record(8995).expect(201);
    await http.get(alerts).set('Cookie', cookie).expect(200).expect(({ body }) => expect(body.unread).toBe(2));
    await http.put(target).set(mutation).set('Cookie', cookie).send({ priceMinor: 8800, notify: false }).expect(204);
    await record(8701).expect(201);
    await http.get(entry.prices).set('Cookie', cookie).expect(200).expect(({ body }) =>
      expect(body.target).toMatchObject({ priceMinor: 8800, notify: false, lastReachedAt: expect.any(String) }));
    await http.get(alerts).set('Cookie', cookie).expect(200).expect(({ body }) => expect(body.unread).toBe(2));
    await http.delete(target).set(mutation).set('Cookie', cookie).send({}).expect(204);
    await http.patch(alerts).set(mutation).set('Cookie', cookie).send({}).expect(204);
    await http.get(alerts).set('Cookie', cookie).expect(200).expect(({ body }) => expect(body.unread).toBe(0));
  });

  it('keeps observations, targets and alerts isolated through guest import and account deletion', async () => {
    const first = await guest();
    const other = await guest();
    const subject = randomUUID();
    const entry = await product(first.cookie, null);
    await http.get(entry.prices).set('Cookie', first.cookie).expect(200).expect(({ body }) =>
      expect(body).toMatchObject({ currentMinor: null, observations: [], lowestMinor: null, highestMinor: null }));
    await http.put(`${entry.prices}/target`).set(mutation).set('Cookie', first.cookie)
      .send({ priceMinor: 5_000, notify: true }).expect(204);
    await http.put(entry.item).set(mutation).set('Cookie', first.cookie)
      .send({ name: 'Lamp', quantity: 3, priceMinor: 4_999, url: link }).expect(204);
    await http.get(alerts).expect(401);
    await http.get(alerts).set('Cookie', other.cookie).expect(200, { alerts: [], unread: 0 });
    await http.get(entry.prices).set('Cookie', other.cookie).expect(404);
    await http.post(entry.prices).set(mutation).set('Cookie', other.cookie).send({ priceMinor: 10, source: 'manual' }).expect(404);
    await http.put(`${entry.prices}/target`).set(mutation).set('Cookie', other.cookie)
      .send({ priceMinor: 10, notify: true }).expect(404);

    const session = await signIn(subject, first.ownerId);
    const signed = `${session}; ${first.cookie}`;
    await http.get(entry.prices).set('Cookie', signed).expect(404);
    await http.post('/api/account/import').set(mutation).set('Cookie', signed).send({ confirm: true }).expect(204);
    await http.get(entry.prices).set('Cookie', first.cookie).expect(401);
    const device = await signIn(subject);
    await http.get(entry.prices).set('Cookie', device).expect(200).expect(({ body }) =>
      expect(body).toMatchObject({ currentMinor: 4999, observations: [{ source: 'manual' }], target: { priceMinor: 5000 } }));
    await http.get(alerts).set('Cookie', device).expect(200).expect(({ body }) => expect(body.unread).toBe(1));
    await http.delete('/api/account').set(mutation).set('Cookie', device).send({ confirm: true }).expect(204);
    expect(await db.priceObservation.count({ where: { itemId: entry.itemId } })).toBe(0);
    expect(await db.priceTarget.count({ where: { itemId: entry.itemId } })).toBe(0);
    expect(await db.priceAlert.count({ where: { observation: { itemId: entry.itemId } } })).toBe(0);
  });
});
