import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { currencies } from '../shared/wishlist.js';
import type { WishlistRepository } from './wishlist.js';
import { getOrCreateProductIdentity } from './catalog-ingestion.js';

const summary = { id: true, name: true, currency: true } as const;
const item = { id: true, name: true, url: true, priceMinor: true, quantity: true } as const;

function mapSummary<T extends { id: string; name: string; currency: string }>(row: T) {
  const currency = currencies.find((value) => value === row.currency);
  if (!currency) throw new Error('Unsupported stored currency');
  return { ...row, currency };
}

export function prismaWishlists(db: PrismaClient): WishlistRepository {
  return {
    async list(ownerId) {
      const rows = await db.wishlist.findMany({
        where: { ownerId }, select: summary, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map(mapSummary);
    },
    async find(ownerId, id) {
      const row = await db.wishlist.findUnique({
        where: { ownerId_id: { ownerId, id } },
        select: { ...summary, items: { select: item, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
      });
      return row ? mapSummary(row) : null;
    },
    async create(ownerId, data) {
      return mapSummary(await db.wishlist.create({ data: { ownerId, ...data }, select: summary }));
    },
    async rename(ownerId, id, name) {
      return (await db.wishlist.updateMany({ where: { ownerId, id }, data: { name } })).count > 0;
    },
    async remove(ownerId, id) {
      return (await db.wishlist.deleteMany({ where: { ownerId, id } })).count > 0;
    },
    async addItem(ownerId, wishlistId, data) {
      try {
        await db.$transaction(async (tx) => {
          const productIdentityId = data.url ? await getOrCreateProductIdentity(tx, data.url) : null;
          await tx.item.create({ data: { ownerId, wishlistId, ...data, productIdentityId }, select: { id: true } });
        });
        return true;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') return false;
        throw error;
      }
    },
    async updateItem(ownerId, wishlistId, id, data) {
      return db.$transaction(async (tx) => {
        const where = { ownerId, wishlistId, id };
        const updated = await tx.item.updateMany({ where, data: { ...data, productIdentityId: null } });
        if (!updated.count) return false;
        const productIdentityId = data.url ? await getOrCreateProductIdentity(tx, data.url) : null;
        if (productIdentityId) await tx.item.updateMany({ where, data: { productIdentityId } });
        return true;
      });
    },
    async removeItem(ownerId, wishlistId, id) {
      return (await db.item.deleteMany({ where: { ownerId, wishlistId, id } })).count > 0;
    },
  };
}
