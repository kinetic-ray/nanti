import { describe, expect, it } from 'vitest';
import { evaluateImpulse, impulseRules } from '../shared/impulse.js';
import type { ImpulseAnswers } from '../shared/impulse.js';
import { getMethodology, intelligenceModules } from '../shared/methodology.js';
import { evaluateTiming, parsePlanningAmount } from '../shared/purchase-timing.js';
import type { TimingInput } from '../shared/purchase-timing.js';
import { comparisonAlternatives, evaluateComparison } from '../shared/value-ranker.js';
import type { ComparisonInput, Criterion } from '../shared/value-ranker.js';

const reflective: ImpulseAnswers = {
  temporary: false, alternative: false, promotion: false, pressure: false, research: true, waiting: true, planned: true,
};

describe('Impulse Guard', () => {
  it('scores the need question and preserves the original factor in version 1.0.0', () => {
    expect(evaluateImpulse({ need: false }, null)).toMatchObject({ version: '1.1.0', contributing: ['need'], points: 2 });
    expect(evaluateImpulse({ temporary: true }, null)).toMatchObject({ version: '1.0.0', contributing: ['temporary'], points: 2 });
    expect(getMethodology('impulse', '1.0.0')?.rules[0]).toContain('want in the moment');
  });
  it('reports low concern and no contributors when all seven answers are reflective', () => {
    expect(evaluateImpulse(reflective, null)).toMatchObject({ concern: 'Low', points: 0, contributing: [], unanswered: [] });
  });

  it('reports high concern with the main concerns first and includes the chosen waiting period', () => {
    const answers = { temporary: true, alternative: true, promotion: true, pressure: true, research: false, waiting: false, planned: false };
    expect(evaluateImpulse(answers, 7)).toMatchObject({
      concern: 'High', points: 11, coolingOffDays: 7,
      contributing: ['temporary', 'promotion', 'pressure', 'waiting', 'alternative', 'research', 'planned'],
    });
  });

  it('reports insufficient information for sparse answers and uncertainty across boundaries', () => {
    expect(evaluateImpulse({}, null)).toMatchObject({ concern: 'Insufficient information', possiblePoints: 11 });
    expect(evaluateImpulse({ ...reflective, temporary: true, promotion: undefined }, null))
      .toMatchObject({ concern: 'Insufficient information', points: 2, possiblePoints: 4, unanswered: ['promotion'] });
    expect(evaluateImpulse({ ...reflective, alternative: undefined, planned: undefined }, null))
      .toMatchObject({ concern: 'Low', possiblePoints: 2, unanswered: ['alternative', 'planned'] });
    expect(evaluateImpulse({ ...reflective, alternative: undefined, planned: undefined, research: undefined }, null))
      .toMatchObject({ concern: 'Insufficient information', possiblePoints: 3 });
  });

  it('reconciles conflicting answers at the exact thresholds and produces repeatable results', () => {
    const moderate = { ...reflective, promotion: true, pressure: true };
    const high = { ...moderate, waiting: false, temporary: true };
    expect(evaluateImpulse({ ...moderate, pressure: false, alternative: true }, null)).toMatchObject({ points: 3, concern: 'Low' });
    expect(evaluateImpulse(moderate, null)).toMatchObject({ points: impulseRules.moderateAt, concern: 'Moderate' });
    expect(evaluateImpulse({ ...high, waiting: true, research: false }, null)).toMatchObject({ points: 7, concern: 'Moderate' });
    expect(evaluateImpulse(high, 1)).toMatchObject({ points: impulseRules.highAt, concern: 'High' });
    expect(evaluateImpulse(high, 1)).toEqual(evaluateImpulse({ ...high }, 1));
    expect(evaluateImpulse(high, null).concern).toBe(evaluateImpulse(high, 90).concern);
  });
});

const criteria: Criterion[] = [
  { id: 'price', name: 'Unit price', kind: 'price', weight: 1 },
  { id: 'comfort', name: 'Comfort', kind: 'benefit', weight: 1 },
];
const alternatives = [
  { id: 'a', values: { price: 1000, comfort: 2 } },
  { id: 'b', values: { price: 3000, comfort: 8 } },
];

