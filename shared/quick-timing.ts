import { getPurchaseQuote } from './purchase-plan.js';
import type { Item } from './wishlist.js';

export const quickTimingVersion = '2.0.0';
export const readinessAnswers = ['safe', 'tight', 'unsure'] as const;
export type ReadinessAnswer = typeof readinessAnswers[number];
export type QuickTimingInput = { mode: 'quick'; answer: ReadinessAnswer };

export function readinessSelection(items: Item[]) {
  return JSON.stringify(items.map(({ id, priceMinor, quantity }) => [id, priceMinor, quantity] as const)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

export function checkReadiness(answer: ReadinessAnswer, items: Item[]) {
  return { version: quickTimingVersion, answer, quote: getPurchaseQuote(items) };
}

export type QuickTimingResult = ReturnType<typeof checkReadiness>;
