import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '../server/generated/prisma/client.js';
import { recommendationConsumerRoutes } from '../server/recommendation-consumer-routes.js';

const wishlistId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const finances = { cashMinor: '50000000', billsMinor: '10000000', setAsideMinor: '10000000' };
const answers = { practicalNeed: true, alreadyHave: false, useOften: true,
  canWait: true, withoutDiscount: true, socialPressure: false };
const item = { id: itemId, name: 'New Balance 540 White', priceMinor: null, quantity: 1,
  productIdentityId: null, url: 'https://www.tokopedia.com/store/nb540' };

function setup(ownerId = 'owner-a') {
  const db = {
    wishlist: { findFirst: vi.fn().mockResolvedValue({
      id: wishlistId, ownerId, currency: 'IDR', items: [item],
    }) },
    curatedRecommendation: { findMany: vi.fn().mockResolvedValue([]) },
    recommendationRequest: { upsert: vi.fn().mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333', status: 'pending', createdAt: new Date(),
    }) },
  };
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.ownerId = ownerId; next(); });
  app.use('/recommendations', recommendationConsumerRoutes(db as unknown as PrismaClient));
  return { app, db };
}
const headers = { 'X-Nanti-Request': '1' };

describe('recommendation HTTP eligibility', () => {
  it('rejects requests without the CSRF header', async () => {
    const { app, db } = setup();
    const result = await request(app).post('/recommendations/requests')
      .send({ wishlistId, itemId, answers, finances, estimatedPriceMinor: 100000000 });
    expect(result.status).toBe(403);
    expect(db.recommendationRequest.upsert).not.toHaveBeenCalled();
  });
  it('blocks FOMO before database access', async () => {
    const { app, db } = setup();
    const result = await request(app).post('/recommendations/alternatives')
      .set(headers).send({ wishlistId, itemId, finances,
        answers: { ...answers, practicalNeed: false, socialPressure: true, withoutDiscount: false },
        estimatedPriceMinor: 100000000 });
    expect(result.status).toBe(422);
    expect(db.wishlist.findFirst).not.toHaveBeenCalled();
  });
  it('rejects incomplete screening', async () => {
    const { app } = setup();
    const result = await request(app).post('/recommendations/requests')
      .set(headers).send({ wishlistId, itemId, finances, answers: { practicalNeed: true } });
    expect(result.status).toBe(400);
  });
  it('accepts a manual estimate for an owned product with missing price', async () => {
    const { app, db } = setup();
    const result = await request(app).post('/recommendations/requests')
      .set(headers).send({ wishlistId, itemId, answers, finances, estimatedPriceMinor: 100000000 });
    expect(result.status).toBe(200);
    expect(db.recommendationRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ sourcePriceMinor: 100000000, sourceColor: 'white' }) }));
    const payload = db.recommendationRequest.upsert.mock.calls[0]?.[0]?.create;
    expect(payload).not.toHaveProperty('cashMinor');
    expect(payload).not.toHaveProperty('billsMinor');
    expect(payload).not.toHaveProperty('setAsideMinor');
  });
  it('does not expose a wishlist belonging to another owner', async () => {
    const { app, db } = setup();
    db.wishlist.findFirst.mockResolvedValue(null);
    const result = await request(app).post('/recommendations/alternatives')
      .set(headers).send({ wishlistId, itemId, answers, finances, estimatedPriceMinor: 100000000 });
    expect(result.status).toBe(404);
    expect(db.curatedRecommendation.findMany).not.toHaveBeenCalled();
  });
  it('does not recommend alternatives when finances are comfortably ready', async () => {
    const { app, db } = setup();
    const response = await request(app).post('/recommendations/alternatives')
      .set(headers).send({ wishlistId, itemId, answers,
        finances: { cashMinor: '1000000000', billsMinor: '0', setAsideMinor: '0' },
        estimatedPriceMinor: 100000000 });
    expect(response.status).toBe(422);
    expect(db.curatedRecommendation.findMany).not.toHaveBeenCalled();
  });
  it('rejects malformed financial amounts without touching the database', async () => {
    const { app, db } = setup();
    const response = await request(app).post('/recommendations/requests')
      .set(headers).send({ wishlistId, itemId, answers,
        finances: { ...finances, cashMinor: '-100' }, estimatedPriceMinor: 100000000 });
    expect(response.status).toBe(400);
    expect(db.recommendationRequest.upsert).not.toHaveBeenCalled();
  });
  it('rejects an out-of-range estimated price', async () => {
    const { app } = setup();
    const result = await request(app).post('/recommendations/requests')
      .set(headers).send({ wishlistId, itemId, answers, finances, estimatedPriceMinor: 2_000_000_001 });
    expect(result.status).toBe(400);
  });
});
