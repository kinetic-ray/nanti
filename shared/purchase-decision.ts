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
