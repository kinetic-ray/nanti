export type PurchaseFinanceContext = {
  cashMinor: string | null;
  essentialExpensesMinor: string | null;
  setAsideMinor: string | null;
  nextIncomeDate: string | null;
  nextIncomeMinor: string | null;
  canWait: boolean | null;
};

export type PurchaseImpact = {
  cashAfterPurchaseMinor: bigint | null;
  cashAfterKnownCostsMinor: bigint | null;
  knownPriceShortfallMinor: bigint | null;
  missing: Array<'price' | 'cash' | 'nextIncomeDate' | 'essentialExpenses' | 'setAside'>;
  canEstimateCashAfterCosts: boolean;
};

const amount = (value: string | null) => value === null ? null : BigInt(value);

export function analyzePurchaseImpact(priceMinor: bigint | null, context: PurchaseFinanceContext): PurchaseImpact {
  const cash = amount(context.cashMinor);
  const expenses = amount(context.essentialExpensesMinor);
  const setAside = amount(context.setAsideMinor);
  const cashAfterPurchaseMinor = cash === null || priceMinor === null ? null : cash - priceMinor;
  const canEstimateCashAfterCosts = cash !== null && priceMinor !== null && expenses !== null && setAside !== null;
  const cashAfterKnownCostsMinor = cash === null || priceMinor === null
    ? null
    : cash - priceMinor - (expenses ?? 0n) - (setAside ?? 0n);
  const knownPriceShortfallMinor = cash === null || priceMinor === null || priceMinor <= cash
    ? null
    : priceMinor - cash;

  const missing: PurchaseImpact['missing'] = [];
  if (priceMinor === null) missing.push('price');
  if (cash === null) missing.push('cash');
  if (context.nextIncomeDate === null) missing.push('nextIncomeDate');
  if (expenses === null) missing.push('essentialExpenses');
  if (setAside === null) missing.push('setAside');

  return { cashAfterPurchaseMinor, cashAfterKnownCostsMinor, knownPriceShortfallMinor, missing, canEstimateCashAfterCosts };
}
