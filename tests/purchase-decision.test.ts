import { describe, expect, it } from 'vitest';
import { assessPurchase } from '../shared/purchase-decision.js';
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
