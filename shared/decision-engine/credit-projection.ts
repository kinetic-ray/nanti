import type { FinancialInput } from './financial-assessment.js';
import { coversTransaction } from './credit-estimation.js';

type Amount = bigint | null;

type CreditProjectionInput = {
  currency: string;
  cashPriceMinor: Amount;
  transactionPriceMinor?: bigint;
  repaymentMinor?: bigint;
  downPayment: number | null;
  monthlyPayment: number | null;
  months: number | null;
  profile: FinancialInput | null;
  /** Local calendar date, supplied by the caller so projections are deterministic. */
  asOf: string;
};

type CreditMonth = {
  month: number;
  income: Amount;
  livingExpenses: Amount;
  existingDebt: Amount;
  savings: Amount;
  downPayment: Amount;
  installment: Amount;
  disposableIncome: Amount;
  cumulativeSpend: Amount;
  remainingCommitment: Amount;
  difference: Amount;
};

function toMinor(amount: number | null | undefined): Amount {
  return typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0
    ? BigInt(amount) * 100n : null;
}

function subtract(left: Amount, right: Amount): Amount {
  return left === null || right === null ? null : left - right;
}

function add(left: Amount, right: Amount): Amount {
  return left === null || right === null ? null : left + right;
}

function basisPoints(amount: bigint, base: bigint): bigint {
  const absolute = amount < 0n ? -amount : amount;
  const rounded = (absolute * 10_000n + base / 2n) / base;
  return amount < 0n ? -rounded : rounded;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function remainingTerm(
  months: number | null | undefined,
  estimatedOn: Date | null,
  asOf: Date | null,
): number | null {
  if (!months || !Number.isSafeInteger(months) || months < 0 || !estimatedOn || !asOf || asOf < estimatedOn) return null;
  let elapsed = (asOf.getUTCFullYear() - estimatedOn.getUTCFullYear()) * 12 +
    asOf.getUTCMonth() - estimatedOn.getUTCMonth();
  const lastDay = new Date(asOf);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  if (asOf.getUTCDate() < Math.min(estimatedOn.getUTCDate(), lastDay.getUTCDate())) elapsed--;
  return Math.max(0, months - elapsed);
}

/** All monetary outputs are exact IDR minor units. The schedule is evaluated one month at a time. */
export function projectCredit(input: CreditProjectionInput) {
  if (input.currency !== 'IDR') return null;

  const cashPrice = input.cashPriceMinor !== null && input.cashPriceMinor > 0n ? input.cashPriceMinor : null;
  const downPayment = toMinor(input.downPayment);
  const installmentAmount = toMinor(input.monthlyPayment);
  const enteredMonthly = installmentAmount === 0n ? null : installmentAmount;
  const enteredMonths = input.months !== null && Number.isSafeInteger(input.months + 1) && input.months > 0
    ? input.months : null;
  const scheduled = enteredMonths !== null
    ? input.repaymentMinor ?? (enteredMonthly !== null ? enteredMonthly * BigInt(enteredMonths) : null)
    : null;
  const transaction = input.transactionPriceMinor ?? cashPrice;
  const invalid = transaction !== null && (
    transaction <= 0n || (cashPrice !== null && transaction > cashPrice) ||
    (downPayment !== null && (downPayment >= transaction ||
      (scheduled !== null && !coversTransaction(transaction, downPayment, scheduled))))
  );
  const months = invalid ? null : enteredMonths;
  const totalFuturePayments = invalid ? null : scheduled;
  const divisor = months === null ? null : BigInt(months);
  const regularPayment = divisor !== null && scheduled !== null ? scheduled / divisor : null;
  const extraMinorPayments = divisor !== null && scheduled !== null ? scheduled % divisor : 0n;
  const monthlyPayment = invalid ? null : regularPayment === null
    ? enteredMonthly : regularPayment + (extraMinorPayments > 0n ? 1n : 0n);
  const totalPurchaseCost = add(downPayment, totalFuturePayments);
  const additionalCost = subtract(totalPurchaseCost, cashPrice);

  const missingPurchase: string[] = [];
  if (cashPrice === null) missingPurchase.push('purchasePrice');
  if (downPayment === null) missingPurchase.push('downPayment');
  if (enteredMonthly === null && input.repaymentMinor === undefined) missingPurchase.push('monthlyPayment');
  if (enteredMonths === null) missingPurchase.push('installmentMonths');
  if (invalid) missingPurchase.push('validInstallmentTerms');

  const { profile } = input;
  const income = toMinor(profile?.monthlyIncome);
  const livingExpenses = toMinor(profile?.monthlyExpenses);
  const totalExistingDebt = toMinor(profile?.monthlyDebtPayments);
  const savings = toMinor(profile?.monthlySavings);
  const availableCash = toMinor(profile?.availableCash);
  const missingProfile = Object.entries({
    monthlyIncome: income, monthlyExpenses: livingExpenses, monthlyDebtPayments: totalExistingDebt,
    monthlySavings: savings, availableCash,
  }).filter(([, value]) => value === null).map(([field]) => field);

  const asOf = parseDate(input.asOf);

  function dateAt(month: number): string | null {
    if (!asOf || !Number.isSafeInteger(month) || month < 0) return null;

    const target = new Date(asOf);
    const originalDay = target.getUTCDate();

    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() + month);

    if (Number.isNaN(target.valueOf())) return null;

    const endOfMonth = new Date(target);
    endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1, 0);

    target.setUTCDate(Math.min(originalDay, endOfMonth.getUTCDate()));

    return target.toISOString().slice(0, 10);
  }
  const debtEndings = (profile?.existingDebts ?? []).flatMap(debt => {
    const month = remainingTerm(debt.remainingMonths, parseDate(debt.estimateDate), asOf);
    const payment = toMinor(debt.monthlyPayment);
    return month !== null && payment !== null && payment > 0n ? [{ month, monthlyPayment: payment }] : [];
  }).sort((left, right) => left.month - right.month);
  const hasUnknownDebtDuration = totalExistingDebt !== null &&
    totalExistingDebt > debtEndings.reduce((sum, debt) => sum + debt.monthlyPayment, 0n);
  const debtInMonth = (month: number) => subtract(totalExistingDebt,
    debtEndings.reduce((ended, debt) => debt.month < month ? ended + debt.monthlyPayment : ended, 0n));
  const afterLivingAndSavings = subtract(subtract(income, livingExpenses), savings);
  const monthlyBefore = subtract(afterLivingAndSavings, debtInMonth(1));
  const monthlyAfter = subtract(monthlyBefore, monthlyPayment);

  function monthAt(month: number): CreditMonth | null {
    if (!Number.isSafeInteger(month) || month < 0) return null;
    if (month === 0) {
      return {
        month, income: null, livingExpenses: null, existingDebt: null, savings: null, downPayment,
        installment: 0n, disposableIncome: null, cumulativeSpend: downPayment,
        remainingCommitment: totalFuturePayments, difference: subtract(0n, downPayment),
      };
    }
    if (months === null || month > months + 1) return null;

    const existingDebt = debtInMonth(month);
    const elapsed = BigInt(Math.min(month, months));
    const installment = month > months ? 0n
      : regularPayment === null ? null : regularPayment + (elapsed <= extraMinorPayments ? 1n : 0n);
    const paid = regularPayment === null ? null : regularPayment * elapsed +
      (elapsed < extraMinorPayments ? elapsed : extraMinorPayments);
    return {
      month, income, livingExpenses, existingDebt, savings, downPayment: 0n, installment,
      disposableIncome: subtract(subtract(afterLivingAndSavings, existingDebt), installment),
      cumulativeSpend: add(downPayment, paid),
      remainingCommitment: subtract(totalFuturePayments, paid),
      difference: subtract(0n, installment),
    };
  }

  return {
    cashPrice, downPayment, monthlyPayment, months, totalFuturePayments, totalPurchaseCost,
    unevenPayments: extraMinorPayments > 0n,
    additionalCost,
    additionalCostBasisPoints: additionalCost !== null && cashPrice !== null
      ? basisPoints(additionalCost, cashPrice) : null,
    monthlyBefore, monthlyAfter,
    installmentShareBasisPoints: monthlyBefore !== null && monthlyBefore > 0n && monthlyPayment !== null
      ? basisPoints(monthlyPayment, monthlyBefore) : null,
    remainingCash: subtract(availableCash, downPayment),
    missingPurchase, missingProfile, debtEndings, hasUnknownDebtDuration, monthAt, dateAt,
  };
}

export type CreditProjection = NonNullable<ReturnType<typeof projectCredit>>;
