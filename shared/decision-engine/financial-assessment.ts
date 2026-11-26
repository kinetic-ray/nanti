export type FinancialStatus =
  | 'not_assessed'
  | 'insufficient_data'
  | 'affordable'
  | 'limited'
  | 'risky';

export type FinancialInput = {
  monthlyIncome: number | null;
  monthlyExpenses: number | null;
  monthlyDebtPayments: number | null;
  monthlySavings: number | null;
  availableCash: number | null;
  protectedReserve: number | null;
  incomeStability: 'steady' | 'variable' | 'irregular' | null;
};

export type PurchaseTerms =
  | {
      method: 'cash';
      price: number;
    }
  | {
      method: 'installment';
      price: number;
      downPayment: number | null;
      monthlyPayment: number | null;
      months: number | null;
    }
  | {
      method: 'unknown';
      price: number | null;
    };

export type FinancialAssessment = {
  status: FinancialStatus;
  monthlySurplus: number | null;
  safeCash: number | null;
  remainingCash: number | null;
  remainingMonthlySurplus: number | null;
  totalPurchaseCost: number | null;
  missingFields: readonly string[];
  reasonIds: readonly string[];
};

function validAmount(value: number | null): value is number {
  return value !== null &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

export function assessFinancialReadiness(
  input: FinancialInput | null,
  purchase: PurchaseTerms,
): FinancialAssessment {
  const result: FinancialAssessment = {
    status: 'not_assessed',
    monthlySurplus: null,
    safeCash: null,
    remainingCash: null,
    remainingMonthlySurplus: null,
    totalPurchaseCost: null,
    missingFields: [],
    reasonIds: [],
  };

  if (!input) return result;

  const missing: string[] = [];
  const reasons: string[] = [];

  const {
    monthlyIncome,
    monthlyExpenses,
    monthlyDebtPayments,
    monthlySavings,
    availableCash,
    protectedReserve,
    incomeStability,
  } = input;

  if (!validAmount(monthlyIncome)) missing.push('monthlyIncome');
  if (!validAmount(monthlyExpenses)) missing.push('monthlyExpenses');
  if (!validAmount(monthlyDebtPayments)) missing.push('monthlyDebtPayments');
  if (!validAmount(monthlySavings)) missing.push('monthlySavings');
  if (!validAmount(availableCash)) missing.push('availableCash');
  if (!validAmount(protectedReserve)) missing.push('protectedReserve');
  if (!incomeStability) missing.push('incomeStability');

  if (
    validAmount(monthlyIncome) &&
    validAmount(monthlyExpenses) &&
    validAmount(monthlyDebtPayments) &&
    validAmount(monthlySavings)
  ) {
    result.monthlySurplus =
      monthlyIncome -
      monthlyExpenses -
      monthlyDebtPayments -
      monthlySavings;
  }

  if (
    validAmount(availableCash) &&
    validAmount(protectedReserve)
  ) {
    result.safeCash = Math.max(
      0,
      availableCash - protectedReserve,
    );
  }

  if (
    !validAmount(purchase.price) ||
    purchase.price === 0
  ) {
    missing.push('purchasePrice');
  }

  if (purchase.method === 'unknown') {
    missing.push('paymentMethod');
  }

  if (purchase.method === 'cash') {
    if (validAmount(purchase.price) && purchase.price > 0) {
      result.totalPurchaseCost = purchase.price;

      if (result.safeCash !== null) {
        result.remainingCash =
          result.safeCash - purchase.price;
      }
    }
  }

  if (purchase.method === 'installment') {
    const { downPayment, monthlyPayment, months } = purchase;

    if (!validAmount(downPayment)) missing.push('downPayment');

    if (
      !validAmount(monthlyPayment) ||
      monthlyPayment === 0
    ) {
      missing.push('monthlyPayment');
    }

    if (
      months === null ||
      !Number.isSafeInteger(months) ||
      months <= 0
    ) {
      missing.push('installmentMonths');
    }

    if (
      validAmount(downPayment) &&
      validAmount(monthlyPayment) &&
      monthlyPayment > 0 &&
      months !== null &&
      Number.isSafeInteger(months) &&
      months > 0
    ) {
      const total = downPayment + monthlyPayment * months;

      if (
        Number.isSafeInteger(total) &&
        validAmount(purchase.price) &&
        total >= purchase.price
      ) {
        result.totalPurchaseCost = total;
      } else {
        missing.push('validInstallmentTerms');
      }
    }

    if (
      result.safeCash !== null &&
      validAmount(downPayment)
    ) {
      result.remainingCash =
        result.safeCash - downPayment;
    }

    if (
      result.monthlySurplus !== null &&
      validAmount(monthlyPayment)
    ) {
      result.remainingMonthlySurplus =
        result.monthlySurplus - monthlyPayment;
    }
  }

  if (
    result.monthlySurplus !== null &&
    result.monthlySurplus < 0
  ) {
    reasons.push('negative_monthly_surplus');
  }

  if (
    result.remainingCash !== null &&
    result.remainingCash < 0
  ) {
    reasons.push('purchase_exceeds_safe_cash');
  }

  if (
    result.remainingMonthlySurplus !== null &&
    result.remainingMonthlySurplus < 0
  ) {
    reasons.push('installment_exceeds_monthly_surplus');
  }

  if (
    validAmount(availableCash) &&
    validAmount(protectedReserve) &&
    availableCash < protectedReserve
  ) {
    reasons.push('protected_reserve_not_met');
  }

  result.missingFields = missing;

  // Confirmed financial risks take precedence over missing data.
  if (reasons.length) {
    return {
      ...result,
      status: 'risky',
      reasonIds: reasons,
    };
  }

  if (missing.length) {
    return {
      ...result,
      status: 'insufficient_data',
      reasonIds: ['financial_information_incomplete'],
    };
  }

  if (
    result.remainingCash === 0 ||
    result.monthlySurplus === 0 ||
    result.remainingMonthlySurplus === 0
  ) {
    reasons.push('no_remaining_financial_buffer');
  }

  if (incomeStability !== 'steady') {
    reasons.push('income_not_steady');
  }

  if (
    purchase.method === 'installment' &&
    result.monthlySurplus !== null &&
    result.monthlySurplus > 0 &&
    validAmount(purchase.monthlyPayment) &&
    purchase.monthlyPayment / result.monthlySurplus > 0.5
  ) {
    reasons.push('installment_consumes_surplus');
  }

  if (
    purchase.method === 'cash' &&
    result.safeCash !== null &&
    result.safeCash > 0 &&
    validAmount(purchase.price) &&
    purchase.price / result.safeCash > 0.8
  ) {
    reasons.push('purchase_consumes_cash_buffer');
  }

  if (reasons.length) {
    return {
      ...result,
      status: 'limited',
      reasonIds: reasons,
    };
  }

  return {
    ...result,
    status: 'affordable',
    reasonIds: ['purchase_within_available_budget'],
  };
}