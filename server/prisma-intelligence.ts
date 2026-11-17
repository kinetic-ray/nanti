import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import type { SavedAssessment } from '../shared/intelligence.js';
import type { IntelligenceRepository } from './intelligence.js';

const assessment = { id: true, kind: true, version: true, input: true, result: true, createdAt: true } as const;
const pageSize = 15;

function serialize(row: Prisma.AssessmentGetPayload<{ select: typeof assessment }>): SavedAssessment {
  // Only validated engine inputs and results are written through this adapter.
  return { ...row, createdAt: row.createdAt.toISOString() } as SavedAssessment;
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
    async save(scope, payload) {
      try {
        const { input, result } = payload;
        return serialize(await db.assessment.create({
          data: { ...scope, input, result, version: result.version },
          select: assessment,
        }));
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') return null;
        throw error;
      }
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
  };
}
