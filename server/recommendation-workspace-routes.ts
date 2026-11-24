import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { safeImportUrl } from '../shared/product-import.js';
import type { RecommendationImport, RecommendationWorkspaceProduct } from '../shared/recommendation-workspace.js';
import { currencies } from '../shared/wishlist.js';
import { getOrCreateProductIdentity } from './catalog-ingestion.js';
import { Prisma, type CuratedRecommendation, type PrismaClient } from './generated/prisma/client.js';
import { identifyProduct } from './product-identity.js';
import { signPublicTitle, verifyPublicTitle } from './product-title-proof.js';
import { safeHttpsUrl } from './recommendation-matching.js';

const importData = z.strictObject({
  originalUrl: z.string().max(2048),
  listingUrl: z.string().max(2048),
  title: z.string().min(1).max(160).nullable(),
  image: z.string().max(2048).nullable(),
  price: z.strictObject({ priceMinor: z.number().int().positive().max(2_000_000_000), currency: z.enum(currencies) }).nullable(),
});
const previewData = z.strictObject({ metadata: importData, proof: z.string().max(80) });
const descriptor = z.string().trim().max(80).nullable();
const curation = z.strictObject({
  title: z.string().trim().min(1).max(160), category: z.string().trim().min(1).max(80),
  color: descriptor, style: descriptor, useCase: descriptor,
  description: z.string().trim().max(1000).nullable(),
});
const paging = z.strictObject({
  q: z.string().trim().max(160).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  size: z.coerce.number().int().min(1).max(50).default(20),
});
const lifecycle = z.strictObject({ action: z.enum(['publish', 'unpublish', 'archive', 'restore']) });
const actionLabels = {
  publish: ['recommendation_published', 'Rekomendasi diterbitkan.'],
  unpublish: ['recommendation_unpublished', 'Publikasi ditarik.'],
  archive: ['recommendation_archived', 'Rekomendasi diarsipkan.'],
  restore: ['recommendation_restored', 'Rekomendasi dipulihkan sebagai draf.'],
} as const;

function evidence(owner: string, metadata: RecommendationImport) {
  return { owner: 'recommendation:' + owner, url: metadata.originalUrl, title: JSON.stringify(importData.parse(metadata)) };
}

export function recommendationListing(url: string) {
  if (!safeHttpsUrl(url) || !safeImportUrl(url)) return null;
  const listing = identifyProduct(url);
  if (!listing || listing.merchant === 'Other' || !safeHttpsUrl(listing.canonicalUrl)) return null;
  if (listing.merchant === 'Tokopedia' && new URL(listing.canonicalUrl).hostname !== 'www.tokopedia.com') return null;
  return listing;
}

export function signRecommendationPreview(secret: string, owner: string, metadata: RecommendationImport) {
  return { metadata, proof: signPublicTitle(secret, evidence(owner, metadata)) };
}

function catalogProduct(row: CuratedRecommendation): RecommendationWorkspaceProduct {
  return {
    id: row.id, title: row.title, url: row.url, category: row.category, color: row.color,
    style: row.style, useCase: row.useCase, description: row.description,
    importedTitle: row.importedTitle, image: row.importedImage,
    price: row.importedPriceAt && row.priceMinor !== null
      ? { priceMinor: row.priceMinor, currency: z.enum(currencies).parse(row.currency) } : null,
    marketplace: recommendationListing(row.listingUrl ?? row.url)?.merchant ?? null,
    status: row.archivedAt ? 'archived' : row.published ? 'active' : 'draft',
  };
}

function importedFields(metadata: RecommendationImport) {
  const checkedAt = metadata.price ? new Date() : null;
  return {
    importedTitle: metadata.title, importedImage: metadata.image,
    priceMinor: metadata.price?.priceMinor ?? null, currency: metadata.price?.currency ?? 'IDR',
    importedPriceAt: checkedAt, priceVerifiedAt: checkedAt, priceVerified: checkedAt !== null,
  };
}

