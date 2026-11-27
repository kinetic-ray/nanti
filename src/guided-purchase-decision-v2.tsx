import './decision-v2.css';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRightLeft, CalendarDays, Check, CircleHelp, Clock,
  Gift, Heart, Layers, Shield, Tag, Wrench, Zap,
  AlertTriangle, CheckCircle, XCircle, Package,
  Wallet, Sparkles, Users, Target, Star,
  TrendingUp, RefreshCw, MinusCircle, Frown,
  Search, ShieldCheck, ShieldAlert, Hourglass,
  type LucideIcon,
} from 'lucide-react';
import type { Item, Wishlist } from '../shared/wishlist.js';
import {
  motivationOptions,
  priceMinorToRupiah,
  type MotivationId,
  type FinancialProfileSource,
  type PurchaseTerms,
} from '../shared/decision-engine/index.js';
import { useDecisionEngine } from './use-decision-engine.js';
import { useLocale } from './locale.js';
import { api } from './api.js';
import { ProductMedia } from './visual.js';
import { CreditProjectionPanel } from './credit-projection.js';
import { CreditFinancingFields, financingSelection, initialFinancing } from './credit-financing.js';
import { estimateCredit, parseMonthlyRate, transactionPrice } from '../shared/decision-engine/credit-estimation.js';

const motivationIcons = {
  replacement: ArrowRightLeft,
  functional: Zap,
  comfort_safety: Shield,
  personal_satisfaction: Heart,
  hobby_collection: Layers,
  gift: Gift,
  external_influence: Tag,
  unclear: CircleHelp,
} satisfies Record<MotivationId, LucideIcon>;

const answerIcons: Partial<Record<string, LucideIcon>> = {
  none: MinusCircle,
  insufficient: AlertTriangle,
  adequate: CheckCircle,
  multiple: Layers,
  broken: Wrench,
  problematic: AlertTriangle,
  uncomfortable: Frown,
  unsafe: ShieldAlert,
  good: CheckCircle,
  disruption: AlertTriangle,
  functional: Zap,
  comfort: Heart,
  personal: Heart,
  unknown: CircleHelp,
  daily: CalendarDays,
  weekly: CalendarDays,
  monthly: CalendarDays,
  rarely: Clock,
  efficiency: TrendingUp,
  experience: Sparkles,
  appearance: Star,
  similar: ArrowRightLeft,
  today: Clock,
  recent: CalendarDays,
  months: CalendarDays,
  long_term: Hourglass,
  yes: CheckCircle,
  no: XCircle,
  wait: Clock,
  independent: Target,
  introduced: Users,
  trend: TrendingUp,
  fomo: Users,
  later: Clock,
  free_equivalent: Wallet,
  cheaper: Wallet,
  accepted: Wrench,
  unwilling: ArrowRightLeft,
  now: Zap,
  soon: Clock,
  future: CalendarDays,
  flexible: CalendarDays,
  serious: AlertTriangle,
  discomfort: Frown,
  minor: MinusCircle,
  exact: Target,
  essential: CheckCircle,
  excessive: Layers,
  partial: AlertTriangle,
  mismatch: XCircle,
  verified: ShieldCheck,
  familiar: CheckCircle,
  concern: AlertTriangle,
  active: Zap,
  collection: Layers,
  returning: RefreshCw,
  new: Sparkles,
  distinct: Sparkles,
  confidence: ShieldCheck,
  emotional: Heart,
  reward: Gift,
  achievement: Star,
  effort: TrendingUp,
  enjoyment: Heart,
  planned: CalendarDays,
  wanted: Heart,
  spontaneous: Zap,
  recipient_need: Gift,
  meaningful: Heart,
  preference: Star,
  safety: ShieldCheck,
  both: Shield,
  experienced: ShieldAlert,
  potential: AlertTriangle,
  preventive: ShieldCheck,
  promotion: Tag,
  social: Users,
  scarcity: Package,
  benefit: Zap,
};

const scoreLabels = {
  need: ['Kebutuhan', 'Need'],
  personal_value: ['Nilai pribadi', 'Personal value'],
  urgency: ['Urgensi', 'Urgency'],
  impulse: ['Risiko impulsif', 'Impulse risk'],
  product_fit: ['Kesesuaian produk', 'Product fit'],
  evidence: ['Kelengkapan informasi', 'Completeness of information'],
} as const;

