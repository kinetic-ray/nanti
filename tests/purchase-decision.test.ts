import { describe, expect, it } from 'vitest';
import { assessPurchase, parseBudgetAmount } from '../shared/purchase-decision.js';
import type { ScreeningAnswers } from '../shared/screening.js';

const needed: ScreeningAnswers = {
  practicalNeed: true, alreadyHave: false, useOften: true,
  canWait: false, withoutDiscount: true, socialPressure: false,
};
const fomo: ScreeningAnswers = {
  practicalNeed: false, alreadyHave: true, useOften: false,
  canWait: true, withoutDiscount: false, socialPressure: true,
};
function finance(price: number, cash: number, bills = 0, aside = 0) {
  return { priceMinor: BigInt(price), cashMinor: BigInt(cash), billsMinor: BigInt(bills), setAsideMinor: BigInt(aside) };
}
describe('guided purchase decision', () => {
  it('pauses an impulsive purchase even when money is sufficient', () => {
    const result = assessPurchase(fomo, finance(25000, 500000, 100000, 100000));
    expect(result.decision).toBe('pause');
    expect(result.gap).toBe(0n);
  });
  it('defers a needed purchase when protected funds fall short', () => {
    const result = assessPurchase(needed, finance(85000, 120000, 45000, 40000));
    expect(result.decision).toBe('save');
    expect(result.gap).toBe(50000n);
  });
  it('suggests cheaper alternatives when a needed item uses most available funds', () => {
    const result = assessPurchase(needed, finance(75000, 100000));
    expect(result.decision).toBe('alternative');
    expect(result.share).toBe(75);
  });
  it('allows considering a needed item with a low share of protected spending funds', () => {
    expect(assessPurchase(needed, finance(25000, 200000)).decision).toBe('consider');
  });
  it('never treats missing answers as approval', () => {
    expect(assessPurchase({}, finance(25000, 200000)).decision).toBe('uncertain');
  });
  it('does not spend protected reserves', () => {
    const result = assessPurchase(needed, finance(25000, 500000, 0, 500000));
    expect(result.safeToSpend).toBe(0n);
    expect(result.decision).toBe('save');
  });
});

describe('guided budget input', () => {
  it('accepts plain digits and locale-formatted amounts', () => {
    for (const [raw, language, expected] of [
      ['1500000', 'id', 150000000n], [' 1.500.000,25 ', 'id', 150000025n],
      ['1500000,5', 'id', 150000050n], ['0', 'id', 0n],
      ['1,500,000.25', 'en', 150000025n], ['1500000.5', 'en', 150000050n],
    ] as const) expect(parseBudgetAmount(raw, language)).toBe(expected);
  });

  it('flows from formatted budget inputs to the FOMO and shortfall recommendations', () => {
    function assessEnteredBudget(answers: ScreeningAnswers, values: readonly [string, string, string, string]) {
      const [priceMinor, cashMinor, billsMinor, setAsideMinor] = values.map(value => parseBudgetAmount(value, 'id'));
      if (priceMinor == null || cashMinor == null || billsMinor == null || setAsideMinor == null) {
        throw new Error('Expected valid formatted budget inputs');
      }
      return assessPurchase(answers, { priceMinor, cashMinor, billsMinor, setAsideMinor });
    }
    expect(assessEnteredBudget(fomo, ['250000', '1.500.000,00', '200000', '300000']))
      .toMatchObject({ decision: 'pause', safeToSpend: 100000000n, gap: 0n });
    expect(assessEnteredBudget(needed, ['500.000', '600000', '200000', '100000']))
      .toMatchObject({ decision: 'save', safeToSpend: 30000000n, gap: 20000000n });
  });

  it('rejects mixed, malformed, or oversized values', () => {
    for (const raw of ['', '-1', '1e6', '1.23.456', '1,500,000.25', '1,500', '1234567890123456']) {
      expect(parseBudgetAmount(raw, 'id')).toBeNull();
    }
    expect(parseBudgetAmount('1.500.000,25', 'en')).toBeNull();
    expect(parseBudgetAmount('1.500', 'en')).toBeNull();
  });
});
