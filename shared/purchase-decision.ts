import { evaluateScreening } from './screening.js';
import type { ScreeningAnswers } from './screening.js';

export type DecisionFinances = {
  priceMinor: bigint;
  cashMinor: bigint;
  billsMinor: bigint;
  setAsideMinor: bigint;
};

export function assessPurchase(answers: ScreeningAnswers, finances: DecisionFinances) {
  const screening = evaluateScreening(answers, null, new Date().toISOString().slice(0, 10));
  const remaining = finances.cashMinor - finances.billsMinor - finances.setAsideMinor;
  const safeToSpend = remaining > 0n ? remaining : 0n;
  const gap = finances.priceMinor > safeToSpend ? finances.priceMinor - safeToSpend : 0n;
  const share = safeToSpend > 0n ? Number(finances.priceMinor * 100n / safeToSpend) : null;
  const financiallyReady = finances.priceMinor > 0n && gap === 0n;
  const financialRisk = !financiallyReady ? 'shortfall' : share !== null && share > 50 ? 'high' : share !== null && share > 25 ? 'moderate' : 'low';
  const incomplete = screening.unanswered.length > 0;
  const decision = incomplete ? 'uncertain'
    : screening.outcome === 'red' ? 'pause'
    : !financiallyReady ? 'save'
    : financialRisk === 'high' ? 'alternative'
    : screening.outcome === 'yellow' ? 'reflect' : 'consider';
  return { screening, safeToSpend, gap, share, financialRisk, decision } as const;
}

// Match grouping only for the selected locale; do not guess mixed separators.
export function parseBudgetAmount(raw: string, language: 'id' | 'en'): bigint | null {
  const value = raw.trim();
  const match = language === 'id'
    ? /^(\d+|\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(value)
    : /^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(value);
  const whole = match?.[1]?.replace(/[.,]/g, '');
  if (!whole || whole.length > 15) return null;
  const fraction = match?.[2] ?? '';
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
