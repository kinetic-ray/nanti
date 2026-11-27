import { describe, expect, it } from 'vitest';

import {
  assessFinancialReadiness,
  combineAssessments,
  adaptFinancialProfile,
  priceMinorToRupiah,
  parseRupiah,
  buildExplanation,
  decisionEngineVersion,
  type FinancialInput,
  type BehavioralAssessment,
  type DecisionOutcome,
  type FinancialProfileSource,
} from '../shared/decision-engine/index.js';

const financial: FinancialInput = {
  monthlyIncome: 6_000_000,
  monthlyExpenses: 3_000_000,
  monthlyDebtPayments: 500_000,
  monthlySavings: 500_000,
  availableCash: 3_500_000,
  protectedReserve: 2_000_000,
  incomeStability: 'steady',
};

function behavioral(
  outcome: DecisionOutcome = 'worth_considering',
): BehavioralAssessment {
  return {
    version: decisionEngineVersion,
    outcome,
    scores: {
      need: 4,
      personal_value: 3,
      urgency: 2,
      impulse: 0,
      product_fit: 5,
      evidence: 5,
    },
    evidence: [],
    reasonIds: ['strong_functional_benefit'],
    actionId: 'review_purchase_readiness',
    unresolvedConflict: false,
  };
}

describe('Financial assessment', () => {
  it('supports basic mode without a profile', () => {
    const result = assessFinancialReadiness(null, {
      method: 'cash',
      price: 1_000_000,
    });

    expect(result.status).toBe('not_assessed');
  });

  it('calculates available cash and monthly surplus', () => {
    const result = assessFinancialReadiness(financial, {
      method: 'cash',
      price: 1_000_000,
    });

    expect(result.status).toBe('affordable');
    expect(result.monthlySurplus).toBe(2_000_000);
    expect(result.safeCash).toBe(1_500_000);
    expect(result.remainingCash).toBe(500_000);
  });

  it('protects emergency reserves', () => {
    const result = assessFinancialReadiness(financial, {
      method: 'cash',
      price: 2_000_000,
    });

    expect(result.status).toBe('risky');
    expect(result.remainingCash).toBe(-500_000);
  });

  it('does not treat unknown income as zero', () => {
    const result = assessFinancialReadiness({
      ...financial,
      monthlyIncome: null,
    }, {
      method: 'cash',
      price: 500_000,
    });

    expect(result.status).toBe('insufficient_data');
    expect(result.monthlySurplus).toBeNull();
  });

  it('preserves confirmed risks despite missing information', () => {
    const result = assessFinancialReadiness({
      ...financial,
      monthlyIncome: null,
    }, {
      method: 'cash',
      price: 2_000_000,
    });

    expect(result.status).toBe('risky');
    expect(result.missingFields).toContain('monthlyIncome');
  });

  it('calculates the total installment cost', () => {
    const result = assessFinancialReadiness(financial, {
      method: 'installment',
      price: 1_000_000,
      downPayment: 100_000,
      monthlyPayment: 200_000,
      months: 6,
    });

    expect(result.totalPurchaseCost).toBe(1_300_000);
    expect(result.remainingMonthlySurplus).toBe(1_800_000);
    expect(result.status).toBe('affordable');
  });

  it('rejects installments beyond monthly surplus', () => {
    const result = assessFinancialReadiness(financial, {
      method: 'installment',
      price: 5_000_000,
      downPayment: 0,
      monthlyPayment: 2_500_000,
      months: 3,
    });

    expect(result.status).toBe('risky');
  });

  it('does not approve incomplete installment terms', () => {
    const result = assessFinancialReadiness(financial, {
      method: 'installment',
      price: 1_000_000,
      downPayment: 0,
      monthlyPayment: null,
      months: null,
    });

    expect(result.status).toBe('insufficient_data');
  });

  it('handles variable income conservatively', () => {
    const result = assessFinancialReadiness({
      ...financial,
      incomeStability: 'variable',
    }, {
      method: 'cash',
      price: 500_000,
    });

    expect(result.status).toBe('limited');
  });

  it('does not approve a purchase with zero remaining cash', () => {
    const result = assessFinancialReadiness(financial, {
      method: 'cash',
      price: 1_500_000,
    });

    expect(result.status).toBe('limited');
  });
});

