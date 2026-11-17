import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { currencies } from '../shared/wishlist.js';
import type { WishlistRepository } from './wishlist.js';
import { getOrCreateProductIdentity } from './catalog-ingestion.js';
import { authorizedOwner, lockOwner, prepareOwner } from './prisma-accounts.js';

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
    async addItem(ownerId, wishlistId, data) {
      try {
        return await db.$transaction(async (tx) => {
          const list = await tx.wishlist.findFirst({
            where: { id: wishlistId, dataOwner: authorizedOwner(ownerId) }, select: { ownerId: true },
          });
          if (!list || !await lockOwner(tx, list.ownerId, ownerId)) return false;
          const productIdentityId = data.url ? await getOrCreateProductIdentity(tx, data.url) : null;
          await tx.item.create({ data: { ownerId: list.ownerId, wishlistId, ...data, productIdentityId }, select: { id: true } });
          return true;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') return false;
        throw error;
      }
    },
    async updateItem(ownerId, wishlistId, id, data) {
      return db.$transaction(async (tx) => {
        const where = { wishlistId, id, wishlist: { dataOwner: authorizedOwner(ownerId) } };
        const updated = await tx.item.updateMany({ where, data: { ...data, productIdentityId: null } });
        if (!updated.count) return false;
        const productIdentityId = data.url ? await getOrCreateProductIdentity(tx, data.url) : null;
        if (productIdentityId) await tx.item.updateMany({ where, data: { productIdentityId } });
        return true;
      });
    },
    async removeItem(ownerId, wishlistId, id) {
      return (await db.item.deleteMany({ where: { wishlistId, id, wishlist: { dataOwner: authorizedOwner(ownerId) } } })).count > 0;
    },
  };
}
