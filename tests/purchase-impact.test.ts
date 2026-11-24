import { describe, expect, it } from 'vitest';
import { analyzePurchaseImpact } from '../shared/purchase-impact.js';
import type { PurchaseFinanceContext } from '../shared/purchase-impact.js';

const complete: PurchaseFinanceContext = {
  cashMinor: '50000', essentialExpensesMinor: '12000', setAsideMinor: '5000',
  nextIncomeDate: '2026-12-01', nextIncomeMinor: '30000', canWait: true,
};

describe('purchase impact analysis', () => {
  it('subtracts the item, known essentials, and set-aside from reported cash', () => {
    expect(analyzePurchaseImpact(40000n, complete)).toEqual({
      cashAfterPurchaseMinor: 10000n,
      cashAfterKnownCostsMinor: -7000n,
      knownPriceShortfallMinor: null,
      missing: [],
      canEstimateCashAfterCosts: true,
    });
  });

  it('reports a price shortfall without assuming upcoming income is already available', () => {
    const result = analyzePurchaseImpact(60000n, complete);
    expect(result.cashAfterPurchaseMinor).toBe(-10000n);
    expect(result.knownPriceShortfallMinor).toBe(10000n);
    expect(result.cashAfterKnownCostsMinor).toBe(-27000n);
  });

  it('marks missing inputs and does not present an incomplete remainder as a full estimate', () => {
    const result = analyzePurchaseImpact(40000n, {
      ...complete, essentialExpensesMinor: null, setAsideMinor: null, nextIncomeDate: null,
    });
    expect(result.cashAfterPurchaseMinor).toBe(10000n);
    expect(result.cashAfterKnownCostsMinor).toBe(10000n);
    expect(result.canEstimateCashAfterCosts).toBe(false);
    expect(result.missing).toEqual(['nextIncomeDate', 'essentialExpenses', 'setAside']);
  });

  it('handles unknown price and cash without fabricating a balance', () => {
    const result = analyzePurchaseImpact(null, { ...complete, cashMinor: null });
    expect(result.cashAfterPurchaseMinor).toBeNull();
    expect(result.cashAfterKnownCostsMinor).toBeNull();
    expect(result.knownPriceShortfallMinor).toBeNull();
    expect(result.missing).toContain('price');
    expect(result.missing).toContain('cash');
    expect(result.canEstimateCashAfterCosts).toBe(false);
  });
});