describe('Combined assessment', () => {
  const affordable = assessFinancialReadiness(financial, {
    method: 'cash',
    price: 500_000,
  });

  const risky = assessFinancialReadiness(financial, {
    method: 'cash',
    price: 5_000_000,
  });

  it('never creates a need from financial ability', () => {
    const result = combineAssessments(
      behavioral('not_needed'),
      affordable,
    );

    expect(result.outcome).toBe('not_needed');
  });

  it('recognizes a suitable and affordable purchase', () => {
    const result = combineAssessments(
      behavioral(),
      affordable,
    );

    expect(result.outcome).toBe('worth_buying');
  });

  it('keeps the behavioral verdict when the budget fits an estimated installment', () => {
    const simulated = assessFinancialReadiness(financial, {
      method: 'installment', price: 600_000, downPayment: 0, monthlyPayment: 200_000, months: 3, estimated: true,
    });
    expect(simulated.status).toBe('affordable');
    expect(combineAssessments(behavioral(), simulated).outcome).toBe('worth_considering');
  });

  it('uses exact repayment instead of a mismatched monthly amount for readiness', () => {
    expect(assessFinancialReadiness(financial, {
      method: 'installment', price: 6_000_000, downPayment: 0, monthlyPayment: 1,
      months: 2, repaymentMinor: 600_000_001n, estimated: true,
    })).toMatchObject({
      status: 'risky', remainingMonthlySurplus: -1_000_001,
      reasonIds: ['installment_exceeds_monthly_surplus'],
    });
  });

  it('blocks a financially risky purchase', () => {
    const result = combineAssessments(
      behavioral(),
      risky,
    );

    expect(result.outcome).toBe('do_not_buy_now');
  });

  it('preserves basic mode without financial information', () => {
    const result = combineAssessments(
      behavioral(),
      assessFinancialReadiness(null, {
        method: 'cash',
        price: 500_000,
      }),
    );

    expect(result.mode).toBe('basic');
    expect(result.outcome).toBe('worth_considering');
    expect(buildExplanation(result).financialNotice).not.toBeNull();
  });

  it('does not approve a mismatched product', () => {
    const result = combineAssessments({
      ...behavioral(),
      reasonIds: ['product_fit_limitation'],
    }, affordable);

    expect(result.outcome).toBe('worth_considering');
  });

  it('suggests affordable alternatives for safety needs', () => {
    const result = combineAssessments({
      ...behavioral(),
      reasonIds: ['confirmed_safety_need'],
    }, risky);

    expect(result.actionId).toBe(
      'find_affordable_safe_alternative',
    );
  });
});

describe('Financial profile adapter', () => {
  const profile: FinancialProfileSource = {
    income: {
      items: [{ monthlyNet: '6000000' }],
      stability: 'steady',
      confirmed: true,
    },
    expenses: {
      items: [
        {
          monthlyAmount: '3000000',
          classification: 'essential',
        },
      ],
      confirmed: true,
    },
    debts: {
      status: 'listed',
      items: [{ monthlyAmount: '500000' }],
    },
    savings: { monthlyAmount: '500000' },
    readiness: {
      availableCash: '3500000',
      emergencyFund: '2000000',
    },
  };

  it('adapts confirmed financial information', () => {
    expect(adaptFinancialProfile(profile, {
      reserveIncludedInCash: true,
      debtExcludedFromExpenses: true,
    })).toEqual(financial);
  });

  it('counts confirmed empty expense rows as zero', () => {
    const result = adaptFinancialProfile({
      ...profile,
      expenses: {
        confirmed: true,
        items: [
          { monthlyAmount: '3000000', classification: 'essential' },
          { monthlyAmount: null, classification: 'flexible' },
        ],
      },
    });

    expect(result?.monthlyExpenses).toBe(3000000);
  });

  it('preserves unknown expenses when not confirmed', () => {
    const result = adaptFinancialProfile({
      ...profile,
      expenses: {
        confirmed: false,
        items: [
          { monthlyAmount: null, classification: 'essential' },
        ],
      },
    });

    expect(result?.monthlyExpenses).toBeNull();
  });

  it('uses the native financial profile semantics', () => {
    const input = adaptFinancialProfile(profile, {
      debtExcludedFromExpenses: true,
      reserveIncludedInCash: false,
    });

    expect(input?.monthlyDebtPayments).toBe(500000);
    expect(input?.protectedReserve).toBe(0);

    const result = assessFinancialReadiness(input, {
      method: 'cash',
      price: 1000000,
    });

    expect(result.monthlySurplus).toBe(2000000);
    expect(result.safeCash).toBe(3500000);
    expect(result.remainingCash).toBe(2500000);
    expect(result.status).toBe('affordable');
  });

  it('does not guess whether debt is already included', () => {
    expect(
      adaptFinancialProfile(profile)?.monthlyDebtPayments,
    ).toBeNull();
  });

  it('does not guess whether reserve is included in cash', () => {
    expect(
      adaptFinancialProfile(profile)?.protectedReserve,
    ).toBeNull();
  });

  it('does not deduct a separately held reserve twice', () => {
    expect(adaptFinancialProfile(profile, {
      reserveIncludedInCash: false,
    })?.protectedReserve).toBe(0);
  });

  it('preserves explicitly confirmed zero debt', () => {
    expect(adaptFinancialProfile({
      ...profile,
      debts: { status: 'none', items: [] },
    })?.monthlyDebtPayments).toBe(0);
  });

  it('does not assume unconfirmed income is valid', () => {
    expect(adaptFinancialProfile({
      ...profile,
      income: {
        items: [{ monthlyNet: '6000000' }],
        stability: 'steady',
        confirmed: false,
      },
    })?.monthlyIncome).toBeNull();
  });

  it('returns basic mode for an empty profile', () => {
    expect(adaptFinancialProfile({
      income: null,
      expenses: null,
      debts: null,
      savings: null,
      readiness: null,
    })).toBeNull();
  });

  it('converts minor units and quantity correctly', () => {
    expect(priceMinorToRupiah(173500000)).toBe(1735000);
    expect(priceMinorToRupiah('100000000', 2)).toBe(2000000);
  });

  it('rejects invalid monetary inputs', () => {
    expect(parseRupiah('-100')).toBeNull();
    expect(parseRupiah('1.5')).toBeNull();
    expect(parseRupiah(null)).toBeNull();
    expect(priceMinorToRupiah('')).toBeNull();
    expect(priceMinorToRupiah(100, 0)).toBeNull();
  });
});

