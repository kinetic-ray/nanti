import type { Item } from './wishlist.js';

export type PlanLine = { id: string; included: boolean; optional: boolean; group?: number };
export type PurchasePlan = PlanLine[];
export type PurchaseQuote = { source: 'saved' | 'estimate' | 'incomplete'; subtotalMinor: string; missingPrices: number };

export function includedProducts(items: Item[], plan: PurchasePlan) {
  const excluded = new Set(plan.filter(({ included }) => !included).map(({ id }) => id));
  return items.filter(({ id }) => !excluded.has(id));
}

export function getPurchaseQuote(items: Item[], estimate?: string): PurchaseQuote {
  let known = 0n;
  let missingPrices = 0;
  for (const { priceMinor, quantity } of items) {
    if (priceMinor === null) missingPrices++;
    else known += BigInt(priceMinor) * BigInt(quantity);
  }
  return {
    subtotalMinor: known.toString(), missingPrices,
    source: items.length && !missingPrices ? 'saved' : estimate === undefined ? 'incomplete' : 'estimate',
  };
}
