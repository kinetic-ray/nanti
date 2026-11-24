import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import type { SavedAssessment, SavedPurchaseFinanceContext } from '../shared/intelligence.js';
import type { Currency } from '../shared/wishlist.js';
import type { PurchaseFinanceContext } from '../shared/purchase-impact.js';
import { SaveIntentConflict } from './intelligence.js';
import type { AssessmentScope, FinancialFingerprints, IntelligenceRepository } from './intelligence.js';
import { authorizedOwner, lockOwner, prepareOwner } from './prisma-accounts.js';

const assessment = { id: true, kind: true, version: true, input: true, result: true, snapshot: true, createdAt: true } as const;
const privateAssessment = { ...assessment, financial: true, requestHash: true } as const;
const pageSize = 15;

function financeMap(value: Prisma.JsonValue | null): Partial<Record<Currency, SavedPurchaseFinanceContext>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Record<Currency, SavedPurchaseFinanceContext>> : {};
}

function assessmentWhere({ actor, ...scope }: AssessmentScope): Prisma.AssessmentWhereInput {
  return { ...scope, wishlist: { dataOwner: authorizedOwner(actor ?? scope.ownerId) } };
}

function serialize(row: Prisma.AssessmentGetPayload<{ select: typeof assessment }>): SavedAssessment {
  // Only validated engine inputs and results are written through this adapter.
  const { id, kind, version, input, result, snapshot, createdAt } = row;
  return { id, kind, version, input, result, snapshot, createdAt: createdAt.toISOString() } as SavedAssessment;
}

export function prismaIntelligence(db: PrismaClient): IntelligenceRepository {
  return {
    async history(scope, before) {
      const rows = await db.assessment.findMany({
        where: {
          ...assessmentWhere(scope),
          ...(before && { OR: [
            { createdAt: { lt: before.createdAt } },
            { createdAt: before.createdAt, id: { lt: before.id } },
          ] }),
        },
        select: assessment,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
      });
      const records = rows.slice(0, pageSize).map(serialize);
      const last = records.at(-1);
      return { records, next: rows.length > pageSize && last ? `${last.createdAt}~${last.id}` : null };
    },
    async save(scope, payload, snapshot, financial, intent) {
      try {
        const { input, result } = payload;
        const { actor, ...target } = scope;
        return await db.$transaction(async (tx) => {
          if (!await lockOwner(tx, target.ownerId, actor ?? target.ownerId)) return null;
          return serialize(await tx.assessment.create({
            data: { ...target, input, result, version: result.version, snapshot, financial,
              requestKey: intent?.key, requestHash: intent?.hash },
            select: assessment,
          }));
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') return null;
        if (intent && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const prior = await db.assessment.findFirst({
            where: { ...assessmentWhere(scope), requestKey: intent.key, requestHash: intent.hash }, select: assessment,
          });
          if (prior) return serialize(prior);
          throw new SaveIntentConflict();
        }
        throw error;
      }
    },
    async find(scope, id) {
      const row = await db.assessment.findFirst({ where: { ...assessmentWhere(scope), id }, select: privateAssessment });
      return row && { record: serialize(row), financial: row.financial as FinancialFingerprints | null, requestHash: row.requestHash };
    },
    async findRequest(ownerId, key, actor = ownerId) {
      const row = await db.assessment.findFirst({
        where: { ownerId, requestKey: key, wishlist: { dataOwner: authorizedOwner(actor) } },
        select: { ...privateAssessment, ownerId: true, wishlistId: true, itemId: true },
      });
      return row && { record: serialize(row), financial: null, requestHash: row.requestHash, ownerId,
        wishlistId: row.wishlistId, itemId: row.itemId, kind: row.kind };
    },
    async remove(scope, id) {
      return (await db.assessment.deleteMany({ where: { ...assessmentWhere(scope), id } })).count > 0;
    },
    async preferences(ownerId) {
      const row = await db.intelligencePreference.findFirst({
        where: { ownerId, dataOwner: authorizedOwner(ownerId) }, select: { coolingOffDays: true },
      });
      return row ?? { coolingOffDays: null };
    },
    async financeContext(ownerId, currency) {
      const row = await db.intelligencePreference.findFirst({
        where: { ownerId, dataOwner: authorizedOwner(ownerId) }, select: { financialContexts: true },
      });
      return financeMap(row?.financialContexts ?? null)[currency] ?? null;
    },
    async setFinanceContext(ownerId, currency, context, guest = true) {
      await db.$transaction(async (tx) => {
        await prepareOwner(tx, ownerId, guest);
        const row = await tx.intelligencePreference.findFirst({
          where: { ownerId, dataOwner: authorizedOwner(ownerId) },
          select: { coolingOffDays: true, financialContexts: true },
        });
        const contexts = financeMap(row?.financialContexts ?? null);
        if (context) contexts[currency] = { context, updatedAt: new Date().toISOString() };
        else delete contexts[currency];
        if (row?.coolingOffDays == null && !Object.keys(contexts).length) {
          await tx.intelligencePreference.deleteMany({ where: { ownerId, dataOwner: authorizedOwner(ownerId) } });
          return;
        }
        const financialContexts = Object.keys(contexts).length ? contexts as Prisma.InputJsonValue : Prisma.DbNull;
        await tx.intelligencePreference.upsert({
          where: { ownerId },
          create: { ownerId, coolingOffDays: row?.coolingOffDays ?? null, financialContexts },
          update: { financialContexts },
        });
      });
    },
    async setPreferences(ownerId, { coolingOffDays }, guest = true) {
      await db.$transaction(async (tx) => {
        await prepareOwner(tx, ownerId, guest);
        if (coolingOffDays === null) {
          const row = await tx.intelligencePreference.findFirst({
            where: { ownerId, dataOwner: authorizedOwner(ownerId) }, select: { financialContexts: true },
          });
          if (Object.keys(financeMap(row?.financialContexts ?? null)).length) {
            await tx.intelligencePreference.updateMany({
              where: { ownerId, dataOwner: authorizedOwner(ownerId) }, data: { coolingOffDays: null },
            });
          } else {
            await tx.intelligencePreference.deleteMany({ where: { ownerId, dataOwner: authorizedOwner(ownerId) } });
          }
          return;
        }
        await tx.intelligencePreference.upsert({
          where: { ownerId }, create: { ownerId, coolingOffDays }, update: { coolingOffDays },
        });
      });
    },
    async clear(ownerId) {
      await db.$transaction([
        db.assessment.deleteMany({ where: { wishlist: { dataOwner: authorizedOwner(ownerId) } } }),
        db.intelligencePreference.deleteMany({ where: { dataOwner: authorizedOwner(ownerId) } }),
      ]);
    },
    async prune(before) {
      await db.$transaction([
        db.assessment.deleteMany({ where: { createdAt: { lt: before } } }),
        db.intelligencePreference.deleteMany({ where: { updatedAt: { lt: before } } }),
      ]);
    },
  };
}
