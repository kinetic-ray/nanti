import { describe, expect, it } from 'vitest';
import { creditProviders } from '../shared/decision-engine/credit-rate-registry.js';
import { estimateCredit, parseMonthlyRate, transactionPrice } from '../shared/decision-engine/credit-estimation.js';

const base = { priceMinor: 100_000_000n, downPaymentMinor: 0n, months: 3 };
const goPay = creditProviders.find(provider => provider.id === 'gopay')!.accounts[0];
const kredivo = creditProviders.find(provider => provider.id === 'kredivo')!.accounts;
const shopee = creditProviders.find(provider => provider.id === 'shopee')!.accounts;
const indodana = creditProviders.find(provider => provider.id === 'indodana')!.accounts[0];
const other = creditProviders.find(provider => provider.id === 'other')!.accounts[0];

describe('provider financing estimates', () => {
  it('matches the GoPay flat-cost example and keeps the exact repayment total', () => {
    const quote = estimateCredit({ ...base, account: goPay });
    expect(quote).toMatchObject({ kind: 'starting_from', upper: null, lower: {
      financingCostMinor: 6_000_000n, repaymentMinor: 106_000_000n, monthlyMinor: 35_333_334n,
    } });
  });

  it('enforces the published minimum and supported term', () => {
    expect(estimateCredit({ ...base, account: goPay, priceMinor: 5_999_999n })).toEqual({ kind: 'below_minimum', minimumMinor: 6_000_000n });
    expect(estimateCredit({ ...base, account: goPay, months: 9 })).toEqual({ kind: 'unsupported' });
    expect(kredivo.find(account => account.id === 'premium')?.terms.map(term => term.months)).toEqual([1, 3, 6, 9, 12]);
  });

  it('computes range endpoints independently and applies down payment to principal', () => {
    const quote = estimateCredit({ ...base, account: shopee[1]!, downPaymentMinor: 20_000_000n });
    expect(quote).toMatchObject({ kind: 'range', lower: { repaymentMinor: 87_080_000n }, upper: { repaymentMinor: 89_480_000n } });
    expect(quote).toMatchObject({ feeUnverified: true });
  });

  it('requires an explicit Shopee promotion and preserves ordinary one-month zero interest', () => {
    expect(estimateCredit({ ...base, account: shopee[0] })).toMatchObject({ lower: { financingCostMinor: 11_850_000n } });
    expect(estimateCredit({ ...base, account: shopee[0], zeroInterest: true })).toMatchObject({ lower: { financingCostMinor: 0n } });
    expect(estimateCredit({ ...base, account: shopee[0], months: 1 })).toMatchObject({ lower: { financingCostMinor: 0n } });
  });

  it('applies the Kredivo Basic fee and models Premium as a range', () => {
    expect(estimateCredit({ ...base, account: kredivo[1]! })).toMatchObject({ lower: { feeMinor: 1_000_000n, repaymentMinor: 113_000_000n } });
    expect(estimateCredit({ ...base, account: kredivo[2]! })).toMatchObject({
      kind: 'range', lower: { financingCostMinor: 5_970_000n }, upper: { financingCostMinor: 11_970_000n },
    });
  });

  it('models Indodana’s two published fees until the user confirms one', () => {
    expect(estimateCredit({ ...base, account: indodana, months: 9 })).toEqual({ kind: 'unsupported' });
    expect(estimateCredit({ ...base, account: indodana })).toMatchObject({
      kind: 'range', feeConflict: true, lower: { feeMinor: 1_000_000n }, upper: { feeMinor: 3_000_000n },
    });
    expect(estimateCredit({ ...base, account: indodana, confirmedFeeBps: 300 })).toMatchObject({
      kind: 'fixed', feeConflict: false, lower: { feeMinor: 3_000_000n },
    });
    expect(estimateCredit({ ...base, account: indodana, months: 1, priceMinor: 1_000_000n }))
      .toMatchObject({ kind: 'fixed', lower: { feeMinor: 100_000n, financingCostMinor: 0n } });
  });

  it('uses manual mode for Akulaku and requires an explicit custom or zero rate for Other', () => {
    const akulaku = creditProviders.find(provider => provider.id === 'akulaku')!.accounts[0];
    expect(estimateCredit({ ...base, account: akulaku })).toEqual({ kind: 'manual_required' });
    expect(estimateCredit({ ...base, account: other })).toEqual({ kind: 'manual_required' });
    expect(estimateCredit({ ...base, account: other, customRateBps: parseMonthlyRate('2,63') })).toMatchObject({ lower: { financingCostMinor: 7_890_000n } });
    expect(estimateCredit({ ...base, account: other, zeroInterest: true })).toMatchObject({ lower: { financingCostMinor: 0n } });
    expect(parseMonthlyRate('0')).toBe(0);
    expect(parseMonthlyRate('2.635')).toBeNull();
  });

  it('applies only confirmed discounts and rejects a discount equal to or above price', () => {
    expect(transactionPrice(200_000_000n, 199_998_800n, false)).toBe(200_000_000n);
    expect(transactionPrice(200_000_000n, 199_998_800n, true)).toBe(1_200n);
    expect(transactionPrice(200_000_000n, 200_000_000n, true)).toBeNull();
  });
});
