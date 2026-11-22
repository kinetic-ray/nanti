import { Router } from 'express';
import { z } from 'zod';
import { safeImportUrl } from '../shared/product-import.js';
import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';

const identifier = z.uuid();
const pageSize = 20;
const listing = z.strictObject({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  q: z.string().trim().max(100).default(''),
});
const reason = z.string().trim().min(3).max(600);
const live = { publishedDesign: { not: Prisma.DbNull } } as const;

function paging(current: number, total: number) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(current, pages);
  return { page, pages, total, skip: (page - 1) * pageSize };
}

export function adminWorkspaceRoutes(db: PrismaClient, actor: string) {
  const router = Router();

  router.get('/overview', async (_req, res) => {
    const [users, creators, products, liveStorefronts] = await db.$transaction([
      db.user.count(), db.creatorProfile.count(), db.creatorProduct.count(), db.creatorProfile.count({ where: live }),
    ]);
    res.json({ users, creators, products, liveStorefronts });
  });

  router.get('/products', async (req, res) => {
    const { page: requested, q } = listing.parse(req.query);
    const where = q ? { OR: [{ title: { contains: q } }, { profile: { name: { contains: q } } }] } : {};
    res.json(await db.$transaction(async tx => {
      const { skip, ...pagination } = paging(requested, await tx.creatorProduct.count({ where }));
      const rows = await tx.creatorProduct.findMany({
        where, skip, take: pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: { id: true, title: true, url: true, published: true, priceMinor: true, currency: true, hasPhoto: true,
          profile: { select: { name: true } } },
      });
      return { ...pagination, records: rows.map(({ hasPhoto, profile, ...product }) => ({
        ...product, creator: profile.name, image: hasPhoto ? '/api/admin/workspace/products/' + product.id + '/photo' : null,
      })) };
    }));
  });

  router.get('/products/:id/photo', async (req, res) => {
    const row = await db.creatorProduct.findUnique({ where: { id: identifier.parse(req.params.id) }, select: { photo: true } });
    if (!row?.photo) return res.sendStatus(404);
    res.type('image/jpeg').send(Buffer.from(row.photo));
  });

  router.patch('/products/:id/link', async (req, res) => {
    const id = identifier.parse(req.params.id);
    const input = z.strictObject({ url: z.string().trim().max(2048), expectedUrl: z.string().max(2048), reason }).parse(req.body);
    const url = safeImportUrl(input.url);
    if (url?.protocol !== 'https:' || url.port) return res.status(400).json({ error: 'Masukkan tautan produk HTTPS yang valid.' });
    const outcome = await db.$transaction(async tx => {
      const [current] = await tx.$queryRaw<{ url: string; title: string }[]>`
        SELECT url, title FROM CreatorProduct WHERE id = ${id} FOR UPDATE
      `;
      if (!current) return 'missing';
      if (current.url !== input.expectedUrl) return 'conflict';
      if (current.url === input.url) return 'saved';
      await tx.creatorProduct.update({ where: { id }, data: { url: input.url } });
      await tx.workspaceAudit.create({ data: { actor, action: 'product_link_updated', subjectId: id, subject: current.title, reason: input.reason } });
      return 'saved';
    });
    if (outcome === 'missing') return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    if (outcome === 'conflict') return res.status(409).json({ error: 'Tautan sudah berubah. Muat ulang daftar produk.' });
    res.sendStatus(204);
  });

  router.post('/products/:id/unpublish', async (req, res) => {
    const id = identifier.parse(req.params.id);
    const input = z.strictObject({ reason }).parse(req.body);
    const found = await db.$transaction(async tx => {
      const current = await tx.creatorProduct.findUnique({ where: { id }, select: { title: true } });
      if (!current) return false;
      const updated = await tx.creatorProduct.updateMany({ where: { id, published: true }, data: { published: false } });
      if (updated.count) await tx.workspaceAudit.create({
        data: { actor, action: 'product_unpublished', subjectId: id, subject: current.title, reason: input.reason },
      });
      return true;
    });
    if (!found) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    res.sendStatus(204);
  });

  router.get('/users', async (req, res) => {
    const { page: requested, q } = listing.parse(req.query);
    const where = q ? { OR: [{ displayName: { contains: q } }, { id: q }] } : {};
    res.json(await db.$transaction(async tx => {
      const { skip, ...pagination } = paging(requested, await tx.user.count({ where }));
      const rows = await tx.user.findMany({ where, skip, take: pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: { id: true, displayName: true, role: true, createdAt: true, creatorProfile: { select: { name: true } } },
      });
      return { ...pagination, records: rows.map(({ creatorProfile, ...user }) => ({ ...user, creator: creatorProfile?.name ?? null })) };
    }));
  });

  router.get('/creators', async (req, res) => {
    const { page: requested, q } = listing.parse(req.query);
    const where = q ? { name: { contains: q } } : {};
    res.json(await db.$transaction(async tx => {
      const { skip, ...pagination } = paging(requested, await tx.creatorProfile.count({ where }));
      const rows = await tx.creatorProfile.findMany({ where, skip, take: pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: { id: true, name: true, createdAt: true, user: { select: { displayName: true } }, _count: { select: { products: true } } },
      });
      return { ...pagination, records: rows.map(({ user, _count, ...creator }) => ({
        ...creator, user: user.displayName, products: _count.products,
      })) };
    }));
  });

  router.get('/storefronts', async (req, res) => {
    const { page: requested, q } = listing.parse(req.query);
    const where = q ? { name: { contains: q } } : {};
    res.json(await db.$transaction(async tx => {
      const { skip, ...pagination } = paging(requested, await tx.creatorProfile.count({ where }));
      const rows = await tx.creatorProfile.findMany({ where, skip, take: pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: { id: true, name: true, handle: true, publishedDesign: true,
          _count: { select: { products: { where: { published: true } } } } },
      });
      return { ...pagination, records: rows.map(({ publishedDesign, _count, ...storefront }) => ({
        ...storefront, published: publishedDesign !== null, products: _count.products,
      })) };
    }));
  });

  router.post('/storefronts/:id/unpublish', async (req, res) => {
    const id = identifier.parse(req.params.id);
    const input = z.strictObject({ reason }).parse(req.body);
    const found = await db.$transaction(async tx => {
      const current = await tx.creatorProfile.findUnique({ where: { id }, select: { name: true } });
      if (!current) return false;
      const updated = await tx.creatorProfile.updateMany({ where: { id, ...live }, data: { publishedDesign: Prisma.DbNull } });
      if (updated.count) await tx.workspaceAudit.create({
        data: { actor, action: 'storefront_unpublished', subjectId: id, subject: current.name, reason: input.reason },
      });
      return true;
    });
    if (!found) return res.status(404).json({ error: 'Etalase tidak ditemukan.' });
    res.sendStatus(204);
  });

  router.get('/audit', async (_req, res) => {
    const orderBy = [{ createdAt: 'desc' }, { id: 'desc' }] as const;
    const [workspace, affiliate] = await db.$transaction([
      db.workspaceAudit.findMany({ take: 30, orderBy: [...orderBy],
        select: { id: true, actor: true, action: true, subject: true, reason: true, createdAt: true } }),
      db.affiliateAudit.findMany({ take: 30, orderBy: [...orderBy],
        select: { id: true, actor: true, action: true, identity: { select: { title: true } }, createdAt: true } }),
    ]);
    res.json({ workspace, affiliate: affiliate.map(({ identity, ...event }) => ({ ...event, title: identity.title })) });
  });

  return router;
}
