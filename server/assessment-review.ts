import { createHmac } from 'node:crypto';
import { impulseVersion } from '../shared/impulse.js';
import type { AssessmentSnapshot, ReviewChange, SavedAssessment, TimingPlanInput } from '../shared/intelligence.js';
import { includedProducts } from '../shared/purchase-plan.js';
import type { PurchasePlan } from '../shared/purchase-plan.js';
import { timingVersion } from '../shared/purchase-timing.js';
import { comparisonVersion } from '../shared/value-ranker.js';
import type { Item } from '../shared/wishlist.js';
import type { FinancialFingerprints, SaveIntent, StoredAssessment } from './intelligence.js';

const versions = { impulse: impulseVersion, comparison: comparisonVersion, timing: timingVersion };
const moneyFields = ['liquidMinor', 'obligationsMinor', 'reserveMinor', 'monthlyMinor'] as const;
const planningFields = ['purchaseMinor', 'extraMinor', 'targetDate'] as const;

function digest(secret: string, domain: string, value: unknown) {
  return createHmac('sha256', secret).update(JSON.stringify([domain, value])).digest('hex');
}

export function saveIntent(secret: string, key: string, body: unknown): SaveIntent {
  return { key, hash: digest(secret, 'assessment-request', [key, body]) };
}

export function fingerprintFinances(secret: string, ownerId: string, input: TimingPlanInput): FinancialFingerprints {
  return Object.fromEntries(moneyFields.map((field) =>
    [field, digest(secret, 'assessment-financial-field', [ownerId, field, input[field] ?? null])]));
}

export function productSnapshot(items: Item[]): AssessmentSnapshot {
  return { version: 1, products: items.map(({ id, name, priceMinor, quantity }) => ({ id, name, priceMinor, quantity })) };
}

export function validatePlan(items: Item[], plan: PurchasePlan) {
  const ids = new Set(items.map(({ id }) => id));
  const seen = new Set<string>();
  const groups = new Map<number, { count: number; selected: number }>();
  for (const line of plan) {
    if (!ids.has(line.id) || seen.has(line.id)) return 'invalid_plan_items';
    seen.add(line.id);
    if (line.group !== undefined) {
      const group = groups.get(line.group) ?? { count: 0, selected: 0 };
      group.count++;
      if (line.included) group.selected++;
      groups.set(line.group, group);
    }
  }
  if ([...groups.values()].some(({ count, selected }) => count < 2 || selected > 1)) return 'invalid_plan_group';
  if (!includedProducts(items, plan).length && items.length) return 'empty_plan';
  return null;
}

function plannedIds(plan: PurchasePlan) {
  const groups = new Map<number, string[]>();
  for (const line of plan) {
    if (line.group === undefined) continue;
    const group = groups.get(line.group) ?? [];
    group.push(line.id);
    groups.set(line.group, group);
  }
  return JSON.stringify([
    plan.filter(({ optional }) => optional).map(({ id }) => id).sort(),
    [...groups.values()].map((members) => members.sort().join(',')).sort(),
  ]);
}

export function assessmentChanges(record: SavedAssessment, items: Item[], coolingOffDays?: number | null,
  proposedPlan?: PurchasePlan): ReviewChange[] {
  const changes: ReviewChange[] = [];
  if (record.version !== versions[record.kind]) changes.push({ kind: 'methodology' });
  if (record.kind === 'impulse' && coolingOffDays !== undefined && coolingOffDays !== record.result.coolingOffDays) {
    changes.push({ kind: 'preference' });
  }
  if (!record.snapshot) return [...changes, { kind: 'legacy' }];
  const historical = record.snapshot.products;
  const chosen = record.kind === 'timing' ? includedProducts(items, proposedPlan ?? record.input.plan ?? []) :
    items.filter(({ id }) => historical.some((entry) => entry.id === id));
  const current = new Map(chosen.map((entry) => [entry.id, entry]));
  if (current.size !== historical.length || historical.some(({ id }) => !current.has(id)) ||
    (record.kind === 'timing' && proposedPlan !== undefined && plannedIds(proposedPlan) !== plannedIds(record.input.plan ?? []))) {
    changes.push({ kind: 'selection' });
  }
  const comparePrice = record.kind !== 'comparison' || record.input.criteria.some(({ kind }) => kind === 'price');
  for (const previous of historical) {
    const present = current.get(previous.id);
    if (!present) continue;
    if (comparePrice && present.priceMinor !== previous.priceMinor) {
      changes.push({ kind: 'price', id: previous.id, name: present.name, before: previous.priceMinor, after: present.priceMinor });
    }
    if (present.quantity !== previous.quantity) {
      changes.push({ kind: 'quantity', id: previous.id, name: present.name, before: previous.quantity, after: present.quantity });
    }
  }
  return changes;
}

export function timingChanges(stored: StoredAssessment, items: Item[], input: TimingPlanInput,
  financial: FinancialFingerprints): ReviewChange[] {
  const { record } = stored;
  if (record.kind !== 'timing') return [];
  const changes = assessmentChanges(record, items, undefined, input.plan ?? []);
  for (const field of moneyFields) {
    if (input[field] !== undefined && stored.financial && financial[field] !== stored.financial[field]) {
      changes.push({ kind: 'financial', field });
    }
  }
  for (const field of planningFields) {
    const fallback = field === 'extraMinor' ? '0' : null;
    const before = record.input[field] ?? fallback;
    const after = input[field] ?? fallback;
    if (before !== after) changes.push({ kind: 'planning', field, before, after });
  }
  return changes;
}
