import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/database.js';
import type { IntelligenceRepository } from '../server/intelligence.js';
import { prismaIntelligence } from '../server/prisma-intelligence.js';
import { prismaWishlists } from '../server/prisma-wishlists.js';
import type { WishlistRepository } from '../server/wishlist.js';
import { intelligenceModules } from '../shared/methodology.js';
import { readinessSelection } from '../shared/quick-timing.js';
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
    find: vi.fn(), findRequest: vi.fn(), clear: vi.fn(), prune: vi.fn(),
    financeContext: vi.fn().mockResolvedValue(null), setFinanceContext: vi.fn(),
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

  it('validates optional financial context and scopes it to the signed owner and currency', async () => {
    const agent = request.agent(app);
    await agent.post('/api/session').set(mutation).send({}).expect(200);
    const context = {
      cashMinor: '50000', essentialExpensesMinor: '20000', setAsideMinor: '5000',
      nextIncomeDate: '2026-12-01', nextIncomeMinor: '30000', canWait: true,
    };
    await agent.get(`${intelligence}/financial-context/IDR`).expect(200, null);
    await agent.put(`${intelligence}/financial-context/IDR`).send(context).expect(403);
    await agent.put(`${intelligence}/financial-context/XXX`).set(mutation).send(context).expect(400);
    await agent.put(`${intelligence}/financial-context/IDR`).set(mutation).send({ ...context, cashMinor: '-1' }).expect(400);
    await agent.put(`${intelligence}/financial-context/IDR`).set(mutation).send({ ...context, nextIncomeDate: '2026-02-29' }).expect(400);
    await agent.put(`${intelligence}/financial-context/IDR`).set(mutation).send({ ...context, extra: true }).expect(400);
    await agent.put(`${intelligence}/financial-context/IDR`).set(mutation)
      .send(Object.fromEntries(Object.keys(context).map((key) => [key, null]))).expect(400);
    await agent.put(`${intelligence}/financial-context/IDR`).set(mutation).send(context).expect(204);
    expect(repository.setFinanceContext).toHaveBeenCalledWith(expect.any(String), 'IDR', context, true);
    await agent.delete(`${intelligence}/financial-context/IDR`).set(mutation).send({}).expect(204);
    expect(repository.setFinanceContext).toHaveBeenLastCalledWith(expect.any(String), 'IDR', null, true);
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

  it('reopens saved waiting dates and reads both old and new private records without a migration', async () => {
    const { agent } = await session();
    const other = await session();
    const { path, item } = await fixture(agent);
    const endpoint = `${path}/items/${item.id}/impulse`;
    const prior = await agent.post(endpoint).set(mutation).send({ need: false }).expect(201);
    const input = { answers: { withoutDiscount: true, alreadyHave: false, useOften: true, canWait: false }, period: '3-days' };
    await agent.post(endpoint).set(mutation).send({ ...input, period: '4-days' }).expect(400);
    const saved = await agent.post(endpoint).set(mutation).send(input).expect(201);
    expect(saved.body).toMatchObject({ version: '2.0.0', input: input.answers,
      result: { period: '3-days', reviewOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u) } });
    const currentInput = { ...input, version: '3.0.0', answers: { ...input.answers, practicalNeed: true } };
    const current = await agent.post(endpoint).set(mutation).send(currentInput).expect(201);
    expect(current.body).toMatchObject({ version: '3.0.0', input: currentInput.answers,
      result: { period: '3-days', reviewOn: saved.body.result.reviewOn, outcome: 'green' } });
    const history = await agent.get(endpoint).expect(200);
    expect(history.body.records).toHaveLength(3);
    expect(history.body.records).toEqual(expect.arrayContaining([
      current.body,
      { ...saved.body, review: [{ kind: 'methodology' }] },
      { ...prior.body, review: [{ kind: 'methodology' }] },
    ]));
    await other.agent.get(endpoint).expect(404);
  });

  it('persists optional finance context by owner and currency and clears it through privacy controls', async () => {
    const first = await session();
    const second = await session();
    const idr = `${intelligence}/financial-context/IDR`;
    const usd = `${intelligence}/financial-context/USD`;
    const firstContext = {
      cashMinor: '500000', essentialExpensesMinor: '180000', setAsideMinor: '50000',
      nextIncomeDate: '2026-12-01', nextIncomeMinor: '1000000', canWait: true,
    };
    const otherCurrency = { ...firstContext, cashMinor: '20000' };
    await first.agent.get(idr).expect(200, null);
    await first.agent.put(idr).set(mutation).send(firstContext).expect(204);
    await first.agent.put(usd).set(mutation).send(otherCurrency).expect(204);
    await second.agent.get(idr).expect(200, null);
    await first.agent.get(idr).expect(200).expect(({ body }) => expect(body).toMatchObject({ context: firstContext }));
    await first.agent.get(usd).expect(200).expect(({ body }) => expect(body).toMatchObject({ context: otherCurrency }));

    await first.agent.delete(idr).set(mutation).send({}).expect(204);
    await first.agent.get(idr).expect(200, null);
    await first.agent.get(usd).expect(200).expect(({ body }) => expect(body).toMatchObject({ context: otherCurrency }));
    await first.agent.delete(`${intelligence}/data`).set(mutation).send({}).expect(204);
    await first.agent.get(usd).expect(200, null);
    await second.agent.get(idr).expect(200, null);
  });

  it('saves quick readiness without financial inputs and preserves the old result when a price changes', async () => {
    const { agent } = await session();
    const { phaseOne, path, item } = await fixture(agent);
    const endpoint = `${path}/items/${item.id}/timing/history`;
    const input = { mode: 'quick', answer: 'tight',
      expectedSelection: createHash('sha256').update(readinessSelection([item])).digest('hex') };
    await agent.post(endpoint).set(mutation).send({ ...input, liquidMinor: '10' }).expect(400);
    const saved = await agent.post(endpoint).set(mutation).send(input).expect(201);
    expect(saved.body).toMatchObject({ input: { mode: 'quick', answer: 'tight' },
      result: { version: '2.0.0', quote: { source: 'saved', subtotalMinor: '5000' } } });
    const row = await db.assessment.findUniqueOrThrow({ where: { id: saved.body.id } });
    expect(row.financial).toBeNull();
    await agent.put(`${phaseOne}/items/${item.id}`).set(mutation).send({ ...product, priceMinor: 5000 }).expect(204);
    await agent.post(endpoint).set(mutation).send(input).expect(409);
    const history = await agent.get(endpoint).expect(200);
    expect(history.body.records[0]).toMatchObject({ ...saved.body, review: [{ kind: 'price', before: 2500, after: 5000 }] });
  });

  it('compares products across owned wishlists and blocks foreign products', async () => {
    const { agent } = await session();
    const stranger = await session();
    const [first, second, foreign] = await Promise.all([fixture(agent), fixture(agent), fixture(stranger.agent)]);
    const endpoint = `${first.path}/comparisons`;
    const ratings = { usefulness: 2, urgency: 0, affordability: 1, preference: 1 };
    const input = {
      mode: 'priorities', emphasis: 'usefulness',
      alternatives: [{ wishlistId: first.id, itemId: first.item.id, ratings },
        { wishlistId: second.id, itemId: second.second.id, ratings }],
      expectedProducts: [first.item, second.second].map(({ id, priceMinor, quantity }) => ({ id, priceMinor, quantity })),
    };
    await agent.post(endpoint).set(mutation).send({ ...input, alternatives: [input.alternatives[0],
      { wishlistId: foreign.id, itemId: foreign.item.id, ratings }] }).expect(404);
    const saved = await agent.post(endpoint).set(mutation).send(input).expect(201);
    expect(saved.body.snapshot.products).toMatchObject([
      { id: first.item.id, currency: 'THB' }, { id: second.second.id, currency: 'THB' },
    ]);
    await stranger.agent.get(endpoint).expect(404);
    await agent.delete(second.phaseOne).set(mutation).send({}).expect(204);
    const history = await agent.get(endpoint).expect(200);
    expect(history.body.records[0]).toEqual({ ...saved.body, review: [{ kind: 'selection' }] });
  });

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
      await request(rebooted).get(itemPath).set('Cookie', cookie).expect(200, { records: [
        { ...secondCheck.body, review: [{ kind: 'methodology' }] },
        { ...first.body, review: [{ kind: 'methodology' }, { kind: 'preference' }] },
      ], next: null });
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
    await agent.get(itemPath).expect(200, { records: [{ ...secondCheck.body, review: [{ kind: 'methodology' }] }], next: null });
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
    await agent.get(endpoint).expect(200, { records: [{ ...saved.body, review: [{ kind: 'selection' }] }], next: null });
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

  it('validates alternatives, excludes optional products and keeps timing snapshots private and immutable', async () => {
    const { agent, ownerId } = await session();
    const other = await session();
    const { path, phaseOne, item, second } = await fixture(agent);
    const history = `${path}/timing/history`;
    const plan = [
      { id: item.id, optional: false, included: true, group: 1 },
      { id: second.id, optional: true, included: false, group: 1 },
    ];
    const funds = { liquidMinor: '7000', obligationsMinor: '500', reserveMinor: '500', monthlyMinor: '100' };
    await agent.post(`${path}/timing`).set(mutation)
      .send({ ...funds, plan: plan.map((line) => ({ ...line, included: true })) }).expect(400);
    await agent.post(`${path}/timing`).set(mutation).send({ ...funds, plan: [plan[0], plan[0]] }).expect(400);
    const key = randomUUID();
    const send = () => agent.post(history).set(mutation).set('Idempotency-Key', key).send({ ...funds, plan });
    const [saved, repeated] = await Promise.all([send().expect(201), send().expect(201)]);
    expect(saved.body).toEqual(repeated.body);
    expect(saved.body.result).toMatchObject({
      status: 'Buy Now', totalMinor: '5000', quote: { source: 'saved', subtotalMinor: '5000', missingPrices: 0 },
    });
    expect(saved.body.snapshot.products).toMatchObject([{ id: item.id, quantity: 2 }]);
    const stored = await db.assessment.findUniqueOrThrow({ where: { id: saved.body.id } });
    expect(stored.financial).toMatchObject({ liquidMinor: expect.stringMatching(/^[a-f0-9]{64}$/) });
    for (const field of Object.keys(funds)) expect(JSON.stringify(saved.body)).not.toContain(field);
    expect(JSON.stringify(stored)).not.toContain('"7000"');
    await other.agent.get(history).expect(404);
    await other.agent.delete(`${history}/${saved.body.id}`).set(mutation).send({}).expect(404);
    await agent.put(`${phaseOne}/items/${item.id}`).set(mutation).send({ ...product, priceMinor: 3000, quantity: 3 }).expect(204);
    await agent.get(history).expect(200).expect(({ body }) => {
      expect(body.records[0].review).toEqual(expect.arrayContaining([{ kind: 'price', id: item.id, before: 2500, after: 3000, name: 'Lamp' },
        { kind: 'quantity', id: item.id, before: 2, after: 3, name: 'Lamp' }]));
    });
    await agent.post(`${path}/timing`).set(mutation).send({ ...funds, reviewId: saved.body.id }).expect(400);
    const current = { ...funds, liquidMinor: '12000', reviewId: saved.body.id, confirmedCurrent: true,
      plan: plan.map((line) => ({ ...line, included: !line.included })) };
    const review = await agent.post(`${path}/timing`).set(mutation).send(current).expect(200);
    expect(review.body.review).toEqual(expect.arrayContaining([{ kind: 'selection' }, { kind: 'financial', field: 'liquidMinor' }]));
    const recalculated = await agent.post(history).set(mutation).send({ ...current, previewToken: review.body.previewToken }).expect(201);
    expect(recalculated.body.result.totalMinor).toBe('3500');
    expect(await db.assessment.count({ where: { ownerId } })).toBe(2);
    expect((await db.assessment.findUniqueOrThrow({ where: { id: saved.body.id } })).result).toEqual(saved.body.result);
    await agent.put(`${phaseOne}/items/${second.id}`).set(mutation)
      .send({ ...product, name: 'Chair', priceMinor: 4000, quantity: 1 }).expect(204);
    await agent.post(history).set(mutation).send({ ...current, previewToken: review.body.previewToken }).expect(409);
    await agent.post(history).set(mutation).set('Idempotency-Key', key).send(current).expect(409);
    await other.agent.delete(`${intelligence}/data`).set(mutation).send({}).expect(204);
    expect(await db.assessment.count({ where: { ownerId } })).toBe(2);
    await agent.delete(`${intelligence}/data`).set(mutation).send({}).expect(204);
    await agent.get(history).expect(200, { records: [], next: null });
    await agent.get(phaseOne).expect(200);
  });

  it('quotes a selected known subtotal and uses estimates only for incomplete selections', async () => {
    const { agent } = await session();
    const { path, phaseOne, item, second } = await fixture(agent);
    await agent.put(`${phaseOne}/items/${second.id}`).set(mutation)
      .send({ ...product, name: 'Unpriced', priceMinor: null, quantity: 1 }).expect(204);
    const funds = { liquidMinor: '10000', obligationsMinor: '0', reserveMinor: '0' };
    const plan = [{ id: second.id, included: false, optional: true }];
    await agent.post(`${path}/timing`).set(mutation).send({ ...funds, plan }).expect(200)
      .expect(({ body }) => expect(body.quote).toEqual({ source: 'saved', subtotalMinor: '5000', missingPrices: 0 }));
    await agent.post(`${path}/timing`).set(mutation).send({ ...funds, plan: [{ ...plan[0], included: true }] }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'Insufficient Data', totalMinor: null,
        quote: { source: 'incomplete', subtotalMinor: '5000', missingPrices: 1 } }));
    await agent.post(`${path}/timing`).set(mutation).send({ ...funds, purchaseMinor: '7500',
      plan: [{ id: item.id, included: true, optional: false }] }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ totalMinor: '7500',
        quote: { source: 'estimate', subtotalMinor: '5000', missingPrices: 1 } }));
  });

  it('marks comparisons stale after product changes and protects the user’s preview on save', async () => {
    const { agent } = await session();
    const { item, second, path, phaseOne } = await fixture(agent);
    const endpoint = `${path}/comparisons`;
    const input = {
      criteria: [{ id: randomUUID(), name: 'Unit price', kind: 'price', weight: 1 }],
      alternatives: [item, second].map(({ id }) => ({ itemId: id, ratings: {} })),
      expectedProducts: [item, second].map(({ id, priceMinor, quantity }) => ({ id, priceMinor, quantity })),
    };
    const saved = await agent.post(endpoint).set(mutation).send(input).expect(201);
    await agent.put(`${phaseOne}/items/${item.id}`).set(mutation).send({ ...product, priceMinor: 4000, quantity: 4 }).expect(204);
    await agent.post(endpoint).set(mutation).send(input).expect(409);
    await agent.get(endpoint).expect(200).expect(({ body }) => {
      expect(body.records).toHaveLength(1);
      expect(body.records[0]).toMatchObject({
        id: saved.body.id, input: saved.body.input, result: saved.body.result,
        review: [{ kind: 'price', before: 2500, after: 4000 }, { kind: 'quantity', before: 2, after: 4 }],
      });
    });
  });

  it('prunes expired intelligence records and preferences while keeping current records', async () => {
    const { agent, ownerId } = await session();
    const { path, item } = await fixture(agent);
    const endpoint = `${path}/items/${item.id}/impulse`;
    const old = await agent.post(endpoint).set(mutation).send({ need: true }).expect(201);
    await agent.post(endpoint).set(mutation).send({ need: false }).expect(201);
    const expired = new Date('2020-01-01T00:00:00Z');
    await db.assessment.update({ where: { id: old.body.id }, data: { createdAt: expired } });
    await db.intelligencePreference.create({ data: { ownerId, coolingOffDays: 3, updatedAt: expired } });
    await assessments.prune(new Date('2021-01-01T00:00:00Z'));
    expect(await db.assessment.count({ where: { ownerId } })).toBe(1);
    expect(await db.intelligencePreference.findUnique({ where: { ownerId } })).toBeNull();
  });
});
