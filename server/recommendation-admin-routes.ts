import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from './generated/prisma/client.js';
import { safeAdminUrl } from './product-identity.js';
import { safeHttpsUrl } from './recommendation-matching.js';
import { rankAlternatives, type RecommendationProduct } from './recommendation-matching.js';

const uuid = z.uuid();
const productInput = z.strictObject({
  title: z.string().trim().min(2).max(160),
  url: z.string().trim().max(2048).transform((value, ctx) => {
    const url = safeAdminUrl(value);
    if (url && safeHttpsUrl(url.href)) return url.href;
    ctx.addIssue({ code: 'custom', message: 'Gunakan link HTTPS produk yang valid.' });
    return z.NEVER;
  }),
  category: z.string().trim().min(2).max(80),
  color: z.string().trim().max(80).nullable().optional(),
  style: z.string().trim().max(80).nullable().optional(),
  useCase: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  priceMinor: z.number().int().positive().max(2_000_000_000).nullable(),
  currency: z.enum(['IDR', 'USD', 'SGD', 'MYR']),
  priority: z.number().int().min(-100).max(100).default(0),
});
const publication = z.strictObject({ published: z.boolean() });
const verification = z.strictObject({
  priceMinor: z.number().int().positive().max(2_000_000_000),
  checkedUrl: z.string().trim().max(2048),
  confirmedOnListing: z.literal(true),
});

/** Mount only behind existing administrator session middleware. */
export function recommendationAdminRoutes(db: PrismaClient) {
  const router = Router();
  router.use((req, res, next) => {
    if (req.get('Sec-Fetch-Site') === 'cross-site' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return res.status(403).json({ error: 'Permintaan tidak dapat diverifikasi.' });
    }
    next();
  });
  router.get('/catalog', async (_req, res) => {
    const products = await db.curatedRecommendation.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 100,
    });
    res.json({ products });
  });
  router.post('/catalog', async (req, res) => {
    const parsed = productInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Periksa kembali data produk yang diisi.' });
    const data = parsed.data;
    const product = await db.curatedRecommendation.create({
      data: { ...data, priceVerified: false, priceVerifiedAt: null, published: false },
    });
    res.status(201).json(product);
  });
  router.patch('/catalog/:id', async (req, res) => {
    const parsedId = uuid.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ error: 'ID produk tidak valid.' });
    const id = parsedId.data;
    const parsed = productInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Periksa kembali data produk yang diisi.' });
    const data = parsed.data;
    const result = await db.curatedRecommendation.updateMany({
      where: { id }, data: { ...data, priceVerified: false, priceVerifiedAt: null, published: false },
    });
    if (!result.count) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    res.json(await db.curatedRecommendation.findUnique({ where: { id } }));
  });
  router.post('/catalog/:id/verify-price', async (req, res) => {
    const parsedId = uuid.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ error: 'ID produk tidak valid.' });
    const id = parsedId.data;
    const parsed = verification.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Periksa data verifikasi harga.' });
    const evidence = parsed.data;
    const item = await db.curatedRecommendation.findUnique({ where: { id } });
    if (!item) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    const checked = safeAdminUrl(evidence.checkedUrl);
    if (!checked || !safeHttpsUrl(checked.href) || checked.href !== item.url) {
      return res.status(422).json({ error: 'Periksa harga di link produk yang tersimpan, lalu coba lagi.' });
    }
    const changed = await db.curatedRecommendation.updateMany({
      where: { id, url: checked.href },
      data: { priceMinor: evidence.priceMinor, priceVerified: true, priceVerifiedAt: new Date(), published: false },
    });
    if (!changed.count) return res.status(409).json({ error: 'Link produk berubah. Muat ulang dan periksa lagi.' });
    res.json({ product: await db.curatedRecommendation.findUnique({ where: { id } }),
      message: 'Harga sudah dikonfirmasi. Periksa detail sebelum publikasi.' });
  });
  router.patch('/catalog/:id/publication', async (req, res) => {
    const parsedId = uuid.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ error: 'ID produk tidak valid.' });
    const id = parsedId.data;
    const parsed = publication.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Status publikasi tidak valid.' });
    const { published } = parsed.data;
    if (published) {
      const item = await db.curatedRecommendation.findUnique({ where: { id } });
      if (!item) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
      if (!item.priceVerified || !item.priceMinor || !item.priceVerifiedAt ||
        item.priceVerifiedAt.getTime() < Date.now() - 7 * 86_400_000) {
        return res.status(409).json({
          error: 'Harga belum terverifikasi. Produk tetap menjadi draf sampai ada verifikasi harga.',
        });
      }
    }
    const result = await db.curatedRecommendation.updateMany({
      where: published ? { id, priceVerified: true, priceMinor: { gt: 0 },
        priceVerifiedAt: { gte: new Date(Date.now() - 7 * 86_400_000), lte: new Date() } } : { id },
      data: { published },
    });
    if (!result.count) return res.status(409).json({ error: 'Produk tidak ditemukan atau harga perlu diverifikasi ulang.' });
    const product = await db.curatedRecommendation.findUnique({ where: { id } });
    if (published && product && product.priceVerifiedAt &&
      product.priceVerifiedAt.getTime() >= Date.now() - 7 * 86_400_000) {
      // Replay-safe: unique(requestId, productId) prevents duplicate notices.
      let cursor: string | undefined;
      let batchesProcessed = 0;
      // Bound request work to avoid monopolizing a serverless invocation.
      for (; batchesProcessed < 2; batchesProcessed++) {
        const requests = await db.recommendationRequest.findMany({
          where: { status: 'pending', sourceCategory: product.category,
            sourceCurrency: product.currency, sourcePriceMinor: { gt: product.priceMinor ?? 0 } },
          orderBy: { id: 'asc' }, take: 100,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (!requests.length) break;
        for (const request of requests) {
          const source: RecommendationProduct = {
            id: request.id, title: request.productName, category: request.sourceCategory,
            color: request.sourceColor, priceMinor: request.sourcePriceMinor,
            currency: request.sourceCurrency ?? '', priceVerified: false, published: true, url: '',
          };
          if (!rankAlternatives(source, [product]).length) continue;
          await db.$transaction(async tx => {
            const claimed = await tx.recommendationRequest.updateMany({
              where: { id: request.id, status: 'pending' },
              data: { status: 'fulfilled', fulfilledAt: new Date() },
            });
            if (!claimed.count) return;
            await tx.recommendationNotice.createMany({
              data: [{ requestId: request.id, productId: product.id }], skipDuplicates: true,
            });
          });
        }
        cursor = requests.at(-1)?.id;
        if (!cursor) break;
        if (requests.length < 100) break;
      }
    }
    res.json({ product, fulfillment: published ? 'bounded; repeat publication to resume pending matches' : 'disabled' });
  });
  router.get('/requests', async (_req, res) => {
    const requests = await db.recommendationRequest.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
      select: { id: true, productKey: true, productName: true, status: true, createdAt: true, fulfilledAt: true },
    });
    res.json({ requests });
  });
  return router;
}