describe('Financial readiness edge cases', () => {
  const input = {
    monthlyIncome: 6000000,
    monthlyExpenses: 3000000,
    monthlyDebtPayments: 500000,
    monthlySavings: 500000,
    availableCash: 3500000,
    protectedReserve: 2000000,
    incomeStability: 'steady' as const,
  };

  it('rejects zero purchase price', () => {
    const result = assessFinancialReadiness(input, {
      method: 'cash',
      price: 0,
    });

    expect(result.status).toBe('insufficient_data');
    expect(result.missingFields).toContain('purchasePrice');
  });

  it('rejects zero installment duration', () => {
    const result = assessFinancialReadiness(input, {
      method: 'installment',
      price: 1000000,
      downPayment: 0,
      monthlyPayment: 200000,
      months: 0,
    });

    expect(result.status).toBe('insufficient_data');
    expect(result.missingFields).toContain('installmentMonths');
  });

  it('accepts promotional installment totals against an adjusted transaction price', () => {
    const result = assessFinancialReadiness(input, {
      method: 'installment',
      price: 1000000,
      transactionPriceMinor: 50_000_000n,
      downPayment: 0,
      monthlyPayment: 100000,
      months: 5,
    });

    expect(result.totalPurchaseCost).toBe(500000);
    expect(result.missingFields).not.toContain('validInstallmentTerms');
  });

  it('blocks a one-rupiah installment without a confirmed discount', () => {
    expect(assessFinancialReadiness(input, {
      method: 'installment', price: 2_000_000, downPayment: 0, monthlyPayment: 1, months: 12,
    })).toMatchObject({
      status: 'insufficient_data', totalPurchaseCost: null, remainingMonthlySurplus: null,
      missingFields: ['validInstallmentTerms'],
    });
  });

  it('flags down payment exceeding safe cash', () => {
    const result = assessFinancialReadiness(input, {
      method: 'installment',
      price: 3000000,
      downPayment: 2000000,
      monthlyPayment: 200000,
      months: 5,
    });

    expect(result.status).toBe('risky');
    expect(result.reasonIds).toContain('purchase_exceeds_safe_cash');
  });

  it('limits installments consuming all monthly surplus', () => {
    const result = assessFinancialReadiness(input, {
      method: 'installment',
      price: 2000000,
      downPayment: 0,
      monthlyPayment: 2000000,
      months: 1,
    });

    expect(result.status).toBe('limited');
    expect(result.remainingMonthlySurplus).toBe(0);
  });

  it('limits cash purchases consuming all safe cash', () => {
    const result = assessFinancialReadiness(input, {
      method: 'cash',
      price: 1500000,
    });

    expect(result.status).toBe('limited');
    expect(result.remainingCash).toBe(0);
  });

  it('limits purchases with irregular income', () => {
    const result = assessFinancialReadiness({
      ...input,
      incomeStability: 'irregular',
    }, {
      method: 'cash',
      price: 500000,
    });

    expect(result.status).toBe('limited');
    expect(result.reasonIds).toContain('income_not_steady');
  });

  it('preserves confirmed risk despite missing income', () => {
    const result = assessFinancialReadiness({
      ...input,
      monthlyIncome: null,
    }, {
      method: 'cash',
      price: 2000000,
    });

    expect(result.status).toBe('risky');
    expect(result.missingFields).toContain('monthlyIncome');
    expect(result.reasonIds).toContain('purchase_exceeds_safe_cash');
  });
});