describe('Value Ranker', () => {
  it('uses equal weights, ties equal totals and lists contributions for each criterion', () => {
    const result = evaluateComparison(criteria, alternatives);
    expect(result.ranking).toEqual([{ id: 'a', score: 0.5, rank: 1 }, { id: 'b', score: 0.5, rank: 1 }]);
    expect(result.breakdown[0]?.criteria).toEqual([
      { id: 'price', input: 1000, normalized: 1, contribution: 0.5 },
      { id: 'comfort', input: 2, normalized: 0, contribution: 0 },
    ]);
  });

  it('normalizes unequal weights, benefits and costs and reports changed priorities', () => {
    const weighted = criteria.map((entry) => ({ ...entry, weight: entry.id === 'price' ? 3 : 1 }));
    const result = evaluateComparison(weighted, alternatives);
    expect(result.ranking).toEqual([{ id: 'a', score: 0.75, rank: 1 }, { id: 'b', score: 0.25, rank: 2 }]);
    expect(result.sensitivity).toContainEqual({
      criterionId: 'comfort', weight: 100,
      ranking: [{ id: 'b', score: 0.970873786, rank: 1 }, { id: 'a', score: 0.029126214, rank: 2 }],
    });
    const costs = [{ id: 'comfort', kind: 'cost', name: 'Maintenance', weight: 1 }] as const;
    const costResult = evaluateComparison([...costs], [...alternatives, { id: 'c', values: { price: 2000, comfort: 5 } }]);
    expect(costResult.ranking?.map(({ id, score }) => [id, score])).toEqual([['a', 1], ['c', 0.5], ['b', 0]]);
    expect(evaluateComparison(weighted, alternatives)).toEqual(result);
  });

  it('withholds ranking on unknown active values, ignores zero-weight values, and protects a zero total', () => {
    const missing = [alternatives[0]!, { id: 'b', values: { comfort: 8 } }];
    const result = evaluateComparison(criteria, missing);
    expect(result).toMatchObject({ status: 'missing-data', ranking: null, sensitivity: [] });
    expect(result.breakdown[1]?.criteria[0]).toMatchObject({ input: null, normalized: null, contribution: null });
    const noPrice = criteria.map((entry) => ({ ...entry, weight: entry.id === 'price' ? 0 : 1 }));
    expect(evaluateComparison(noPrice, missing).ranking?.[0]).toMatchObject({ id: 'b' });
    expect(evaluateComparison(criteria.map((entry) => ({ ...entry, weight: 0 })), missing))
      .toMatchObject({ status: 'no-weights', ranking: null, sensitivity: [] });
    expect(evaluateComparison(criteria, [alternatives[0]!])).toMatchObject({ status: 'not-enough-products', ranking: null });
  });

  it('gives equal values equal contributions without division by zero and puts the next option after the tie', () => {
    expect(evaluateComparison(criteria, [{ id: 'b', values: { price: 1000, comfort: 2 } }, alternatives[0]!]).ranking)
      .toEqual([{ id: 'a', rank: 1, score: 1 }, { id: 'b', rank: 1, score: 1 }]);
    const cost = criteria.filter(({ kind }) => kind === 'price');
    expect(evaluateComparison(cost, [...alternatives, { id: 'c', values: { price: 1000 } }]).ranking?.map(({ rank }) => rank))
      .toEqual([1, 1, 3]);
  });

  it('uses saved prices and explicit ratings, with no effect from evidence, seller data, or affiliate commissions', () => {
    const input: ComparisonInput = {
      criteria,
      alternatives: [
        { itemId: 'a', ratings: { comfort: { value: 2, note: 'Personal trial' } } },
        { itemId: 'b', ratings: { comfort: { value: 8, note: '' } } },
      ],
    };
    const products = [{ id: 'a', priceMinor: 1000 }, { id: 'b', priceMinor: 3000 }];
    const promoted = products.map((product) => ({ ...product, affiliateCommission: 100, sponsorship: true }));
    expect(comparisonAlternatives(input, promoted)).toEqual(alternatives);
    expect(evaluateComparison(criteria, comparisonAlternatives(input, promoted)))
      .toEqual(evaluateComparison(criteria, comparisonAlternatives(input, products)));
  });
});

const asOf = '2026-01-31';
const budget: TimingInput = { purchaseMinor: '101', liquidMinor: '201', obligationsMinor: '30', reserveMinor: '70' };

