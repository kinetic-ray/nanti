import { z } from 'zod';
import { impulseRules, waitingPeriods } from '../shared/impulse.js';
import { screeningVersion } from '../shared/screening.js';
import { priorityFactors, priorityLimit } from '../shared/priorities.js';
import { readinessAnswers } from '../shared/quick-timing.js';
import { intelligenceModules } from '../shared/methodology.js';
import { isCalendarDate, minorPattern } from '../shared/purchase-timing.js';
import { comparisonLimits, criterionPresets } from '../shared/value-ranker.js';

export const id = z.uuid();
export const methodologyModule = z.enum(intelligenceModules);
export const algorithmVersion = z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/);
export const historyQuery = z.strictObject({
  before: z.string().max(61).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z~[\da-f-]{36}$/)
    .transform((value) => ({ createdAt: new Date(value.slice(0, 24)), id: value.slice(25) }))
    .refine((cursor) => Number.isFinite(cursor.createdAt.valueOf()) && id.safeParse(cursor.id).success,
      'Enter a valid history cursor.').optional(),
});

export const impulseBody = z.strictObject({
  temporary: z.boolean().optional(),
  need: z.boolean().optional(),
  alternative: z.boolean().optional(),
  promotion: z.boolean().optional(),
  pressure: z.boolean().optional(),
  research: z.boolean().optional(),
  waiting: z.boolean().optional(),
  planned: z.boolean().optional(),
}).refine((value) => value.temporary === undefined || value.need === undefined,
  'Answer the current need question or use the original question.');

export const preferenceBody = z.strictObject({
  coolingOffDays: z.number().int().min(1).max(impulseRules.maximumCoolingOffDays).nullable(),
});

export const buyingReasonsBody = z.strictObject({
  answers: z.strictObject({
    withoutDiscount: z.boolean().optional(), alreadyHave: z.boolean().optional(),
    useOften: z.boolean().optional(), canWait: z.boolean().optional(),
  }),
  period: z.enum(waitingPeriods).nullable(),
});

export const screeningBody = buyingReasonsBody.extend({
  version: z.literal(screeningVersion),
  answers: buyingReasonsBody.shape.answers.extend({
    practicalNeed: z.boolean().optional(),
    socialPressure: z.boolean().optional(),
  }),
});

export const quickTimingBody = z.strictObject({
  mode: z.literal('quick'),
  answer: z.enum(readinessAnswers),
  expectedSelection: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const prioritiesBody = z.strictObject({
  mode: z.literal('priorities'),
  emphasis: z.enum(priorityFactors).nullable(),
  alternatives: z.array(z.strictObject({
    wishlistId: id, itemId: id, ratings: z.record(z.enum(priorityFactors), z.number().int().min(0).max(2)),
  })).min(1).max(priorityLimit),
  expectedProducts: z.array(z.strictObject({
    id, priceMinor: z.number().int().min(0).max(999_999_999).nullable(),
    quantity: z.number().int().min(1).max(999),
  })).min(1).max(priorityLimit),
}).refine(({ alternatives }) => new Set(alternatives.map(({ itemId }) => itemId)).size === alternatives.length,
  'Choose each product only once.');

const criterion = z.strictObject({
  id,
  name: z.string().trim().min(1, 'Give each criterion a name.').max(comparisonLimits.name),
  kind: z.enum(['price', 'benefit', 'cost']),
  weight: z.number().int().min(0).max(comparisonLimits.weight),
  preset: z.enum(criterionPresets).optional(),
});
const rating = z.strictObject({
  value: z.number().min(0).max(comparisonLimits.rating).nullable(),
  note: z.string().trim().max(comparisonLimits.note),
});
export const comparisonBody = z.strictObject({
  criteria: z.array(criterion).min(1).max(comparisonLimits.criteria),
  alternatives: z.array(z.strictObject({
    itemId: id,
    ratings: z.record(id, rating),
  })).min(2, 'Choose at least two products.').max(comparisonLimits.alternatives),
  expectedProducts: z.array(z.strictObject({
    id, priceMinor: z.number().int().min(0).max(999_999_999).nullable(),
    quantity: z.number().int().min(1).max(999),
  })).max(comparisonLimits.alternatives).optional(),
}).superRefine(({ criteria, alternatives }, ctx) => {
  const criteriaIds = new Set(criteria.map((entry) => entry.id));
  const ratingIds = new Set(criteria.filter(({ kind }) => kind !== 'price').map((entry) => entry.id));
  if (criteriaIds.size !== criteria.length || criteria.length - ratingIds.size > 1) {
    ctx.addIssue({ code: 'custom', message: 'Use distinct criteria and at most one saved-price criterion.' });
  }
  if (new Set(alternatives.map(({ itemId }) => itemId)).size !== alternatives.length) {
    ctx.addIssue({ code: 'custom', message: 'Choose each product only once.' });
  }
  if (alternatives.some(({ ratings }) => Object.keys(ratings).some((key) => !ratingIds.has(key)))) {
    ctx.addIssue({ code: 'custom', message: 'Ratings must match the selected manual criteria.' });
  }
});

const minorAmount = z.string().regex(minorPattern, 'Enter a valid nonnegative amount.');
export const timingBody = z.strictObject({
  purchaseMinor: minorAmount.optional(),
  liquidMinor: minorAmount.optional(),
  obligationsMinor: minorAmount.optional(),
  reserveMinor: minorAmount.optional(),
  extraMinor: minorAmount.optional(),
  monthlyMinor: minorAmount.optional(),
  targetDate: z.string().refine(isCalendarDate, 'Enter a valid target date.').optional(),
  reviewId: id.optional(),
  confirmedCurrent: z.boolean().optional(),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  plan: z.array(z.strictObject({
    id, included: z.boolean(), optional: z.boolean(), group: z.number().int().min(1).max(100).optional(),
  })).max(100).optional(),
});
