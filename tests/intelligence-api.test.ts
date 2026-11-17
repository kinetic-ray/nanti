import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/database.js';
import type { IntelligenceRepository } from '../server/intelligence.js';
import { prismaIntelligence } from '../server/prisma-intelligence.js';
import { prismaWishlists } from '../server/prisma-wishlists.js';
import type { WishlistRepository } from '../server/wishlist.js';
import { intelligenceModules } from '../shared/methodology.js';
import type { Item } from '../shared/wishlist.js';

const mutation = { 'X-Nanti-Request': '1', 'Content-Type': 'application/json' };
const intelligence = '/api/intelligence';
const product = { name: 'Lamp', priceMinor: 2500, quantity: 2, url: null };

function application(repository: WishlistRepository, assessments: IntelligenceRepository, secret = randomBytes(32).toString('hex')) {
  return createApp({ repository, intelligence: assessments, preview: async () => null, secret, secureCookies: false });
}

describe('Purchase intelligence HTTP validation', () => {
  const item = { id: randomUUID(), ...product };
  const list = { id: randomUUID(), name: 'Home', currency: 'THB' as const, items: [item] };
  const path = `${intelligence}/wishlists/${list.id}`;
  const itemPath = `${path}/items/${item.id}`;
  const wishlists: WishlistRepository = {
    list: vi.fn(), find: vi.fn().mockResolvedValue(list), create: vi.fn(), rename: vi.fn(), remove: vi.fn(),
    addItem: vi.fn(), updateItem: vi.fn(), removeItem: vi.fn(),
  };
  const repository: IntelligenceRepository = {
    history: vi.fn(), save: vi.fn(), remove: vi.fn(), preferences: vi.fn(), setPreferences: vi.fn(),
  };
  const app = application(wishlists, repository);

  it('requires a signed session and the existing verified mutation header', async () => {
    await request(app).get(`${itemPath}/impulse`).expect(401);
    await request(app).get(`${path}/comparisons`).set('Cookie', `nanti=${randomUUID()}`).expect(401);
    await request(app).get(`${intelligence}/preferences`).expect(401);
    await request(app).post(`${path}/timing`).set(mutation).send({}).expect(401);
    const agent = request.agent(app);
    await agent.post('/api/session').set(mutation).send({}).expect(200);
    await agent.post(`${itemPath}/impulse`).send({}).expect(403);
    await agent.post(`${path}/timing`).send({}).expect(403);
  });

  it('rejects malformed inputs and invented ownership, pricing, and ranking fields', async () => {
    const agent = request.agent(app);
    await agent.post('/api/session').set(mutation).send({}).expect(200);
    await agent.post(`${itemPath}/impulse`).set(mutation).send({ promotion: 'yes' }).expect(400);
    await agent.post(`${itemPath}/impulse`).set(mutation).send({ ownerId: randomUUID() }).expect(400);
    await agent.get(`${itemPath}/impulse?before=invalid`).expect(400);
    await agent.put(`${intelligence}/preferences`).set(mutation).send({ coolingOffDays: 1.5 }).expect(400);
    await agent.put(`${intelligence}/preferences`).set(mutation).send({ coolingOffDays: 366 }).expect(400);
    for (const data of [{ liquidMinor: '-1' }, { liquidMinor: 10 }, { targetDate: '2026-02-29' }, { currency: 'USD' }]) {
      await agent.post(`${itemPath}/timing`).set(mutation).send(data).expect(400);
    }
    await agent.post(`${itemPath}/timing`).set(mutation).send({ purchaseMinor: '1' }).expect(400)
      .expect(({ body }) => expect(body.code).toBe('invalid_purchase_cost'));
    const criterion = { id: randomUUID(), name: 'Unit price', kind: 'price', weight: 1 };
    const input = { criteria: [criterion], alternatives: [{ itemId: item.id, ratings: {} }, { itemId: randomUUID(), ratings: {} }] };
    for (const data of [
      { ...input, affiliateCommission: 99 },
      { ...input, criteria: [{ ...criterion, weight: -1 }] },
      { ...input, criteria: [criterion, criterion] },
      { ...input, alternatives: [input.alternatives[0], input.alternatives[0]] },
      { ...input, alternatives: [{ itemId: item.id, ratings: { [criterion.id]: { value: 1, note: '' } } }, input.alternatives[1]] },
    ]) await agent.post(`${path}/comparisons`).set(mutation).send(data).expect(400);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.setPreferences).not.toHaveBeenCalled();
  });

  it('returns versioned methodology and keeps analysis responses out of caches', async () => {
    const agent = request.agent(app);
    await agent.post('/api/session').set(mutation).send({}).expect(200);
    for (const module of intelligenceModules) {
      const current = await agent.get(`${intelligence}/methodology/${module}`).expect('Cache-Control', 'no-store').expect(200);
      await agent.get(`${intelligence}/methodology/${module}/${current.body.version}`).expect(200, current.body);
      await agent.get(`${intelligence}/methodology/${module}/9.9.9`).expect(404);
    }
    await agent.post(`${itemPath}/timing`).set(mutation).send({ liquidMinor: '5000', reserveMinor: '0' })
      .expect('Cache-Control', 'no-store').expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'Insufficient Data', missing: ['Essential obligations'], totalMinor: '5000' }));
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('Purchase intelligence with MySQL persistence', () => {
  const db = connectDatabase(databaseUrl ?? 'mysql://127.0.0.1/nanti_test');
  const wishlists = prismaWishlists(db);
  const assessments = prismaIntelligence(db);
  const secret = randomBytes(32).toString('hex');
  const app = application(wishlists, assessments, secret);
  const owners = new Set<string>();

  async function session() {
    const agent = request.agent(app);
    const response = await agent.post('/api/session').set(mutation).send({}).expect(200);
    const cookie = String(response.headers['set-cookie']?.[0]).split(';')[0]!;
    const ownerId = decodeURIComponent(cookie.slice('nanti='.length)).slice(2).split('.')[0]!;
    expect(ownerId).toHaveLength(36);
    owners.add(ownerId);
    return { agent, cookie, ownerId };
  }

  async function fixture(agent: Awaited<ReturnType<typeof session>>['agent']) {
    const { body } = await agent.post('/api/wishlists').set(mutation).send({ name: 'Home', currency: 'THB' }).expect(201);
    const phaseOne = `/api/wishlists/${body.id}`;
    const path = `${intelligence}/wishlists/${body.id}`;
    await agent.post(`${phaseOne}/items`).set(mutation).send(product).expect(201);
    await agent.post(`${phaseOne}/items`).set(mutation)
      .send({ ...product, name: 'Chair', priceMinor: 3500, quantity: 1 }).expect(201);
    const detail = await agent.get(phaseOne).expect(200);
    const items = detail.body.items as Item[];
    return { id: body.id as string, phaseOne, path, item: items[0]!, second: items[1]! };
  }

  afterEach(async () => {
    const ownerId = { in: [...owners] };
    await db.wishlist.deleteMany({ where: { ownerId } });
    await db.intelligencePreference.deleteMany({ where: { ownerId } });
    owners.clear();
  });
  afterAll(() => db.$disconnect());

  it('persists private preferences and historical impulse retakes across connections', async () => {
    const { agent, cookie } = await session();
    const other = await session();
    const { path, item, second, phaseOne } = await fixture(agent);
    const itemPath = `${path}/items/${item.id}/impulse`;
    await agent.get(`${intelligence}/preferences`).expect(200, { coolingOffDays: null });
    await agent.put(`${intelligence}/preferences`).set(mutation).send({ coolingOffDays: 4 }).expect(204);
    await other.agent.get(`${intelligence}/preferences`).expect(200, { coolingOffDays: null });
    const first = await agent.post(itemPath).set(mutation).send({ temporary: true }).expect(201);
    await agent.put(`${intelligence}/preferences`).set(mutation).send({ coolingOffDays: null }).expect(204);
    const secondCheck = await agent.post(itemPath).set(mutation).send({ temporary: false }).expect(201);
    expect(first.body).toMatchObject({ input: { temporary: true }, version: '1.0.0', result: { coolingOffDays: 4 } });
    expect(secondCheck.body).toMatchObject({ input: { temporary: false }, result: { coolingOffDays: null } });

    const anotherConnection = connectDatabase(databaseUrl!);
    try {
      const rebooted = application(prismaWishlists(anotherConnection), prismaIntelligence(anotherConnection), secret);
      await request(rebooted).get(itemPath).set('Cookie', cookie).expect(200, { records: [secondCheck.body, first.body], next: null });
    } finally {
      await anotherConnection.$disconnect();
    }
    await other.agent.get(itemPath).expect(404);
    await other.agent.post(itemPath).set(mutation).send({}).expect(404);
    await other.agent.delete(`${itemPath}/${first.body.id}`).set(mutation).send({}).expect(404);
    await agent.delete(`${path}/items/${second.id}/impulse/${first.body.id}`).set(mutation).send({}).expect(404);
    const otherList = await fixture(agent);
    await agent.post(`${otherList.path}/items/${item.id}/impulse`).set(mutation).send({}).expect(404);
    await agent.delete(`${itemPath}/${first.body.id}`).set(mutation).send({}).expect(204);
    await agent.delete(`${itemPath}/${first.body.id}`).set(mutation).send({}).expect(404);
    await agent.get(itemPath).expect(200, { records: [secondCheck.body], next: null });
    await agent.delete(`${phaseOne}/items/${item.id}`).set(mutation).send({}).expect(204);
    expect(await db.assessment.findUnique({ where: { id: secondCheck.body.id } })).toBeNull();
  });

  it('scopes comparisons to their wishlist, preserves inputs and results, and cascades wishlist deletion', async () => {
    const { agent } = await session();
    const other = await session();
    const { path, phaseOne, item, second, id } = await fixture(agent);
    const foreign = await fixture(other.agent);
    const price = { id: randomUUID(), name: 'Unit price', kind: 'price', weight: 2 };
    const comfort = { id: randomUUID(), name: 'Comfort', kind: 'benefit', weight: 1 };
    const input = {
      criteria: [price, comfort],
      alternatives: [
        { itemId: item.id, ratings: { [comfort.id]: { value: 1, note: 'Tried in person' } } },
        { itemId: second.id, ratings: { [comfort.id]: { value: 9, note: '' } } },
      ],
    };
    const endpoint = `${path}/comparisons`;
    await agent.post(endpoint).set(mutation).send({ ...input, alternatives: [input.alternatives[0], { itemId: foreign.item.id, ratings: {} }] }).expect(404);
    const saved = await agent.post(endpoint).set(mutation).send(input).expect(201);
    expect(saved.body).toMatchObject({ input, version: '1.0.0', result: { ranking: [{ id: item.id, rank: 1 }, { id: second.id, rank: 2 }] } });
    const revised = await agent.post(endpoint).set(mutation).send({ ...input, criteria: [price, { ...comfort, weight: 3 }] }).expect(201);
    expect(revised.body.result.ranking[0].id).toBe(second.id);
    await other.agent.get(endpoint).expect(404);
    await other.agent.delete(`${endpoint}/${saved.body.id}`).set(mutation).send({}).expect(404);
    await agent.delete(`${endpoint}/${revised.body.id}`).set(mutation).send({}).expect(204);
    await agent.delete(`${phaseOne}/items/${item.id}`).set(mutation).send({}).expect(204);
    await agent.get(endpoint).expect(200, { records: [saved.body], next: null });
    await agent.get(phaseOne).expect(200).expect(({ body }) => {
      expect(body).not.toHaveProperty('assessments');
      expect(body.items[0]).not.toHaveProperty('assessment');
    });
    await agent.delete(phaseOne).set(mutation).send({}).expect(204);
    expect(await db.assessment.count({ where: { wishlistId: id } })).toBe(0);
  });

  it('pages history without returning an entry from another product or skipping same-time records', async () => {
    const { agent, ownerId } = await session();
    const { path, id, item, second } = await fixture(agent);
    const createdAt = new Date('2026-11-16T00:00:00Z');
    const records = Array.from({ length: 16 }, () => ({
      id: randomUUID(), ownerId, wishlistId: id, itemId: item.id, kind: 'impulse' as const, version: '1.0.0',
      input: {}, result: { concern: 'Insufficient information' }, createdAt,
    }));
    await db.assessment.createMany({ data: [...records, { ...records[0]!, id: randomUUID(), itemId: second.id }] });
    const endpoint = `${path}/items/${item.id}/impulse`;
    const first = await agent.get(endpoint).expect(200);
    expect(first.body.records).toHaveLength(15);
    const older = await agent.get(endpoint).query({ before: first.body.next }).expect(200);
    expect(older.body.records).toHaveLength(1);
    expect(older.body.next).toBeNull();
    const ids = [...first.body.records, ...older.body.records].map(({ id }) => id);
    expect(ids.sort()).toEqual(records.map(({ id }) => id).sort());
  });

  it('uses exact saved totals and protects cash inputs from wishlist responses and persistence', async () => {
    const { agent, ownerId } = await session();
    const other = await session();
    const { path, phaseOne, item } = await fixture(agent);
    const input = { liquidMinor: '9500', obligationsMinor: '500', reserveMinor: '500' };
    await agent.post(`${path}/timing`).set(mutation).send(input).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'Buy Now', totalMinor: '8500', availableMinor: '8500' }));
    await agent.post(`${path}/items/${item.id}/timing`).set(mutation).send(input).expect(200)
      .expect(({ body }) => expect(body.totalMinor).toBe('5000'));
    await other.agent.post(`${path}/timing`).set(mutation).send(input).expect(404);
    await agent.post(`${phaseOne}/items`).set(mutation).send({ ...product, name: 'Unknown', priceMinor: null }).expect(201);
    await agent.post(`${path}/timing`).set(mutation).send(input).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'Insufficient Data', missing: ['Purchase cost'], totalMinor: null }));
    await agent.post(`${path}/timing`).set(mutation).send({ ...input, purchaseMinor: '8499' }).expect(400);
    await agent.post(`${path}/timing`).set(mutation).send({ ...input, purchaseMinor: '8501', monthlyMinor: '1' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'Wait', gapMinor: '1', months: '1' }));
    await agent.get(phaseOne).expect(200).expect(({ body }) => {
      expect(body).toMatchObject({ unpriced: 1, totalMinor: '8500' });
      for (const key of [...Object.keys(input), 'assessments', 'result']) expect(body).not.toHaveProperty(key);
    });
    expect(await db.assessment.count({ where: { ownerId } })).toBe(0);
  });
});
