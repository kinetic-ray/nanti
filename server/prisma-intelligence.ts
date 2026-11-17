import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import type { SavedAssessment } from '../shared/intelligence.js';
import { SaveIntentConflict } from './intelligence.js';
import type { FinancialFingerprints, IntelligenceRepository } from './intelligence.js';

const assessment = { id: true, kind: true, version: true, input: true, result: true, snapshot: true, createdAt: true } as const;
const privateAssessment = { ...assessment, financial: true, requestHash: true } as const;
const pageSize = 15;

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
          ...scope,
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
        return serialize(await db.assessment.create({
          data: { ...scope, input, result, version: result.version, snapshot, financial,
            requestKey: intent?.key, requestHash: intent?.hash },
          select: assessment,
        }));
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') return null;
        if (intent && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const prior = await db.assessment.findFirst({
            where: { ...scope, requestKey: intent.key, requestHash: intent.hash }, select: assessment,
          });
          if (prior) return serialize(prior);
          throw new SaveIntentConflict();
        }
        throw error;
      }
    },
    async find(scope, id) {
      const row = await db.assessment.findFirst({ where: { ...scope, id }, select: privateAssessment });
      return row && { record: serialize(row), financial: row.financial as FinancialFingerprints | null, requestHash: row.requestHash };
    },
    async findRequest(ownerId, key) {
      const row = await db.assessment.findUnique({
        where: { ownerId_requestKey: { ownerId, requestKey: key } },
        select: { ...privateAssessment, ownerId: true, wishlistId: true, itemId: true },
      });
      return row && { record: serialize(row), financial: null, requestHash: row.requestHash, ownerId,
        wishlistId: row.wishlistId, itemId: row.itemId, kind: row.kind };
    },
    async remove(scope, id) {
      return (await db.assessment.deleteMany({ where: { ...scope, id } })).count > 0;
    },
    async preferences(ownerId) {
      const row = await db.intelligencePreference.findUnique({ where: { ownerId }, select: { coolingOffDays: true } });
      return row ?? { coolingOffDays: null };
    },
    async setPreferences(ownerId, { coolingOffDays }) {
      if (coolingOffDays === null) {
        await db.intelligencePreference.deleteMany({ where: { ownerId } });
      } else {
        await db.intelligencePreference.upsert({
          where: { ownerId },
          create: { ownerId, coolingOffDays },
          update: { coolingOffDays },
        });
      }
    },
    async clear(ownerId) {
      await db.$transaction([
        db.assessment.deleteMany({ where: { ownerId } }),
        db.intelligencePreference.deleteMany({ where: { ownerId } }),
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
