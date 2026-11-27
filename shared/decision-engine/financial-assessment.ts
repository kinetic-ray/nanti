import { coversTransaction } from './credit-estimation.js';

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
  existingDebts?: readonly {
    monthlyPayment: number;
    remainingMonths?: number | null;
    estimateDate?: string | null;
  }[];
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
      transactionPriceMinor?: bigint;
      repaymentMinor?: bigint;
      estimated?: boolean;
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
  estimated?: boolean;
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
  if (purchase.method === 'installment' && purchase.estimated) result.estimated = true;

  if (!input) return result;

  const missing: string[] = [];
  const reasons: string[] = [];
  let budgetInstallment: number | null = null;

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
  if (incomeStability !== 'steady' && incomeStability !== 'variable' && incomeStability !== 'irregular') {
    missing.push('incomeStability');
  }

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
    const validTerm = months !== null && Number.isSafeInteger(months) && months > 0;
    const repayment = purchase.repaymentMinor ?? (validTerm && validAmount(monthlyPayment)
      ? BigInt(monthlyPayment) * BigInt(months) * 100n : null);
    const divisor = validTerm ? BigInt(months) * 100n : null;
    budgetInstallment = purchase.repaymentMinor !== undefined && divisor !== null
      ? Number((purchase.repaymentMinor + divisor - 1n) / divisor)
      : monthlyPayment;

    if (!validAmount(downPayment)) missing.push('downPayment');

    if (!validAmount(budgetInstallment) || budgetInstallment === 0) {
      missing.push('monthlyPayment');
    }

    if (!validTerm) missing.push('installmentMonths');

    if (validAmount(downPayment)) {
      const price = validAmount(purchase.price) ? BigInt(purchase.price) * 100n : 0n;
      const transaction = purchase.transactionPriceMinor ?? price;
      const down = BigInt(downPayment) * 100n;
      if (transaction > price || (price > 0n && down >= transaction) ||
          (repayment !== null && (repayment > 0n || purchase.repaymentMinor !== undefined) &&
            !coversTransaction(transaction, down, repayment))) {
        missing.push('validInstallmentTerms');
      } else if (repayment !== null && repayment > 0n) {
        const total = Number((down + repayment + 99n) / 100n);
        if (Number.isSafeInteger(total)) result.totalPurchaseCost = total;
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
      validAmount(budgetInstallment) &&
      !missing.includes('validInstallmentTerms')
    ) {
      result.remainingMonthlySurplus =
        result.monthlySurplus - budgetInstallment;
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

  if (missing.includes('validInstallmentTerms')) {
    return { ...result, status: 'insufficient_data', reasonIds: ['financial_information_incomplete'] };
  }

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
    validAmount(budgetInstallment) &&
    budgetInstallment / result.monthlySurplus > 0.5
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
