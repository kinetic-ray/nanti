import { describe, expect, it } from 'vitest';
import { evaluateScreening, type ScreeningAnswers } from '../shared/screening.js';
import { assessPurchase } from '../shared/purchase-decision.js';

const needsProduct: ScreeningAnswers = {
  practicalNeed: true, alreadyHave: false, useOften: true,
  canWait: true, withoutDiscount: true, socialPressure: false,
};
const finances = { priceMinor: 100000000n, cashMinor: 50000000n, billsMinor: 10000000n, setAsideMinor: 10000000n };

describe('recommendation eligibility', () => {
  it('accepts a complete genuine-need screening', () => {
    const result = evaluateScreening(needsProduct, null, '2026-11-22');
    expect(result.outcome).toBe('green');
    expect(result.unanswered).toHaveLength(0);
    expect(assessPurchase(needsProduct, finances).decision).toBe('save');
  });
  it('rejects FOMO and no-clear-need scenarios', () => {
    const fomo: ScreeningAnswers = { ...needsProduct, practicalNeed: false, socialPressure: true, withoutDiscount: false };
    expect(evaluateScreening(fomo, null, '2026-11-22').outcome).toBe('red');
    expect(assessPurchase(fomo, finances).decision).toBe('pause');
  });
  it('does not treat incomplete answers as eligible', () => {
    const partial: ScreeningAnswers = { practicalNeed: true };
    expect(evaluateScreening(partial, null, '2026-11-22').unanswered.length).toBeGreaterThan(0);
    expect(assessPurchase(partial, finances).decision).toBe('uncertain');
  });
});
