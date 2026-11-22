import { createHash } from 'node:crypto';
import { evaluateScreening } from '../shared/screening.js';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { PrismaClient } from './generated/prisma/client.js';
import { rankAlternatives, safeHttpsUrl, type RecommendationProduct } from './recommendation-matching.js';

const uuid = z.uuid();
const answersSchema = z.strictObject({
  practicalNeed: z.boolean(), alreadyHave: z.boolean(), useOften: z.boolean(),
  canWait: z.boolean(), withoutDiscount: z.boolean(), socialPressure: z.boolean(),
});
const requestBody = z.strictObject({ itemId: uuid, wishlistId: uuid, answers: answersSchema,
  estimatedPriceMinor: z.number().int().positive().max(2_000_000_000).optional() });
const noticePage = z.strictObject({ limit: z.coerce.number().int().min(1).max(30).default(20) });

/** Conservative classification. Unknown categories produce no recommendations. */
function inferCategory(title: string): string | null {
  const text = title.toLowerCase();
  if (/\b(sneaker|sneakers|sepatu|shoes|trainer|trainers)\b/u.test(text) || /\b(?:nb\s?\d{3,4}|new balance(?:\s+\d{3,4})?)\b/u.test(text)) return 'sneakers';
  if (/\b(headphone|headphones|earbuds|earphone|earphones)\b/u.test(text)) return 'headphones';
  if (/\b(backpack|ransel)\b/u.test(text)) return 'backpack';
  return null;
}

/** Consumer-only endpoints. Never accept an ownerId from request parameters. */
export function recommendationConsumerRoutes(db: PrismaClient) {
  const router = Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      (req.get('Sec-Fetch-Site') === 'cross-site' || req.get('X-Nanti-Request') !== '1')) {
      return res.status(403).json({ error: 'Permintaan tidak dapat diverifikasi.' });
    }
    next();
  });
  const requestLimit = rateLimit({
    windowMs: 60 * 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Terlalu banyak permintaan. Coba lagi nanti, ya.' },
  });
  const readLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Terlalu banyak permintaan. Coba lagi sebentar.' } });
  async function ownedItem(ownerId: string, wishlistId: string, itemId: string) {
    const wishlist = await db.wishlist.findFirst({
      where: { id: wishlistId, ownerId }, include: { items: true },
    });
    const item = wishlist?.items.find(entry => entry.id === itemId);
    return item && wishlist ? { item, wishlist } : null;
  }
  router.post('/alternatives', readLimit, async (req, res) => {
    const parsed = requestBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Produk yang diminta tidak valid.' });
    const { itemId, wishlistId, answers, estimatedPriceMinor } = parsed.data;
    const screening = evaluateScreening(answers, null, new Date().toISOString().slice(0, 10));
    if (screening.outcome !== 'green' || screening.unanswered.length > 0) {
      return res.status(422).json({ error: 'Alternatif hanya tersedia untuk kebutuhan yang jelas.' });
    }
    const found = await ownedItem(res.locals.ownerId, wishlistId, itemId);
    if (!found) return res.status(404).json({ error: 'Produk ini belum ditemukan di daftar kamu.' });
    const { item, wishlist } = found;
    const candidates = await db.curatedRecommendation.findMany({
      where: { published: true, currency: wishlist.currency, priceVerified: true,
        priceVerifiedAt: { gte: new Date(Date.now() - 7 * 86_400_000), lte: new Date() } },
      take: 500, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
    const sourceCategory = inferCategory(item.name);
    const source: RecommendationProduct = {
      id: item.id, title: item.name, category: sourceCategory,
      priceMinor: item.priceMinor ?? estimatedPriceMinor ?? null, currency: wishlist.currency, priceVerified: false,
      published: true, url: item.url ?? '',
    };
    const alternatives = rankAlternatives(source, candidates.map(product => ({
      ...product, description: product.description ?? null,
    })));
    res.json({ alternatives, hasMore: false });
  });
  router.post('/requests', requestLimit, async (req, res) => {
    const parsed = requestBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Produk yang diminta tidak valid.' });
    const { itemId, wishlistId, answers, estimatedPriceMinor } = parsed.data;
    const screening = evaluateScreening(answers, null, new Date().toISOString().slice(0, 10));
    if (screening.outcome !== 'green' || screening.unanswered.length > 0) {
      return res.status(422).json({ error: 'Alternatif hanya tersedia untuk kebutuhan yang jelas, bukan pembelian impulsif.' });
    }
    const found = await ownedItem(res.locals.ownerId, wishlistId, itemId);
    if (!found) return res.status(404).json({ error: 'Produk ini belum ditemukan di daftar kamu.' });
    const { item, wishlist } = found;
    const normalizedUrl = item.url ? (() => {
      try {
        const u = new URL(item.url);
        if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
        return u.origin + u.pathname.replace(/\/$/u, '');
      } catch { return null; }
    })() : null;
    const identity = item.productIdentityId ? `identity:${item.productIdentityId}` :
      normalizedUrl ? `url:${normalizedUrl}` : `item:${item.id}`;
    const key = createHash('sha256').update(identity).digest('hex');
    const category = inferCategory(item.name);
    const sourcePriceMinor = item.priceMinor ?? estimatedPriceMinor ?? null;
    if (!category || !Number.isSafeInteger(sourcePriceMinor) || (sourcePriceMinor ?? 0) <= 0) {
      return res.status(422).json({ error: 'Produk perlu kategori dan harga yang jelas sebelum meminta alternatif.' });
    }
    const request = await db.recommendationRequest.upsert({
      where: { ownerId_productKey: { ownerId: res.locals.ownerId, productKey: key } },
      create: { ownerId: res.locals.ownerId, productKey: key, productName: item.name,
        sourceCategory: category, sourcePriceMinor,
        sourceCurrency: wishlist.currency },
      update: {},
      select: { id: true, status: true, createdAt: true },
    });
    res.status(200).json({ request, message: 'Siap, permintaanmu sudah kami catat.' });
  });
  router.get('/notifications', readLimit, async (req, res) => {
    const parsed = noticePage.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Parameter notifikasi tidak valid.' });
    const { limit } = parsed.data;
    const notices = await db.recommendationNotice.findMany({
      where: { request: { ownerId: res.locals.ownerId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { id: true, productId: true, readAt: true, createdAt: true, request: {
        select: { productName: true },
      } },
    });
    const products = await db.curatedRecommendation.findMany({
      where: { id: { in: notices.map(notice => notice.productId) }, published: true,
        priceVerified: true, priceVerifiedAt: { gte: new Date(Date.now() - 7 * 86_400_000), lte: new Date() } },
      select: { id: true, title: true, url: true, priceMinor: true, currency: true },
    });
    const valid = new Map(products.filter(product => safeHttpsUrl(product.url)).map(product => [product.id, product]));
    res.json({ notices: notices.filter(notice => valid.has(notice.productId)).map(notice => ({
      ...notice, product: valid.get(notice.productId),
    })) });
  });
  router.patch('/notifications/:id/read', async (req, res) => {
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) return res.status(400).json({ error: 'ID notifikasi tidak valid.' });
    const id = parsed.data;
    const result = await db.recommendationNotice.updateMany({
      where: { id, request: { ownerId: res.locals.ownerId } },
      data: { readAt: new Date() },
    });
    if (!result.count) return res.status(404).json({ error: 'Notifikasi tidak ditemukan.' });
    res.sendStatus(204);
  });
  return router;
}