/** Mount under the existing Superadmin session and mutation protections. */
export function recommendationWorkspaceRoutes(db: PrismaClient, actor: string, secret: string, preview: RequestHandler[]) {
  const router = Router();
  router.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        (req.get('Sec-Fetch-Site') === 'cross-site' || req.get('X-Nanti-Request') !== '1')) {
      return res.status(403).json({ error: 'Permintaan tidak dapat diverifikasi.' });
    }
    next();
  });
  const invalid = 'Periksa kembali detail produk dan kategori.';
  const expired = 'Ambil ulang detail dari marketplace, lalu coba lagi.';
  const conflict = 'Produk berubah. Buka kembali editor dan coba lagi.';

  async function audit(tx: Prisma.TransactionClient, product: { id: string; title: string }, action: string, reason: string) {
    await tx.workspaceAudit.create({ data: { actor, action, reason, subjectId: product.id, subject: product.title } });
  }

  router.post('/preview', ...preview);
  router.get('/', async (req, res) => {
    const { q, category, status, page, size } = paging.parse(req.query);
    const where: Prisma.CuratedRecommendationWhereInput = {
      ...(q && { OR: [{ title: { contains: q } }, { importedTitle: { contains: q } }, { category: { contains: q } }] }),
      ...(category && { category }),
      ...(status === 'archived' && { archivedAt: { not: null } }),
      ...((status === 'draft' || status === 'active') && { archivedAt: null, published: status === 'active' }),
    };
    const [rows, total, categories] = await db.$transaction([
      db.curatedRecommendation.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * size, take: size }),
      db.curatedRecommendation.count({ where }),
      db.curatedRecommendation.groupBy({ by: ['category'], orderBy: { category: 'asc' } }),
    ]);
    res.json({ products: rows.map(catalogProduct), total, categories: categories.map(row => row.category) });
  });

  router.post('/', async (req, res) => {
    const parsed = z.strictObject({ curation, preview: previewData }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: invalid });
    const { metadata, proof } = parsed.data.preview;
    const listing = recommendationListing(metadata.listingUrl);
    if (!listing || !verifyPublicTitle(secret, evidence(res.locals.adminTokenHash, metadata), proof)) {
      return res.status(409).json({ error: expired });
    }
    const result = await db.$transaction(async tx => {
      const legacy = await tx.curatedRecommendation.findMany({
        where: { productIdentityId: null }, select: { url: true, listingUrl: true },
      });
      if (legacy.some(row => identifyProduct(row.listingUrl ?? row.url)?.lookupKey === listing.lookupKey)) return null;
      const identity = await getOrCreateProductIdentity(tx, metadata.listingUrl, metadata.title ?? undefined);
      if (!identity) throw new Error('Recommendation listing identity missing');
      const inserted = await tx.curatedRecommendation.createMany({
        data: [{ ...parsed.data.curation, ...importedFields(metadata), url: metadata.originalUrl,
          listingUrl: metadata.listingUrl, productIdentityId: identity.id }],
        skipDuplicates: true,
      });
      if (!inserted.count) return null;
      const product = await tx.curatedRecommendation.findUniqueOrThrow({ where: { productIdentityId: identity.id } });
      await audit(tx, product, 'recommendation_created', 'Produk ditambahkan sebagai draf.');
      return product;
    });
    if (!result) return res.status(409).json({ error: 'Produk ini sudah ada. Cari produknya untuk mengedit.' });
    res.status(201).json(catalogProduct(result));
  });

  router.patch('/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const parsed = z.strictObject({ curation, preview: previewData.optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: invalid });
    const current = await db.curatedRecommendation.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    const imported = parsed.data.preview;
    if (imported && (
      !recommendationListing(imported.metadata.listingUrl) ||
      recommendationListing(imported.metadata.listingUrl)?.lookupKey !== recommendationListing(current.listingUrl ?? current.url)?.lookupKey ||
      !verifyPublicTitle(secret, evidence(res.locals.adminTokenHash, imported.metadata), imported.proof)
    )) return res.status(409).json({ error: expired });
    const result = await db.$transaction(async tx => {
      const metadata = imported?.metadata;
      const identity = metadata && !current.productIdentityId
        ? await getOrCreateProductIdentity(tx, metadata.listingUrl, metadata.title ?? undefined) : null;
      const { count } = await tx.curatedRecommendation.updateMany({
        where: { id, updatedAt: current.updatedAt },
        data: { ...parsed.data.curation, ...(metadata && {
          ...importedFields(metadata), listingUrl: metadata.listingUrl,
          ...(identity && { productIdentityId: identity.id }),
        }) },
      });
      if (count) await audit(tx, { id, title: parsed.data.curation.title }, 'recommendation_updated', 'Detail rekomendasi diperbarui.');
      return count;
    }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 0;
      throw error;
    });
    if (!result) return res.status(409).json({ error: conflict });
    res.sendStatus(204);
  });

  router.patch('/:id/lifecycle', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { action } = lifecycle.parse(req.body);
    const current = await db.curatedRecommendation.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    const valid = {
      publish: !current.archivedAt && !current.published && Boolean(recommendationListing(current.listingUrl ?? current.url)),
      unpublish: !current.archivedAt && current.published,
      archive: !current.archivedAt,
      restore: Boolean(current.archivedAt),
    }[action];
    if (!valid) return res.status(409).json({ error: 'Status atau tautan produk tidak mendukung tindakan ini.' });
    const result = await db.$transaction(async tx => {
      const { count } = await tx.curatedRecommendation.updateMany({
        where: { id, updatedAt: current.updatedAt, published: current.published, archivedAt: current.archivedAt },
        data: { published: action === 'publish', archivedAt: action === 'archive' ? new Date() : null, fulfillmentCursor: null },
      });
      const [event, reason] = actionLabels[action];
      if (count) await audit(tx, current, event, reason);
      return count;
    });
    if (!result) return res.status(409).json({ error: conflict });
    res.sendStatus(204);
  });
  return router;
}
