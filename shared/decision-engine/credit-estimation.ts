import type { CreditAccount } from './credit-rate-registry.js';

type EstimateInput = {
  account: CreditAccount;
  priceMinor: bigint;
  downPaymentMinor: bigint;
  months: number;
  zeroInterest?: boolean;
  customRateBps?: number | null;
  confirmedFeeBps?: number | null;
  feeOverrideMinor?: bigint | null;
};

type EstimateBound = {
  financingCostMinor: bigint;
  feeMinor: bigint;
  repaymentMinor: bigint;
  monthlyMinor: bigint;
};

export type CreditEstimate =
  | { kind: 'fixed' | 'range' | 'starting_from'; lower: EstimateBound; upper: EstimateBound | null; feeUnverified: boolean; feeConflict: boolean }
  | { kind: 'below_minimum'; minimumMinor: bigint }
  | { kind: 'unsupported' | 'manual_required' | 'invalid_down_payment' };

export function transactionPrice(price: bigint, discount: bigint, confirmed: boolean): bigint | null {
  const adjusted = price - (confirmed ? discount : 0n);
  return price > 0n && discount >= 0n && adjusted > 0n ? adjusted : null;
}

export function coversTransaction(transactionMinor: bigint, downPaymentMinor: bigint, repaymentMinor: bigint): boolean {
  return transactionMinor > 0n && downPaymentMinor >= 0n && downPaymentMinor < transactionMinor &&
    repaymentMinor > 0n && downPaymentMinor + repaymentMinor >= transactionMinor;
}

export function parseMonthlyRate(value: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(bps) ? bps : null;
}

function applyBasisPoints(base: bigint, basisPoints: number, months = 1n): bigint {
  return (base * BigInt(basisPoints) * months + 5_000n) / 10_000n;
}

export function estimateCredit(input: EstimateInput): CreditEstimate {
  const { account, priceMinor, downPaymentMinor, months } = input;
  if (account.method === 'manual') return { kind: 'manual_required' };
  if (!Number.isSafeInteger(months) || months <= 0) return { kind: 'unsupported' };
  const term = account.terms.find(candidate => candidate.months === months);
  if (account.method !== 'custom_flat' && !term) return { kind: 'unsupported' };
  if (term?.minimumMinor != null && priceMinor < term.minimumMinor) {
    return { kind: 'below_minimum', minimumMinor: term.minimumMinor };
  }
  if (downPaymentMinor < 0n || downPaymentMinor >= priceMinor) return { kind: 'invalid_down_payment' };

  const promotional = input.zeroInterest && account.zeroInterestOption;
  const rate = promotional ? { type: 'fixed', bps: 0 } as const : term?.rate;
  const custom = input.customRateBps;
  if (!rate && (custom == null || !Number.isSafeInteger(custom) || custom <= 0)) {
    return { kind: 'manual_required' };
  }
  const rates = rate?.type === 'range' ? rate.bps : [rate?.bps ?? custom!];
  const fee = term?.fee;
  const override = input.feeOverrideMinor;
  let fees: readonly bigint[] = [0n];
  if (override != null && override >= 0n) {
    fees = [override];
  } else if (fee?.type === 'fixed') {
    fees = [fee.minor];
  } else if (fee?.type === 'percent' || fee?.type === 'conflicting') {
    const confirmed = input.confirmedFeeBps;
    const feeRates = confirmed != null && fee.bps.includes(confirmed) ? [confirmed] : fee.bps;
    fees = feeRates.map(bps => {
      const computed = applyBasisPoints(priceMinor, bps);
      return computed < fee.minimumMinor ? fee.minimumMinor : computed;
    });
  }

  const principal = priceMinor - downPaymentMinor;
  const installments = BigInt(months);
  const calculate = (bps: number, feeMinor: bigint): EstimateBound => {
    const financingCostMinor = applyBasisPoints(principal, bps, installments);
    const repaymentMinor = principal + financingCostMinor + feeMinor;
    return {
      financingCostMinor, feeMinor, repaymentMinor,
      monthlyMinor: (repaymentMinor + installments - 1n) / installments,
    };
  };
  const lower = calculate(Math.min(...rates), fees.reduce((a, b) => a < b ? a : b));
  const upper = calculate(Math.max(...rates), fees.reduce((a, b) => a > b ? a : b));
  const startingFrom = rate?.type === 'starting_from';
  const hasRange = !startingFrom && upper.repaymentMinor !== lower.repaymentMinor;
  return {
    kind: startingFrom ? 'starting_from' : hasRange ? 'range' : 'fixed',
    lower,
    upper: hasRange ? upper : null,
    feeConflict: fee?.type === 'conflicting' && (override == null || override < 0n) &&
      (input.confirmedFeeBps == null || !fee.bps.includes(input.confirmedFeeBps)),
    feeUnverified: (override == null || override < 0n) &&
      (!fee || fee.type === 'unknown' || (fee.type === 'fixed' && !!fee.exceptions)),
  };
}
