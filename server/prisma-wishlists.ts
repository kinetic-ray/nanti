import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { currencies } from '../shared/wishlist.js';
import type { WishlistRepository } from './wishlist.js';
import { getOrCreateProductIdentity, notifyNewProduct } from './catalog-ingestion.js';
import { authorizedOwner, lockOwner, prepareOwner } from './prisma-accounts.js';
import { lockPriceItem, recordObservation } from './prisma-prices.js';
import { attachProductImage, mysqlImageId, writeProductImage } from './mysql-image-storage.js';

const summary = { id: true, name: true, currency: true } as const;
const item = { id: true, name: true, url: true, priceMinor: true, quantity: true, imageKey: true, sellerName: true } as const;

function mapSummary<T extends { id: string; name: string; currency: string }>(row: T) {
  const currency = currencies.find((value) => value === row.currency);
  if (!currency) throw new Error('Unsupported stored currency');
  return { ...row, currency };
}

export function prismaWishlists(db: PrismaClient): WishlistRepository {
  return {
    async list(ownerId) {
      const rows = await db.wishlist.findMany({
        where: { dataOwner: authorizedOwner(ownerId) }, select: summary, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map(mapSummary);
    },
    async find(ownerId, id) {
      const row = await db.wishlist.findFirst({
        where: { id, dataOwner: authorizedOwner(ownerId) },
        select: { ...summary, ownerId: true, items: { select: item, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
      });
      if (!row) return null;
      const { ownerId: scopeId, ...rest } = row;
      return { ...mapSummary(rest), ...(scopeId === ownerId ? {} : { scopeId }) };
    },
    async create(ownerId, data, guest = true) {
      return db.$transaction(async (tx) => {
        await prepareOwner(tx, ownerId, guest);
        return mapSummary(await tx.wishlist.create({ data: { ownerId, ...data }, select: summary }));
      });
    },
    async rename(ownerId, id, name) {
      return (await db.wishlist.updateMany({ where: { id, dataOwner: authorizedOwner(ownerId) }, data: { name } })).count > 0;
    },
    async remove(ownerId, id) {
      return (await db.wishlist.deleteMany({ where: { id, dataOwner: authorizedOwner(ownerId) } })).count > 0;
    },
    async addItem(ownerId, wishlistId, { priceSource, ...data }, requestId, photo, publicMetadata) {
      const started = performance.now();
      let stage = 'begin';
      try {
        const result = await db.$transaction(async (tx) => {
          stage = 'ownership';
          const list = await tx.wishlist.findFirst({
            where: { id: wishlistId, dataOwner: authorizedOwner(ownerId) },
            select: { ownerId: true, currency: true, dataOwner: { select: { userId: true } } },
          });
          if (!list || !await lockOwner(tx, list.ownerId, ownerId)) return false;
          stage = 'idempotency';
          if (requestId && await tx.item.findUnique({ where: { id: requestId }, select: { id: true } })) return false;
          stage = 'catalog';
          const identity = data.url ? await getOrCreateProductIdentity(tx, publicMetadata?.listingUrl ?? data.url, publicMetadata?.title) : null;
          stage = 'item';
          const created = await tx.item.create({
            data: { ...(requestId && { id: requestId }), ownerId: list.ownerId, wishlistId, ...data, productIdentityId: identity?.id ?? null }, select: { id: true },
          });
          if (data.imageKey && mysqlImageId(data.imageKey)) {
            stage = 'image';
            if (photo) await writeProductImage(tx, data.imageKey, list.ownerId, photo, created.id,
              publicMetadata?.marketplacePhoto ? identity?.id : undefined);
            else await attachProductImage(tx, data.imageKey, ownerId, created.id);
          }
          if (data.priceMinor !== null) {
            stage = 'price';
            // A new item has no observations or target to look up.
            await tx.priceObservation.createMany({ data: [{ ownerId: list.ownerId, wishlistId, itemId: created.id,
              priceMinor: data.priceMinor, currency: list.currency, source: priceSource ?? 'manual',
              marketplaceIdentityId: publicMetadata?.priceCurrency === list.currency ? identity?.id : undefined }] });
          }
          stage = 'notification';
          const registered = Boolean(list.dataOwner.userId);
          if (registered) await notifyNewProduct(tx, identity, created.id);
          stage = 'commit';
          return { identity, registered };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 8_000, timeout: 15_000 });
        if (!result) return false;
        if (!result.registered) await notifyNewProduct(db, result.identity).catch(() => console.error('Product review notification write failed'));
        return true;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2003') return false;
          if (error.code === 'P2028') console.error('Product save transaction failed', {
            stage, elapsedMs: Math.round(performance.now() - started),
            reason: /expired transaction/iu.test(error.message) ? 'expired' :
              /unable to start/iu.test(error.message) ? 'start_timeout' : 'unknown',
          });
        }
        throw error;
      }
    },
    async updateItem(ownerId, wishlistId, id, { priceSource, ...data }) {
      const result = await db.$transaction(async (tx) => {
        const current = await lockPriceItem(tx, ownerId, wishlistId, id);
        if (!current) return false;
        const urlChanged = data.url !== current.url;
        const identity = urlChanged && data.url ? await getOrCreateProductIdentity(tx, data.url) : null;
        if (data.imageKey !== undefined) {
          const existing = await tx.productImage.findUnique({ where: { itemId: id }, select: { id: true } });
          const next = data.imageKey && mysqlImageId(data.imageKey);
          if (existing && existing.id !== next) await tx.productImage.delete({ where: { id: existing.id }, select: { id: true } });
          if (next && existing?.id !== next) await attachProductImage(tx, data.imageKey!, ownerId, id);
        }
        await tx.item.update({ where: { id }, data: { ...data, ...(urlChanged && { productIdentityId: identity?.id ?? null }) } });
        if (data.priceMinor !== null && data.priceMinor !== current.priceMinor) {
          await recordObservation(tx, { ownerId: current.ownerId, wishlistId, itemId: id },
            data.priceMinor, current.wishlist.currency, priceSource ?? 'manual');
        }
        return { identity };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      if (!result) return false;
      await notifyNewProduct(db, result.identity).catch(() => console.error('Product notification write failed'));
      return true;
    },
    async removeItem(ownerId, wishlistId, id) {
      return (await db.item.deleteMany({ where: { wishlistId, id, wishlist: { dataOwner: authorizedOwner(ownerId) } } })).count > 0;
    },
  };
}