describe('Purchase Timing', () => {
  it('distinguishes an explicit zero, missing capacity, and a same-day gap', () => {
    const plan = { ...budget, extraMinor: '1', targetDate: '2026-02-28' };
    expect(evaluateTiming({ ...plan, monthlyMinor: '0' }, asOf).target).toBe('short');
    expect(evaluateTiming(plan, asOf).target).toBe('unknown');
    expect(evaluateTiming({ ...plan, targetDate: asOf }, asOf).target).toBe('short');
  });
  it('gives Buy Now when complete and exactly affordable, including an explicit zero', () => {
    expect(evaluateTiming(budget, asOf)).toMatchObject({ status: 'Buy Now', totalMinor: '101', availableMinor: '101', gapMinor: '0', months: '0' });
    expect(evaluateTiming({ purchaseMinor: '0', liquidMinor: '0', reserveMinor: '0', obligationsMinor: '0' }, asOf).status).toBe('Buy Now');
  });

  it('includes extra costs and rounds positive savings deposits up', () => {
    expect(evaluateTiming({ ...budget, extraMinor: '201', monthlyMinor: '100' }, asOf))
      .toMatchObject({ status: 'Wait', totalMinor: '302', gapMinor: '201', months: '3' });
    expect(evaluateTiming({ ...budget, extraMinor: '200', monthlyMinor: '100' }, asOf).months).toBe('2');
  });

  it('protects the reserve before covering even a free purchase', () => {
    expect(evaluateTiming({ ...budget, purchaseMinor: '0', reserveMinor: '172' }, asOf))
      .toMatchObject({ status: 'Reconsider', availableMinor: '-1', gapMinor: '1', protectionShortfallMinor: '1' });
    expect(evaluateTiming({ ...budget, reserveMinor: '172', monthlyMinor: '50' }, asOf))
      .toMatchObject({ status: 'Wait', gapMinor: '102', months: '3' });
  });

  it('requires confirmed cost, liquid funds, obligations and reserve', () => {
    for (const key of ['purchaseMinor', 'liquidMinor', 'obligationsMinor', 'reserveMinor']) {
      expect(evaluateTiming({ ...budget, [key]: undefined }, asOf))
        .toMatchObject({ status: 'Insufficient Data', gapMinor: null, months: null });
    }
  });

  it('leaves the waiting time unknown for zero or unspecified savings', () => {
    for (const savings of ['0', undefined]) {
      expect(evaluateTiming({ ...budget, extraMinor: '1', monthlyMinor: savings }, asOf))
        .toMatchObject({ status: 'Reconsider', gapMinor: '1', months: null });
    }
  });

  it('rejects negative values, fractional minor units, dates that do not exist and ambiguous currency strings', () => {
    for (const extraMinor of ['-1', '0.1', '1e5', '01', '1000000000000000000']) {
      expect(() => evaluateTiming({ ...budget, extraMinor }, asOf)).toThrow(RangeError);
    }
    expect(() => evaluateTiming({ ...budget, targetDate: '2026-02-29' }, asOf)).toThrow(RangeError);
    expect(parsePlanningAmount('1,000')).toBeNull();
    expect(parsePlanningAmount('0.001')).toBeNull();
  });

  it('handles large currency amounts and a difference of exactly one minor unit', () => {
    expect(parsePlanningAmount('9007199254740995.01')).toBe('900719925474099501');
    expect(evaluateTiming({
      purchaseMinor: '900719925474099501', liquidMinor: '900719925474099503',
      obligationsMinor: '1', reserveMinor: '1', extraMinor: '1',
    }, asOf)).toMatchObject({ status: 'Reconsider', totalMinor: '900719925474099502', availableMinor: '900719925474099501', gapMinor: '1' });
  });

  it('compares target dates at month ends, across years, and in the past', () => {
    const plan = { ...budget, extraMinor: '1', monthlyMinor: '1' };
    expect(evaluateTiming({ ...plan, targetDate: '2026-02-27' }, asOf).target).toBe('short');
    expect(evaluateTiming({ ...plan, targetDate: '2026-02-28' }, asOf).target).toBe('reachable');
    expect(evaluateTiming({ ...plan, targetDate: '2027-01-31' }, asOf).target).toBe('reachable');
    expect(evaluateTiming({ ...plan, targetDate: '2026-01-30' }, asOf).target).toBe('past');
  });
});

it('provides dated, versioned methodology and references for each module', () => {
  for (const module of intelligenceModules) {
    const content = getMethodology(module)!;
    expect(content.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(content.references.length).toBeGreaterThanOrEqual(2);
    expect(content.references.every(({ href }) => href.startsWith('https://'))).toBe(true);
    expect(getMethodology(module, content.version)).toEqual(content);
    expect(getMethodology(module, '9.9.9')).toBeNull();
  }
});
