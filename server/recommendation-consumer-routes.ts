import { createHash } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { rankAlternatives, type RecommendationProduct } from './recommendation-matching.js';

const uuid = z.uuid();
const productKey = z.string().regex(/^[a-f0-9]{64}$/);
const query = z.strictObject({ itemId: uuid, wishlistId: uuid });
const requestBody = z.strictObject({ itemId: uuid, wishlistId: uuid });
const noticePage = z.strictObject({ limit: z.coerce.number().int().min(1).max(30).default(20) });

/** Consumer-only endpoints. Never accept an ownerId from request parameters. */
export function recommendationConsumerRoutes(db: PrismaClient) {
  const router = Router();
  const requestLimit = rateLimit({
    windowMs: 60 * 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Terlalu banyak permintaan. Coba lagi nanti, ya.' },
  });
  async function ownedItem(ownerId: string, wishlistId: string, itemId: string) {
    const wishlist = await db.wishlist.findFirst({
      where: { id: wishlistId, ownerId }, include: { items: true },
    });
    const item = wishlist?.items.find(entry => entry.id === itemId);
    return item && wishlist ? { item, wishlist } : null;
  }
  router.get('/alternatives', async (req, res) => {
    const { itemId, wishlistId } = query.parse(req.query);
    const found = await ownedItem(res.locals.ownerId, wishlistId, itemId);
    if (!found) return res.status(404).json({ error: 'Produk ini belum ditemukan di daftar kamu.' });
    const { item, wishlist } = found;
    const candidates = await db.curatedRecommendation.findMany({
      where: { published: true, currency: wishlist.currency, priceVerified: true },
      take: 500, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
    const source: RecommendationProduct = {
      id: item.id, title: item.name, category: item.category ?? null,
      priceMinor: item.priceMinor, currency: wishlist.currency, priceVerified: false,
      published: true, url: item.url ?? '',
    };
    const alternatives = rankAlternatives(source, candidates.map(product => ({
      ...product, description: product.description ?? null,
    })));
    res.json({ alternatives, hasMore: false });
  });
  router.post('/requests', requestLimit, async (req, res) => {
    const { itemId, wishlistId } = requestBody.parse(req.body);
    const found = await ownedItem(res.locals.ownerId, wishlistId, itemId);
    if (!found) return res.status(404).json({ error: 'Produk ini belum ditemukan di daftar kamu.' });
    const { item } = found;
    const key = createHash('sha256').update(item.id).digest('hex');
    const request = await db.recommendationRequest.upsert({
      where: { ownerId_productKey: { ownerId: res.locals.ownerId, productKey: key } },
      create: { ownerId: res.locals.ownerId, productKey: key, productName: item.name },
      update: {},
      select: { id: true, status: true, createdAt: true },
    });
    res.status(200).json({ request, message: 'Siap, permintaanmu sudah kami catat.' });
  });
  router.get('/notifications', async (req, res) => {
    const { limit } = noticePage.parse(req.query);
    const notices = await db.recommendationNotice.findMany({
      where: { request: { ownerId: res.locals.ownerId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { id: true, productId: true, readAt: true, createdAt: true, request: {
        select: { productName: true },
      } },
    });
    res.json({ notices });
  });
  router.patch('/notifications/:id/read', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const result = await db.recommendationNotice.updateMany({
      where: { id, request: { ownerId: res.locals.ownerId } },
      data: { readAt: new Date() },
    });
    if (!result.count) return res.status(404).json({ error: 'Notifikasi tidak ditemukan.' });
    res.sendStatus(204);
  });
  return router;
}
