import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { currencies } from '../shared/wishlist.js';
import type { ItemPrices, PriceInbox, PriceObservation, UserPriceSource } from '../shared/prices.js';
import { authorizedOwner, lockOwner } from './prisma-accounts.js';

const pageSize = 20;
const itemSelect = { id: true, ownerId: true, wishlistId: true, priceMinor: true, url: true,
  wishlist: { select: { currency: true } } } as const;
const observationSelect = { id: true, priceMinor: true, currency: true, source: true, observedAt: true } as const;
type Observation = Prisma.PriceObservationGetPayload<{ select: typeof observationSelect }>;
type ItemScope = { ownerId: string; wishlistId: string; itemId: string };

function currency(code: string) {
  const match = currencies.find(entry => entry === code);
  if (!match) throw new Error('Unsupported stored currency');
  return match;
}

function observation(row: Observation): PriceObservation {
  return { ...row, id: row.id.toString(), currency: currency(row.currency), observedAt: row.observedAt.toISOString() };
}

function ownedItem(actor: string, wishlistId: string, id: string): Prisma.ItemWhereInput {
  return { id, wishlistId, wishlist: { dataOwner: authorizedOwner(actor) } };
}

export async function lockPriceItem(tx: Prisma.TransactionClient, actor: string, wishlistId: string, id: string) {
  const item = await tx.item.findFirst({ where: ownedItem(actor, wishlistId, id), select: { ownerId: true } });
  if (!item || !await lockOwner(tx, item.ownerId, actor)) return null;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM Item WHERE id = ${id} AND ownerId = ${item.ownerId} AND wishlistId = ${wishlistId} FOR UPDATE
  `;
  return rows.length ? tx.item.findUnique({ where: { id }, select: itemSelect }) : null;
}

export async function recordObservation(tx: Prisma.TransactionClient, scope: ItemScope, priceMinor: number,
  currencyCode: string, source: UserPriceSource) {
  const previous = await tx.priceObservation.findFirst({ where: scope, orderBy: { id: 'desc' }, select: { priceMinor: true } });
  if (previous?.priceMinor === priceMinor) return;

  const saved = await tx.priceObservation.create({
    data: { ...scope, priceMinor, currency: currencyCode, source }, select: { id: true, observedAt: true },
  });
  const target = await tx.priceTarget.findUnique({ where: { itemId: scope.itemId } });
  if (!target || priceMinor > target.priceMinor ||
      (target.lastReachedAt && previous && previous.priceMinor <= target.priceMinor)) return;

  await tx.priceTarget.update({ where: { itemId: scope.itemId }, data: { lastReachedAt: saved.observedAt } });
  if (target.notify) await tx.priceAlert.create({ data: { observationId: saved.id, targetMinor: target.priceMinor } });
}

export function prismaPrices(db: PrismaClient) {
  const write = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };
  const alertScope = (actor: string): Prisma.PriceAlertWhereInput => ({
    observation: { item: { wishlist: { dataOwner: authorizedOwner(actor) } } },
  });

  return {
    async details(actor: string, wishlistId: string, itemId: string, before?: bigint): Promise<ItemPrices | null> {
      return db.$transaction(async tx => {
        const item = await tx.item.findFirst({ where: ownedItem(actor, wishlistId, itemId), select: itemSelect });
        if (!item) return null;
        const scope = { ownerId: item.ownerId, wishlistId, itemId };
        const [rows, limits, verified, target] = await Promise.all([
          tx.priceObservation.findMany({
            where: { ...scope, ...(before && { id: { lt: before } }) },
            select: observationSelect, orderBy: { id: 'desc' }, take: pageSize + 1,
          }),
          tx.priceObservation.aggregate({ where: scope, _min: { priceMinor: true }, _max: { priceMinor: true } }),
          tx.priceObservation.findFirst({ where: { ...scope, source: 'marketplace_verified' },
            orderBy: { id: 'desc' }, select: { observedAt: true } }),
          tx.priceTarget.findUnique({ where: { itemId }, select: { priceMinor: true, notify: true, lastReachedAt: true } }),
        ]);
        const recent = before ? await tx.priceObservation.findMany({
          where: scope, orderBy: { id: 'desc' }, select: { priceMinor: true }, take: 2,
        }) : rows;
        const observations = rows.slice(0, pageSize).map(observation);
        return {
          currency: currency(item.wishlist.currency),
          currentMinor: item.priceMinor,
          previousMinor: recent[item.priceMinor === null ? 0 : 1]?.priceMinor ?? null,
          lowestMinor: limits._min.priceMinor,
          highestMinor: limits._max.priceMinor,
          lastVerifiedAt: verified?.observedAt.toISOString() ?? null,
          observations,
          next: rows.length > pageSize ? observations.at(-1)!.id : null,
          target: target && { ...target, lastReachedAt: target.lastReachedAt?.toISOString() ?? null },
        };
      });
    },
    record(actor: string, wishlistId: string, itemId: string, priceMinor: number, source: UserPriceSource) {
      return db.$transaction(async tx => {
        const item = await lockPriceItem(tx, actor, wishlistId, itemId);
        if (!item) return 'missing';
        if (source === 'imported_unverified' && !item.url) return 'link_required';
        if (item.priceMinor !== priceMinor) {
          await tx.item.update({ where: { id: itemId }, data: { priceMinor } });
          await recordObservation(tx, { ownerId: item.ownerId, wishlistId, itemId }, priceMinor, item.wishlist.currency, source);
          return 'recorded';
        }
        return 'unchanged';
      }, write);
    },
    setTarget(actor: string, wishlistId: string, itemId: string, data: { priceMinor: number; notify: boolean } | null) {
      return db.$transaction(async tx => {
        const item = await lockPriceItem(tx, actor, wishlistId, itemId);
        if (!item) return false;
        if (!data) {
          await tx.priceTarget.deleteMany({ where: { itemId } });
        } else {
          const target = await tx.priceTarget.findUnique({ where: { itemId }, select: { priceMinor: true } });
          await tx.priceTarget.upsert({
            where: { itemId }, create: { ownerId: item.ownerId, wishlistId, itemId, ...data },
            update: { ...data, ...(target?.priceMinor !== data.priceMinor && { lastReachedAt: null }) },
          });
        }
        return true;
      }, write);
    },
    async inbox(actor: string): Promise<PriceInbox> {
      const where = alertScope(actor);
      const [alerts, unread] = await db.$transaction([
        db.priceAlert.findMany({
          where, orderBy: { observationId: 'desc' }, take: 30,
          select: { id: true, readAt: true, targetMinor: true, observation: {
            select: { ...observationSelect, item: { select: { id: true, name: true, wishlistId: true } } },
          } },
        }),
        db.priceAlert.count({ where: { ...where, readAt: null } }),
      ]);
      return { unread, alerts: alerts.map(({ id, readAt, targetMinor, observation: { item, ...row } }) => ({
        id, targetMinor, readAt: readAt?.toISOString() ?? null, itemName: item.name, itemId: item.id, wishlistId: item.wishlistId,
        observation: observation(row),
      })) };
    },
    async markRead(actor: string) {
      await db.priceAlert.updateMany({ where: { ...alertScope(actor), readAt: null }, data: { readAt: new Date() } });
    },
  };
}

export type Prices = ReturnType<typeof prismaPrices>;