export function GuidedPurchaseDecisionV2({
  list,
  item,
  close,
}: {
  list: Wishlist;
  item: Item;
  close: () => void;
}) {
  const { money, language } = useLocale();
  const copy = (id: string, en: string) => language === 'id' ? id : en;

  const numberFormat = new Intl.NumberFormat(
    language === 'id' ? 'id-ID' : 'en-US',
  );

  const formatAmount = (value: string) =>
    value === '' ? '' : numberFormat.format(Number(value));

  const [profile, setProfile] =
    useState<FinancialProfileSource | null>(null);

  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [primary, setPrimary] = useState<MotivationId | ''>('');
  const [secondary, setSecondary] = useState<MotivationId | ''>('');
  const [method, setMethod] =
    useState<'cash' | 'installment' | 'unknown'>('unknown');

  const [estimate, setEstimate] = useState('');
  const [financing, setFinancing] = useState(initialFinancing);
  const [refresh, setRefresh] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const openedProfileEditor = useRef(false);

  const isIDR = list.currency === 'IDR';
  const totalMinor = item.priceMinor === null
    ? null
    : BigInt(item.priceMinor) * BigInt(item.quantity);

  const fixedPrice = isIDR
    ? priceMinorToRupiah(item.priceMinor, item.quantity)
    : null;

  function amount(value: string): number | null {
    if (!/^\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }

  const price = fixedPrice ?? amount(estimate);
  const roundedCashPrice =
    method === 'cash' && totalMinor !== null && totalMinor % 100n !== 0n;
  const cashPriceMinor = fixedPrice !== null ? totalMinor : price === null ? null : BigInt(price) * 100n;
  const { account, manual } = financingSelection(financing);
  const months = amount(financing.months);
  const downPayment = amount(financing.downPayment);
  const discount = BigInt(financing.discount || '0') * 100n;
  const adjustedPrice = cashPriceMinor === null ? undefined
    : transactionPrice(cashPriceMinor, discount, financing.discountConfirmed) ?? 0n;
  const quote = method === 'installment' && account && !manual && adjustedPrice && months && downPayment !== null
    ? estimateCredit({
      account, priceMinor: adjustedPrice, months, downPaymentMinor: BigInt(downPayment) * 100n,
      zeroInterest: financing.zeroInterest, customRateBps: parseMonthlyRate(financing.rate),
      confirmedFeeBps: amount(financing.feeRate),
      feeOverrideMinor: financing.fee === '' ? null : BigInt(financing.fee) * 100n,
    }) : null;
  const estimateResult = quote && 'lower' in quote ? quote : null;
  const repayment = estimateResult?.upper ?? estimateResult?.lower;
  const estimatedMonthly = repayment ? Number((repayment.monthlyMinor + 99n) / 100n) : null;
  const monthlyPayment = manual ? amount(financing.actual)
    : Number.isSafeInteger(estimatedMonthly) ? estimatedMonthly : null;

  const purchase: PurchaseTerms =
    !isIDR || price === null || method === 'unknown'
      ? { method: 'unknown', price }
      : method === 'cash'
        ? { method: 'cash', price }
        : {
            method: 'installment',
            price,
            downPayment,
            monthlyPayment,
            months,
            transactionPriceMinor: adjustedPrice,
            repaymentMinor: repayment?.repaymentMinor,
            estimated: !manual,
          };

  const engine = useDecisionEngine({
    profile: isIDR && !loading ? profile : null,
    purchase,
    credit: isIDR && method === 'installment' ? {
      currency: list.currency,
      cashPriceMinor,
      transactionPriceMinor: adjustedPrice,
      repaymentMinor: repayment?.repaymentMinor,
      downPayment,
      monthlyPayment,
      months,
      asOf: new Date().toLocaleDateString('sv-SE'),
    } : undefined,
    lowerRepaymentMinor: estimateResult?.upper ? estimateResult.lower.repaymentMinor : undefined,
  });

  const { next, assessment, explanation, creditProjection, lowerCreditProjection } = engine;
  const invalidFinancing = creditProjection?.missingPurchase.includes('validInstallmentTerms') ?? false;
  const financingMessage = adjustedPrice === 0n && financing.discountConfirmed && discount > 0n
    ? copy('Potongan harus lebih kecil dari harga barang.', 'The discount must be lower than the item price.')
    : quote?.kind === 'invalid_down_payment' || (adjustedPrice && downPayment !== null && BigInt(downPayment) * 100n >= adjustedPrice)
      ? copy('Uang muka harus lebih kecil dari harga transaksi.', 'The down payment must be lower than the transaction price.')
      : invalidFinancing
        ? copy('Total cicilan belum menutup harga barang. Periksa kembali nominal cicilan atau masukkan potongan promo.',
          'The installments do not cover the item price. Check the installment amount or enter a promotional discount.')
        : quote?.kind === 'below_minimum'
          ? copy(`Minimum transaksi untuk tenor ini adalah ${money(quote.minimumMinor.toString(), list.currency)}.`,
            `The minimum transaction for this term is ${money(quote.minimumMinor.toString(), list.currency)}.`)
          : quote?.kind === 'manual_required'
            ? copy('Masukkan cicilan aktual atau pilih bunga simulasi di bawah Promo dan biaya.',
              'Enter the actual installment or choose a simulation rate under Promotions and fees.')
            : null;

  const missingLabels: Record<string, [string, string]> = {
    monthlyIncome: ['Penghasilan bulanan', 'Monthly income'],
    monthlyExpenses: ['Kebutuhan rutin', 'Monthly expenses'],
    monthlyDebtPayments: ['Kewajiban cicilan', 'Debt payments'],
    monthlySavings: ['Target tabungan', 'Monthly savings'],
    availableCash: ['Uang tersedia sekarang', 'Available cash'],
    protectedReserve: ['Dana cadangan', 'Emergency reserve'],
    incomeStability: ['Stabilitas penghasilan', 'Income stability'],
    purchasePrice: ['Harga pembelian', 'Purchase price'],
    paymentMethod: ['Rencana pembayaran', 'Payment method'],
    downPayment: ['Uang muka (isi 0 jika tanpa DP)', 'Down payment (enter 0 if none)'],
    monthlyPayment: ['Nominal cicilan per bulan', 'Monthly installment'],
    installmentMonths: ['Tenor cicilan', 'Installment duration'],
    validInstallmentTerms: ['Nominal dan tenor yang valid', 'Valid installment terms'],
  };

  const purchaseFields = new Set([
    'purchasePrice',
    'paymentMethod',
    'downPayment',
    'monthlyPayment',
    'installmentMonths',
    'validInstallmentTerms',
  ]);

  const missingFields = engine.financial?.missingFields ?? [];

  const missingProfile = (engine.hasFinancialProfile ? missingFields : Object.keys(missingLabels))
    .filter(field => !purchaseFields.has(field));


  const missingLabel = (field: string) =>
    missingLabels[field]?.[language === 'id' ? 0 : 1] ?? field;

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setProfileError(false);

    void api<FinancialProfileSource>(
      '/account/financial-profile',
      { signal: controller.signal },
    )
      .then(value => {
        if (!controller.signal.aborted) setProfile(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setProfile(null);
          setProfileError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    heading.current?.focus();
  }, [engine.answeredCount, next.status]);

  useEffect(() => {
    const refreshAfterEdit = () => {
      if (!openedProfileEditor.current || document.visibilityState !== 'visible') return;
      openedProfileEditor.current = false;
      setRefresh(value => value + 1);
    };
    window.addEventListener('focus', refreshAfterEdit);
    document.addEventListener('visibilitychange', refreshAfterEdit);
    return () => {
      window.removeEventListener('focus', refreshAfterEdit);
      document.removeEventListener('visibilitychange', refreshAfterEdit);
    };
  }, []);

  function restart() {
    engine.restart();
    setPrimary('');
    setSecondary('');
    setMethod('unknown');
    setEstimate('');
    setFinancing(initialFinancing);
  }

  function returnToProduct() {
    const dialogTitle = heading.current?.closest('dialog')?.querySelector('h2');
    close();
    requestAnimationFrame(() => dialogTitle?.focus());
  }

  return (
    <div className="guided-decision decision-v2">
      <div className="decision-v2-product">
        <ProductMedia item={item} listId={list.id} />
        <div className="decision-v2-product-copy">
          <strong>{item.name}</strong>
          <span>
            {totalMinor === null
              ? copy('Harga belum tersedia', 'Price unavailable')
              : money(totalMinor.toString(), list.currency)}
          </span>
        </div>
      </div>

      {next.status === 'motivation_required' && (
        <section className="decision-v2-section">
          <p className="decision-v2-step">
            {copy('Mulai dari alasanmu', 'Start with your reason')}
          </p>

          <h3 ref={heading} tabIndex={-1}>
            {copy('Apa alasan utama kamu ingin membeli barang ini?', 'What’s your main reason for buying this?')}
          </h3>

          <div className="decision-v2-options decision-v2-motivations" lang="id">
            {motivationOptions.map(option => {
              const MotivationIcon = motivationIcons[option.id];
              return (
                <button
                  type="button"
                  key={option.id}
                  aria-pressed={primary === option.id}
                  className="decision-v2-option"
                  onClick={() => {
                    setPrimary(option.id);
                    setSecondary('');
                  }}
                >
                  <span className="decision-v2-icon"><MotivationIcon aria-hidden="true" /></span>
                  <span className="decision-v2-option-copy">
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </span>
                  <Check className="decision-v2-selected" aria-hidden="true" />
                </button>
              );
            })}
          </div>

          {primary && (
            <label className="decision-v2-field">
              {copy('Alasan pendukung (opsional)', 'Supporting reason (optional)')}
              <select
                value={secondary}
                onChange={event =>
                  setSecondary(
                    event.target.value as MotivationId | '',
                  )
                }
              >
                <option value="">{copy('Tidak ada', 'None')}</option>
                {motivationOptions
                  .filter(option =>
                    option.id !== primary &&
                    option.id !== 'unclear',
                  )
                  .map(option => (
                    <option key={option.id} value={option.id} lang="id">
                      {option.label}
                    </option>
                  ))}
              </select>
            </label>
          )}

          <button
            type="button"
            className="decision-v2-primary"
            disabled={!primary}
            onClick={() => {
              if (!primary) return;
              engine.selectMotivation(
                secondary
                  ? { primary, secondary }
                  : { primary },
              );
            }}
          >
            {copy('Lanjut', 'Continue')}
          </button>
          <button type="button" className="decision-v2-back" onClick={returnToProduct}>
            <ArrowLeft aria-hidden="true" />
            {copy('Kembali ke produk', 'Back to product')}
          </button>
        </section>
      )}

      {next.status === 'question' && (
        <section className="decision-v2-section">
          <div className="decision-v2-question-meta">
            <span className="decision-v2-step">{copy('Pertimbangan pembelian', 'Purchase considerations')}</span>
            <span>{copy('Pertanyaan', 'Question')} {next.answeredCount}</span>
          </div>

          <h3 ref={heading} tabIndex={-1} lang="id">
            {next.question.prompt}
          </h3>

          <div className="decision-v2-options" lang="id">
            {next.question.options.map(option => {
              const AnswerIcon = answerIcons[option.id] ?? CircleHelp;
              return (
                <button
                  type="button"
                  className="decision-v2-option"
                  key={option.id}
                  onClick={() => engine.answer(next.question.id, option.id)}
                >
                  <span className="decision-v2-icon" aria-hidden="true">
                    <AnswerIcon />
                  </span>
                  <span className="decision-v2-option-copy">{option.label}</span>
                </button>
              );
            })}
          </div>

          <button type="button" className="decision-v2-back" onClick={engine.back}>
            <ArrowLeft aria-hidden="true" />
            {copy('Kembali', 'Back')}
          </button>
        </section>
      )}

      {assessment && explanation && (
        <section className="decision-v2-section decision-v2-assessment">
          <section className="decision-v2-group decision-v2-recommendation">
            <p className="decision-v2-step">{copy('Hasil pertimbangan', 'Purchase assessment')}</p>
            <h3 ref={heading} tabIndex={-1} lang="id">{explanation.title}</h3>
            <h4>{copy('Saran untuk kamu', 'What you can do next')}</h4>
            <p lang="id">{explanation.action}</p>

            {engine.financial && !loading && !profileError && (() => {
              const f = engine.financial;

              const rp = (value: number) =>
                money(
                  (BigInt(value) * 100n).toString(),
                  list.currency,
                );

              const l = (id: string, en: string) =>
                language === 'id' ? id : en;

              const insights: string[] = [];

              if (f.monthlySurplus !== null && f.monthlySurplus < 0) {
                insights.push(l(
                  `Pengeluaran dan alokasi bulananmu melebihi penghasilan sebesar ${rp(Math.abs(f.monthlySurplus))}.`,
                  `Your monthly expenses and allocations exceed your income by ${rp(Math.abs(f.monthlySurplus))}.`,
                ));
              }

              if (f.remainingCash !== null && f.remainingCash < 0) {
                insights.push(l(
                  `Kamu masih membutuhkan ${rp(Math.abs(f.remainingCash))} untuk memenuhi pembayaran awal.`,
                  `You need another ${rp(Math.abs(f.remainingCash))} to cover the initial payment.`,
                ));
              }

              if (
                method === 'installment' &&
                f.remainingMonthlySurplus !== null &&
                f.remainingMonthlySurplus < 0
              ) {
                const shortfall = rp(Math.abs(f.remainingMonthlySurplus));
                insights.push(f.estimated
                  ? l(`Simulasi ini menunjukkan perkiraan kekurangan anggaran bulanan sebesar ${shortfall}.`,
                    `This simulation shows a projected monthly budget shortfall of ${shortfall}.`)
                  : l(`Cicilan ini membuat anggaran bulananmu kurang ${shortfall}.`,
                    `This installment creates a monthly budget shortfall of ${shortfall}.`));
              }

              if (
                !f.estimated && f.status === 'affordable' &&
                f.remainingCash !== null &&
                f.remainingCash > 0
              ) {
                insights.push(l(
                  'Berdasarkan profilmu, pembayaran ini masih menyisakan dana tersedia.',
                  'Based on your profile, this payment leaves some funds available.',
                ));
              }

              return insights.length > 0 ? (
                <ul className="decision-reasons">
                  {insights.map(insight => (
                    <li key={insight}>{insight}</li>
                  ))}
                </ul>
              ) : null;
            })()}
          </section>

          {loading ? (
            <p role="status" className="hint">
              {copy('Memeriksa profil finansialmu…', 'Checking your financial profile…')}
            </p>
          ) : profileError ? (
            <div className="decision-v2-group">
              <p role="alert">
                {copy('Profil finansial belum bisa dimuat. Hasil pertimbangan tetap tersedia.', 'Your financial profile could not be loaded. Your purchase assessment is still available.')}
              </p>
              <button
                type="button"
                onClick={() => setRefresh(value => value + 1)}
              >
                {copy('Coba lagi', 'Try again')}
              </button>
            </div>
          ) : null}

          {isIDR && (
            <section className="decision-v2-group decision-v2-payment">
              <h4>{copy('Rencana pembayaran', 'Payment plan')}</h4>
              <div className="decision-v2-payment-fields" data-installment={method === 'installment'}>

              {fixedPrice === null && (
                <label className="decision-v2-field">
                  {copy('Perkiraan harga (Rp)', 'Estimated price (Rp)')}
                  <input
                    inputMode="numeric"
                    value={formatAmount(estimate)}
                    onChange={event =>
                      setEstimate(
                        event.target.value.replace(/\D/g, '').slice(0, 12),
                      )
                    }
                  />
                </label>
              )}

              <label className="decision-v2-field">
                {copy('Rencana pembayaran', 'Payment method')}
                <select
                  value={method}
                  onChange={event =>
                    setMethod(
                      event.target.value as typeof method,
                    )
                  }
                >
                  <option value="unknown">
                    {copy('Belum menentukan', 'Undecided')}
                  </option>
                  <option value="cash">{copy('Tunai', 'Cash')}</option>
                  <option value="installment">{copy('Cicilan', 'Installments')}</option>
                </select>
              </label>

              {method === 'installment' && (
                <CreditFinancingFields draft={financing} setDraft={setFinancing}
                  message={financingMessage} invalid={invalidFinancing} formatAmount={formatAmount} />
              )}
              </div>

              {creditProjection?.monthlyPayment != null && creditProjection.months !== null && creditProjection.downPayment !== null && (
                <CreditProjectionPanel projection={creditProjection} lowerProjection={lowerCreditProjection}
                  estimatedPrice={fixedPrice === null} estimate={estimateResult}
                  assumedFlat={account?.method === 'assumed_flat' || account?.method === 'custom_flat'} />
              )}

              {roundedCashPrice && fixedPrice !== null && (
                <p className="hint">
                  {copy('Perhitungan tunai membulatkan harga ke atas ke Rupiah penuh.', 'The cash calculation rounds the price up to the nearest whole rupiah.')}
                </p>
              )}

              {method === 'cash' && engine.hasFinancialProfile && engine.financial && (
                <dl className="decision-v2-financial-impact decision-v2-cash-metrics" aria-live="polite">
                  {[
                    {
                      label: language === 'id'
                        ? 'Uang bebas per bulan'
                        : 'Monthly disposable income',
                      value: engine.financial.monthlySurplus,
                    },
                    {
                      label: fixedPrice === null || roundedCashPrice
                        ? copy('Perkiraan total pembayaran', 'Estimated total payment')
                        : copy('Total pembayaran', 'Total payment'),
                      value: engine.financial.totalPurchaseCost,
                    },
                    {
                      label: language === 'id'
                        ? 'Sisa uang tersedia'
                        : 'Remaining available cash',
                      value: engine.financial.remainingCash,
                    },
                  ].filter(metric => metric.value !== null)
                    .map(metric => (
                      <div
                        className="decision-v2-financial-metric"
                        key={metric.label}
                      >
                        <dt>{metric.label}</dt>
                        <dd
                          data-negative={metric.value! < 0}
                        >
                          {money(
                            (BigInt(metric.value!) * 100n).toString(),
                            list.currency,
                          )}
                        </dd>
                      </div>
                    ))}
                </dl>
              )}
            </section>
          )}

          {!loading && !profileError && isIDR && (
            <section className="decision-v2-profile-status">
              {missingProfile.length === 0 ? (
                <>
                  <h4 className="decision-v2-profile-complete">
                    <ShieldCheck size={19} aria-hidden="true" />
                    {copy('Data Profil Finansial Lengkap', 'Financial Profile Complete')}
                  </h4>
                </>
              ) : (
                <>
                  <h4 className="decision-v2-profile-incomplete">
                    {copy('Profil finansial belum lengkap', 'Financial profile incomplete')}
                  </h4>
                  <a href="/account?section=financial-profile" target="_blank" rel="noopener noreferrer"
                    onClick={() => { openedProfileEditor.current = true; }}>
                    {copy('Perbarui profil', 'Update profile')}
                  </a>
                </>
              )}
              <button className="decision-v2-text-action" type="button" onClick={() => setRefresh(value => value + 1)}>
                {copy('Perbarui data', 'Refresh data')}
              </button>
            </section>
          )}

          {!isIDR && (
            <p className="hint">
              {language === 'id'
                ? 'Penilaian finansial saat ini tersedia untuk pembelian dalam Rupiah.'
                : 'Financial assessment is currently available for purchases in Indonesian rupiah.'}
            </p>
          )}

          <details className="decision-v2-details">
            <summary>{copy('Rincian penilaian', 'Assessment details')}</summary>

            {explanation.financialNotice && <p className="hint" lang="id">{explanation.financialNotice}</p>}
            {!loading && !profileError && isIDR && missingProfile.length > 0 && <p className="hint">
              {copy('Data profil yang belum tersedia', 'Missing profile information')}{' '}
              <span>{missingProfile.map(missingLabel).join(', ')}</span>
            </p>}
            <ul className="decision-reasons" lang="id">
              {explanation.reasons.map(reason => <li key={reason}>{reason}</li>)}
              {explanation.financialReasons.length > 0 &&
                !(engine.financial?.estimated && engine.financial.status === 'affordable') &&
                explanation.financialReasons.map(reason => <li key={reason}>{reason}</li>)}
            </ul>
            {estimateResult?.upper && <p className="hint">
              {copy('Kesiapan disimulasikan dengan cicilan tertinggi dalam rentang.', 'Readiness uses the upper installment estimate.')}
            </p>}

            {Object.entries(assessment.behavioral.scores)
              .map(([key, score]) => (
                <div className="decision-v2-score" key={key}>
                  <span>
                    {scoreLabels[key as keyof typeof scoreLabels][language === 'id' ? 0 : 1]}
                  </span>
                  <strong>
                    {score === null
                      ? copy('Belum dinilai', 'Not assessed')
                      : `${score.toLocaleString(language === 'id' ? 'id-ID' : 'en-US', {
                        minimumFractionDigits: 1, maximumFractionDigits: 1,
                      })} / 5`}
                  </strong>
                  {score !== null && (
                    <progress aria-hidden="true" value={score} max={5} />
                  )}
                </div>
              ))}
          </details>

          <div className="decision-v2-actions">
            <button type="button" className="decision-v2-primary" onClick={returnToProduct}>
              {copy('Selesai', 'Done')}
            </button>
            <button type="button" onClick={engine.back}>
              {copy('Kembali ke pertanyaan', 'Back to questions')}
            </button>
            <button type="button" onClick={restart}>
              {copy('Ulangi pertimbangan', 'Start over')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
