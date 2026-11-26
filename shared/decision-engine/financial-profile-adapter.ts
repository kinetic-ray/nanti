import type { FinancialInput } from './financial-assessment.js';

type ProfileAmount = string | null;

export type FinancialProfileSource = {
  income: {
    items: readonly {
      monthlyNet: ProfileAmount;
    }[];
    stability: FinancialInput['incomeStability'];
    confirmed: boolean;
  } | null;

  expenses: {
    items: readonly {
      monthlyAmount: ProfileAmount;
      classification: string;
    }[];
    confirmed: boolean;
  } | null;

  debts: {
    status: 'unknown' | 'none' | 'listed';
    items: readonly {
      monthlyAmount: ProfileAmount;
    }[];
  } | null;

  savings: {
    monthlyAmount: ProfileAmount;
  } | null;

  readiness: {
    availableCash: ProfileAmount;
    emergencyFund: ProfileAmount;
  } | null;
};

export function parseRupiah(
  value: string | null | undefined,
): number | null {
  if (typeof value !== 'string') return null;
  if (!/^\d+$/.test(value)) return null;

  const amount = Number(value);

  return Number.isSafeInteger(amount) &&
    amount >= 0 &&
    amount <= 1_000_000_000_000
      ? amount
      : null;
}

export function priceMinorToRupiah(
  priceMinor: number | string | null,
  quantity = 1,
): number | null {
  if (priceMinor === null) return null;

  if (
    typeof priceMinor === 'string' &&
    !/^\d+$/.test(priceMinor)
  ) {
    return null;
  }

  const amount = Number(priceMinor);

  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0
  ) {
    return null;
  }

  const total = amount * quantity;

  if (!Number.isSafeInteger(total)) return null;

  return Math.ceil(total / 100);
}

function sumAmounts(
  values: readonly ProfileAmount[],
): number | null {
  let total = 0;

  for (const value of values) {
    const amount = parseRupiah(value);

    if (amount === null) return null;

    total += amount;

    if (!Number.isSafeInteger(total)) return null;
  }

  return total;
}

export function adaptFinancialProfile(
  profile: FinancialProfileSource | null,
  options: {
    reserveIncludedInCash?: boolean;
    debtExcludedFromExpenses?: boolean;
  } = {},
): FinancialInput | null {
  if (!profile) return null;

  const hasData = Boolean(
    profile.income ||
    profile.expenses ||
    profile.debts ||
    profile.savings ||
    profile.readiness,
  );

  if (!hasData) return null;

  const monthlyIncome =
    profile.income?.confirmed
      ? sumAmounts(
          profile.income.items.map(item => item.monthlyNet),
        )
      : null;

  const monthlyExpenses =
    profile.expenses?.confirmed
      ? sumAmounts(
          profile.expenses.items.map(item => item.monthlyAmount),
        )
      : null;

  let monthlyDebtPayments: number | null = null;

  if (profile.debts?.status === 'none') {
    monthlyDebtPayments = 0;
  }

  if (
    profile.debts?.status === 'listed' &&
    options.debtExcludedFromExpenses === true &&
    profile.debts.items.length > 0
  ) {
    monthlyDebtPayments = sumAmounts(
      profile.debts.items.map(item => item.monthlyAmount),
    );
  }

  const emergencyFund = parseRupiah(
    profile.readiness?.emergencyFund,
  );

  const protectedReserve =
    options.reserveIncludedInCash === true
      ? emergencyFund
      : options.reserveIncludedInCash === false &&
        emergencyFund !== null
        ? 0
        : null;

  return {
    monthlyIncome,
    monthlyExpenses,
    monthlyDebtPayments,
    monthlySavings: parseRupiah(
      profile.savings?.monthlyAmount,
    ),
    availableCash: parseRupiah(
      profile.readiness?.availableCash,
    ),
    protectedReserve,
    incomeStability: profile.income?.stability ?? null,
  };
}