import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '../server/generated/prisma/client.js';
import { recommendationAdminRoutes } from '../server/recommendation-admin-routes.js';

const id = '11111111-1111-4111-8111-111111111111';
const url = 'https://www.tokopedia.com/brodo/nexus';
const product = { id, title: 'Brodo Nexus', url, category: 'sneakers',
  color: 'white', style: 'retro', useCase: 'casual', description: null,
  priceMinor: 80000000, currency: 'IDR', priority: 0,
  priceVerified: false, priceVerifiedAt: null, published: false };
const input = { title: product.title, url, category: 'sneakers',
  color: 'white', style: 'retro', useCase: 'casual', description: null,
  priceMinor: 80000000, currency: 'IDR', priority: 0 };
function setup(current = product) {
  const db = {
    curatedRecommendation: {
      create: vi.fn().mockResolvedValue(current),
      findUnique: vi.fn().mockResolvedValue(current),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    recommendationRequest: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const app = express();
  app.use(express.json());
  app.use('/admin/recommendations', recommendationAdminRoutes(db as unknown as PrismaClient));
  return { app, db };
}
const headers = { 'X-Nanti-Request': '1' };

describe('recommendation admin HTTP lifecycle', () => {
  it('rejects mutations without the request verification header', async () => {
    const { app, db } = setup();
    const response = await request(app).post('/admin/recommendations/catalog').send(input);
    expect(response.status).toBe(403);
    expect(db.curatedRecommendation.create).not.toHaveBeenCalled();
  });
  it('creates only an unpublished and unverified draft', async () => {
    const { app, db } = setup();
    const response = await request(app).post('/admin/recommendations/catalog').set(headers).send(input);
    expect(response.status).toBe(201);
    expect(db.curatedRecommendation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({
        published: false, priceVerified: false, priceVerifiedAt: null,
      }) }));
  });
  it('rejects a non-allowlisted product URL', async () => {
    const { app, db } = setup();
    const response = await request(app).post('/admin/recommendations/catalog').set(headers)
      .send({ ...input, url: 'https://127.0.0.1/admin' });
    expect(response.status).toBe(400);
    expect(db.curatedRecommendation.create).not.toHaveBeenCalled();
  });
  it('rejects a verification URL different from the stored listing', async () => {
    const { app, db } = setup();
    const response = await request(app).post(`/admin/recommendations/catalog/${id}/verify-price`)
      .set(headers).send({ priceMinor: 80000000,
        checkedUrl: 'https://www.tokopedia.com/other/product', confirmedOnListing: true });
    expect(response.status).toBe(422);
    expect(db.curatedRecommendation.updateMany).not.toHaveBeenCalled();
  });
  it('blocks publishing without a recent verified price', async () => {
    const { app, db } = setup();
    const response = await request(app).patch(`/admin/recommendations/catalog/${id}/publication`)
      .set(headers).send({ published: true });
    expect(response.status).toBe(409);
    expect(db.curatedRecommendation.updateMany).not.toHaveBeenCalled();
  });
  it('publishes only with fresh price verification', async () => {
    const verified = { ...product, priceVerified: true, priceVerifiedAt: new Date() };
    const { app, db } = setup(verified);
    const response = await request(app).patch(`/admin/recommendations/catalog/${id}/publication`)
      .set(headers).send({ published: true });
    expect(response.status).toBe(200);
    expect(db.curatedRecommendation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { published: true } }));
    expect(response.body.nextCursor).toBeNull();
  });
});
