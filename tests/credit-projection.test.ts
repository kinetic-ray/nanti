import { describe, expect, it } from 'vitest';
import { adaptFinancialProfile } from '../shared/decision-engine/financial-profile-adapter.js';
import { projectCredit } from '../shared/decision-engine/credit-projection.js';
import type { FinancialInput } from '../shared/decision-engine/financial-assessment.js';

const input: FinancialInput = {
  monthlyIncome: 5_000_000, monthlyExpenses: 2_000_000, monthlyDebtPayments: 500_000,
  monthlySavings: 500_000, availableCash: 800_000, protectedReserve: 0, incomeStability: 'steady',
};
const terms = {
  cashPriceMinor: 235_900_050n, downPayment: 1_000_000, monthlyPayment: 200_000, months: 12,
};
const run = (overrides: Partial<typeof terms> = {}, profile: FinancialInput | null = input, currency = 'IDR') =>
  projectCredit({ ...terms, ...overrides, currency, asOf: '2026-11-27', profile })!;

describe('credit projection', () => {
  it('preserves minor units, total commitment and the down-payment shortfall', () => {
    expect(run()).toMatchObject({
      totalFuturePayments: 240_000_000n, totalPurchaseCost: 340_000_000n,
      additionalCost: 104_099_950n, additionalCostBasisPoints: 4413n,
      remainingCash: -20_000_000n, monthlyBefore: 200_000_000n, monthlyAfter: 180_000_000n,
      installmentShareBasisPoints: 1000n, months: 12,
    });
    expect(run().monthAt(0)).toMatchObject({
      installment: 0n, downPayment: 100_000_000n, cumulativeSpend: 100_000_000n,
      remainingCommitment: 240_000_000n, difference: -100_000_000n, disposableIncome: null,
    });
  });

  it('distinguishes zero down payment and zero credit cost from missing data', () => {
    expect(run({ cashPriceMinor: 240_000_000n, downPayment: 0 })).toMatchObject({
      downPayment: 0n, additionalCost: 0n, additionalCostBasisPoints: 0n, missingPurchase: [],
    });
  });

  it('keeps independently computable values for incomplete terms and profiles', () => {
    const projection = projectCredit({
      ...terms, currency: 'IDR', cashPriceMinor: null, downPayment: null, profile: null, asOf: '2026-11-27',
    })!;
    expect(projection.missingPurchase).toEqual(['purchasePrice', 'downPayment']);
    expect(projection.missingProfile).toContain('monthlyIncome');
    expect(projection.totalPurchaseCost).toBeNull();
    expect(projection.totalFuturePayments).toBe(240_000_000n);
    expect(projection.monthAt(1)).toMatchObject({
      cumulativeSpend: null, installment: 20_000_000n, disposableIncome: null, difference: -20_000_000n,
    });
    expect(run({}, { ...input, monthlySavings: null }).monthlyBefore).toBeNull();
  });

  it('retains the repayment schedule with no profile and no cash benchmark', () => {
    const projection = projectCredit({ ...terms, currency: 'IDR', cashPriceMinor: null, profile: null, asOf: '2026-11-27' })!;
    expect(projection.totalPurchaseCost).toBe(340_000_000n);
    expect(projection.additionalCost).toBeNull();
    expect(projection.monthAt(12)?.cumulativeSpend).toBe(340_000_000n);
  });

  it('flags invalid terms and omits an invalid schedule', () => {
    expect(run({ months: 0, monthlyPayment: -1, downPayment: -1 }).missingPurchase)
      .toEqual(['downPayment', 'monthlyPayment', 'installmentMonths']);
    expect(run({ months: 0 }).monthAt(1)).toBeNull();
    expect(run({ cashPriceMinor: 400_000_000n })).toMatchObject({
      missingPurchase: ['validInstallmentTerms'], totalPurchaseCost: null, additionalCost: null,
    });
  });

  it.each([
    [3_000_000, 0n, -20_000_000n, null],
    [2_900_000, -10_000_000n, -30_000_000n, null],
    [3_100_000, 10_000_000n, -10_000_000n, 20_000n],
  ])('keeps signed disposable income and computes share only for positive income (%i)', (monthlyIncome, before, after, share) => {
    expect(run({}, { ...input, monthlyIncome })).toMatchObject({
      monthlyBefore: before, monthlyAfter: after, installmentShareBasisPoints: share,
    });
  });

  it('uses dated debt maturity and retains obligations with unknown duration', () => {
    const adapted = adaptFinancialProfile({
      income: null, expenses: null, savings: null, readiness: null,
      debts: { status: 'listed', items: [
        { monthlyAmount: '100000', remainingMonths: 3, estimateDate: '2026-10-27' },
        { monthlyAmount: '200000', remainingMonths: 15, estimateDate: '2026-11-27' },
        { monthlyAmount: '150000', remainingMonths: null, estimateDate: null },
        { monthlyAmount: '50000', remainingMonths: 1, estimateDate: '2026-11-28' },
      ] },
    }, { debtExcludedFromExpenses: true })!;
    const projection = run({}, { ...input, ...adapted, monthlyIncome: input.monthlyIncome,
      monthlyExpenses: input.monthlyExpenses, monthlySavings: input.monthlySavings });
    expect(projection.debtEndings).toEqual([{ month: 2, monthlyPayment: 10_000_000n }, { month: 15, monthlyPayment: 20_000_000n }]);
    expect(projection.hasUnknownDebtDuration).toBe(true);
    expect(projection.monthAt(2)?.existingDebt).toBe(50_000_000n);
    expect(projection.monthAt(3)?.existingDebt).toBe(40_000_000n);
    expect(projection.monthAt(12)).toMatchObject({
      existingDebt: 40_000_000n, installment: 20_000_000n, remainingCommitment: 0n,
    });
    expect(projection.monthAt(13)).toMatchObject({
      existingDebt: 40_000_000n, installment: 0n, remainingCommitment: 0n,
      disposableIncome: 210_000_000n, cumulativeSpend: 340_000_000n, difference: 0n,
    });
    expect(projection.monthAt(14)).toBeNull();
  });

  it('calculates large values exactly without allocating all projected months', () => {
    const projection = run({ monthlyPayment: 999_999_999_999, months: 999_999_999_999 });
    expect(projection.totalFuturePayments).toBe(99_999_999_999_800_000_000_000_100n);
    expect(projection.monthAt(1_000_000_000_000)?.installment).toBe(0n);
  });

  it('supports promotional credit with negative price differences', () => {
    expect(projectCredit({
      ...terms, cashPriceMinor: 400_000_000n, transactionPriceMinor: 340_000_000n,
      currency: 'IDR', asOf: '2026-11-27', profile: input,
    })).toMatchObject({
      totalPurchaseCost: 340_000_000n,
      additionalCost: -60_000_000n,
      additionalCostBasisPoints: -1500n,
      missingPurchase: [],
    });
  });

  it('reconciles uneven installment rounding with the exact repayment and monthly balances', () => {
    const projection = projectCredit({
      ...terms, downPayment: 0, cashPriceMinor: 100_000_000n, repaymentMinor: 106_000_000n,
      months: 3, currency: 'IDR', asOf: '2026-11-27', profile: input,
    })!;
    expect(projection.monthAt(1)).toMatchObject({ installment: 35_333_334n, remainingCommitment: 70_666_666n });
    expect(projection.monthAt(2)).toMatchObject({ installment: 35_333_333n, remainingCommitment: 35_333_333n });
    expect(projection.monthAt(3)).toMatchObject({ installment: 35_333_333n, remainingCommitment: 0n, cumulativeSpend: 106_000_000n });
  });

  it('calculates calendar dates from the projection reference date', () => {
    const projection = run();

    expect(projection.dateAt(0)).toBe('2026-11-27');
    expect(projection.dateAt(1)).toBe('2026-12-27');
    expect(projection.dateAt(12)).toBe('2027-11-27');
    expect(projection.dateAt(13)).toBe('2027-12-27');
  });

  it.each([
    ['2027-01-31', '2027-02-28', '2027-03-31'],
    ['2028-01-31', '2028-02-29', '2028-03-31'],
  ])('preserves calendar dates at month boundaries (%s)', (asOf, first, second) => {
    const projection = projectCredit({
      ...terms, currency: 'IDR', profile: input, asOf,
    })!;

    expect(projection.dateAt(1)).toBe(first);
    expect(projection.dateAt(2)).toBe(second);
  });

  it('returns no date for invalid or unrepresentable months', () => {
    expect(run().dateAt(-1)).toBeNull();
    expect(run().dateAt(1.5)).toBeNull();
    expect(run().dateAt(999_999_999_999)).toBeNull();
  });

  it('does not project non-IDR purchases', () => {
    expect(run({}, input, 'USD')).toBeNull();
  });
});
