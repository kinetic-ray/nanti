import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from './generated/prisma/client.js';
import { safeAdminUrl } from './product-identity.js';

const uuid = z.uuid();
const productInput = z.strictObject({
  title: z.string().trim().min(2).max(160),
  url: z.string().trim().max(2048).transform((value, ctx) => {
    const url = safeAdminUrl(value);
    if (url) return url.href;
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

/** Mount only behind existing administrator session middleware. */
export function recommendationAdminRoutes(db: PrismaClient) {
  const router = Router();
  router.get('/catalog', async (_req, res) => {
    const products = await db.curatedRecommendation.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 100,
    });
    res.json({ products });
  });
  router.post('/catalog', async (req, res) => {
    const data = productInput.parse(req.body);
    const product = await db.curatedRecommendation.create({
      data: { ...data, priceVerified: false, published: false },
    });
    res.status(201).json(product);
  });
  router.patch('/catalog/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const data = productInput.parse(req.body);
    const result = await db.curatedRecommendation.updateMany({
      where: { id }, data: { ...data, priceVerified: false, published: false },
    });
    if (!result.count) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    res.json(await db.curatedRecommendation.findUnique({ where: { id } }));
  });
  router.patch('/catalog/:id/publication', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { published } = publication.parse(req.body);
    if (published) {
      const item = await db.curatedRecommendation.findUnique({ where: { id } });
      if (!item) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
      if (!item.priceVerified || !item.priceMinor) {
        return res.status(409).json({
          error: 'Harga belum terverifikasi. Produk tetap menjadi draf sampai ada verifikasi harga.',
        });
      }
    }
    const result = await db.curatedRecommendation.updateMany({ where: { id }, data: { published } });
    if (!result.count) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    res.json(await db.curatedRecommendation.findUnique({ where: { id } }));
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
