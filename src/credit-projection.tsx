import type { CreditEstimate } from '../shared/decision-engine/credit-estimation.js';
import type { CreditProjection } from '../shared/decision-engine/credit-projection.js';
import { useLocale } from './locale.js';

type Estimate = Extract<CreditEstimate, { lower: unknown }>;

export function CreditProjectionPanel({ projection, lowerProjection, estimatedPrice, estimate, assumedFlat }: {
  projection: CreditProjection;
  lowerProjection: CreditProjection | null;
  estimatedPrice: boolean;
  estimate: Estimate | null;
  assumedFlat: boolean;
}) {
  const { language, locale, number } = useLocale();
  const copy = (id: string, en: string) => language === 'id' ? id : en;
  const unset = copy('Belum diketahui', 'Unknown');
  const startingFrom = estimate?.kind === 'starting_from';

  const money = (value: bigint, signed = false) => {
    const remainder = value % 100n;
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency', currency: 'IDR', minimumFractionDigits: remainder ? 2 : 0,
      signDisplay: signed ? 'exceptZero' : 'auto',
    });
    const fraction = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }).format(remainder < 0n ? -remainder : remainder);
    const whole = value / 100n;
    // Intl cannot take a fractional bigint, so replace its fraction from the exact minor units.
    const displayWhole = whole === 0n && value !== 0n ? (value < 0n ? -1 : 1) : whole;
    return formatter.formatToParts(displayWhole).map(part => {
      if (part.type === 'fraction') return fraction;
      if (part.type === 'integer' && whole === 0n) return number(0);
      return part.value;
    }).join('');
  };
  const formatRange = (
    first: bigint | null,
    second: bigint | null | undefined,
    options: { signed?: boolean; minimum?: boolean } = {},
  ) => {
    if (first === null) return unset;
    const amount = (value: bigint) => <span className={options.signed
      ? value > 0n ? 'credit-difference-positive' : value < 0n ? 'credit-difference-negative' : undefined
      : undefined}>{money(value, options.signed)}</span>;
    if (second != null && second !== first) {
      const [low, high] = first <= second ? [first, second] : [second, first];
      return <>{amount(low)} – {amount(high)}</>;
    }
    return <>{options.minimum && copy('Mulai dari ', 'From ')}{amount(first)}</>;
  };
  const monthlyTitle = estimate
    ? copy('Estimasi cicilan per bulan', 'Estimated monthly installment')
    : copy('Cicilan aktual per bulan', 'Actual monthly installment');
  const notes = [
    assumedFlat && estimate ? copy('Simulasi menggunakan bunga flat.', 'Simulation assumes a flat rate.') : null,
    startingFrom ? copy(
      'Angka menggunakan tarif minimum. Cicilan aktual bisa lebih tinggi.',
      'Figures use the published minimum rate. Actual installments can be higher.',
    ) : null,
    estimate?.feeUnverified ? copy(
      'Biaya tambahan yang belum dikonfirmasi tidak termasuk.',
      'Unconfirmed additional fees are excluded.',
    ) : null,
    estimate?.feeConflict ? copy(
      'Referensi Indodana mencantumkan biaya admin 1% dan 3%. Konfirmasi biaya pada penawaranmu.',
      'Indodana’s references list both 1% and 3% administration fees. Confirm the fee in your offer.',
    ) : null,
    projection.unevenPayments || lowerProjection?.unevenPayments
      ? copy('Pembulatan dapat membuat cicilan berikutnya berbeda Rp0,01.', 'Rounding can make later installments differ by IDR 0.01.')
      : null,
  ].filter(Boolean);

  return (
    <section className="credit-projection" aria-label={copy('Simulasi pembiayaan', 'Financing simulation')} aria-live="polite">
      <div className="credit-monthly-result">
        <h5>{monthlyTitle}</h5>
        <strong>{formatRange(projection.monthlyPayment, lowerProjection?.monthlyPayment, { minimum: startingFrom })}</strong>
      </div>
      <dl className="decision-v2-financial-impact">
        {[
          [copy('Total bayar', 'Total payment'), formatRange(projection.totalPurchaseCost, lowerProjection?.totalPurchaseCost, { minimum: startingFrom })],
          [estimatedPrice ? copy('Selisih dari perkiraan harga', 'Difference from estimated price') : copy('Selisih harga', 'Price difference'),
            formatRange(projection.additionalCost, lowerProjection?.additionalCost, { signed: true, minimum: startingFrom })],
          [copy('Uang bebas awal', 'Initial free budget'), formatRange(projection.monthlyBefore, null)],
          [startingFrom ? copy('Sisa uang bebas pada tarif minimum', 'Remaining free budget at minimum rate') : copy('Sisa uang bebas', 'Remaining free budget'),
            formatRange(projection.monthlyAfter, lowerProjection?.monthlyAfter)],
          [copy('Tenor', 'Term'), projection.months === null ? unset
            : copy(`${number(projection.months)} bulan`, `${number(projection.months)} ${projection.months === 1 ? 'month' : 'months'}`)],
          [copy('Sisa uang tunai', 'Remaining cash'), formatRange(projection.remainingCash, null)],
        ].map(([label, value]) => (
          <div key={String(label)} className="decision-v2-financial-metric"><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      {notes.length > 0 && <p className="hint credit-estimate-notes">{notes.join(' ')}</p>}
    </section>
  );
}
