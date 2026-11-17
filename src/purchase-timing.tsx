import { useEffect, useId, useRef, useState } from 'react';
import { parsePlanningAmount } from '../shared/purchase-timing.js';
import type { TimingInput, TimingResult } from '../shared/purchase-timing.js';
import { formatPrice } from '../shared/wishlist.js';
import type { Currency, Item, Wishlist } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { ToolDialog } from './intelligence-ui.js';

const amounts = [
  ['purchaseMinor', 'Full purchase cost'], ['liquidMinor', 'Liquid funds'],
  ['obligationsMinor', 'Essential upcoming obligations'], ['reserveMinor', 'Protected reserve'],
  ['extraMinor', 'Additional costs'], ['monthlyMinor', 'Monthly savings'],
] as const;
type AmountKey = typeof amounts[number][0];

export function PurchaseTiming({ list, item, path, close }: {
  list: Wishlist; item?: Item; path: string; close: () => void;
}) {
  const [values, setValues] = useState<Partial<Record<AmountKey | 'targetDate', string>>>({});
  const [result, setResult] = useState<TimingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const firstHint = useId();
  const known = item ? item.priceMinor === null ? null : (BigInt(item.priceMinor) * BigInt(item.quantity)).toString()
    : list.items.length && list.unpriced === 0 ? list.totalMinor : null;

  useEffect(() => { if (result) heading.current?.focus(); }, [result]);

  function change(key: keyof TimingInput, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setResult(null);
    setError('');
  }

  async function calculate() {
    const input: TimingInput = {};
    setError('');
    for (const [key, label] of amounts) {
      const amount = values[key]?.trim();
      if (!amount) continue;
      const parsed = parsePlanningAmount(amount);
      if (parsed === null) {
        setError(`${label} must be a nonnegative amount with up to two decimal places.`);
        return;
      }
      input[key] = parsed;
    }
    if (values.targetDate) input.targetDate = values.targetDate;
    setBusy(true);
    try {
      setResult(await api<TimingResult>(`${path}/timing`, { method: 'POST', data: input }));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function amountField(key: AmountKey, label: string) {
    return <label key={key}>{label}
      <input inputMode="decimal" maxLength={19} value={values[key] ?? ''} onChange={(event) => change(key, event.target.value)}
        aria-describedby={key === 'extraMinor' || key === 'monthlyMinor' ? undefined : firstHint} />
    </label>;
  }

  return <ToolDialog title="Purchase Timing" context={item?.name ?? list.name} module="timing" version={result?.version} close={close} busy={busy}>
    <div className="decision-section">
      <p>{known === null ? 'The full purchase cost is unknown.' : <>Saved purchase cost <strong>{formatPrice(known, list.currency)}</strong></>}</p>
      {!item && known === null && BigInt(list.totalMinor) > 0n &&
        <p className="hint">Known subtotal {formatPrice(list.totalMinor, list.currency)}. Include it in the full cost you enter.</p>}
      <p className="hint" id={firstHint}>Use {list.currency} throughout. Enter 0 if you have no obligations or reserve.</p>
      <form autoComplete="off" onSubmit={(event) => { event.preventDefault(); void calculate(); }}>
        <fieldset className="decision-inputs" disabled={busy}>
          {amounts.slice(known === null ? 0 : 1, 4).map(([key, label]) => amountField(key, label))}
          <details>
            <summary>Additional costs, savings and target date</summary>
            <p className="hint">Include taxes, delivery or other extras if they apply. Enter savings available after bills and reserve needs.</p>
            <div className="decision-inputs">
              {amounts.slice(4).map(([key, label]) => amountField(key, label))}
              <label>Target date<input type="date" value={values.targetDate ?? ''} onChange={(event) => change('targetDate', event.target.value)} /></label>
            </div>
          </details>
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions"><button className="primary" disabled={busy}>{busy ? 'Checking…' : 'Check affordability'}</button></div>
      </form>
      <p className="hint decision-privacy">Your financial inputs are cleared when you close this check.</p>
    </div>
    {result && <section className="decision-result">
      <h3 ref={heading} tabIndex={-1}>{result.status}</h3>
      <h4>Why this result?</h4>
      <p>{result.status === 'Buy Now' ? 'The purchase fits after setting aside your obligations and reserve.'
        : result.status === 'Wait' ? 'There is a funding gap. Your monthly savings could close it.'
        : result.status === 'Reconsider' ? 'There is a funding gap and no positive monthly savings amount to estimate a date.'
        : `Still needed: ${result.missing.join(', ')}.`}</p>
      <dl className="decision-metrics">
        {([
          ['Total purchase cost', result.totalMinor], ['Available to spend', result.availableMinor],
          ['Funding gap', result.gapMinor], ['Essential obligations to protect', result.obligationsMinor],
          ['Reserve to protect', result.reserveMinor],
        ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt>
          <dd>{value === null ? 'Unknown' : value.startsWith('-') ? `−${formatPrice(value.slice(1), list.currency)}` :
            formatPrice(value, list.currency)}</dd></div>)}
        {result.months !== null && result.months !== '0' && <div><dt>Estimated time to afford</dt>
          <dd>{BigInt(result.months).toLocaleString()} {result.months === '1' ? 'month' : 'months'}</dd></div>}
      </dl>
      {result.protectionShortfallMinor && result.protectionShortfallMinor !== '0' &&
        <p>Your obligations and reserve already exceed your liquid funds by {formatPrice(result.protectionShortfallMinor, list.currency)} before this purchase.</p>}
      {result.protectionShortfallMinor === '0' && result.gapMinor !== null && result.gapMinor !== '0' &&
        (result.obligationsMinor !== '0' || result.reserveMinor !== '0') &&
        <p>Buying now would leave less than your combined obligations and reserve require.</p>}
      {result.target && <p>{result.target === 'reachable' ? 'The purchase fits by your target date at this savings rate.'
        : result.target === 'short' ? 'Your savings would fall short by the target date.'
        : result.target === 'past' ? 'Your target date has already passed.'
        : 'There is too little information to check the target date.'}</p>}
      <p className="hint">A planning estimate based on the numbers you entered.</p>
    </section>}
  </ToolDialog>;
}
