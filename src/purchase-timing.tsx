import { useEffect, useId, useRef, useState } from 'react';
import { isQuickTiming } from '../shared/intelligence.js';
import type { DetailedTimingAssessment, SavedAssessment, TimingPlanInput, TimingPreview } from '../shared/intelligence.js';
import { checkReadiness, readinessAnswers, readinessSelection } from '../shared/quick-timing.js';
import type { QuickTimingInput, QuickTimingResult, ReadinessAnswer } from '../shared/quick-timing.js';
import { getPurchaseQuote, includedProducts } from '../shared/purchase-plan.js';
import type { PlanLine, PurchasePlan, PurchaseQuote } from '../shared/purchase-plan.js';
import { parsePlanningAmount, timingVersion } from '../shared/purchase-timing.js';
import type { TimingInput } from '../shared/purchase-timing.js';
import type { Currency, Item, Wishlist } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { financialLabels, History, ReviewDetails, ToolDialog, useAssessmentHistory } from './intelligence-ui.js';
import { useLocale } from './locale.js';
import { formatProductPriceInput, normalizeProductPriceInput } from './product-price-input.js';
import type { Message } from './messages.js';

const amounts = ['purchaseMinor', 'liquidMinor', 'obligationsMinor', 'reserveMinor', 'extraMinor', 'monthlyMinor'] as const;
type AmountKey = typeof amounts[number];
type TimingRecord = Extract<SavedAssessment, { kind: 'timing' }>;
type DetailedRecord = TimingRecord & DetailedTimingAssessment;
const quoteNames = { saved: 'Saved prices', estimate: 'User-supplied estimate', incomplete: 'Incomplete total' } as const;
const answerLabels = { safe: 'Safe', tight: 'A bit tight', unsure: 'Not sure yet' } as const;
const readinessLabels = { safe: 'Essentials are covered', tight: 'It would be tight', unsure: 'Not sure yet' } as const;
const readinessAdvice = {
  safe: 'If essentials are covered and the price still works for you, decide when you’re ready.',
  tight: 'Consider waiting until you have more room after essentials.',
  unsure: 'Check your upcoming essentials or open the detailed check before deciding.',
} as const;

export function PurchaseTiming({ list, item, path, close }: {
  list: Wishlist; item?: Item; path: string; close: () => void;
}) {
  const { t, number, money, date, language, error: localError } = useLocale();
  const [values, setValues] = useState<Partial<Record<keyof TimingInput, string>>>({});
  const [plan, setPlan] = useState<PurchasePlan>([]);
  const [result, setResult] = useState<TimingPreview | null>(null);
  const [submitted, setSubmitted] = useState<TimingPlanInput | null>(null);
  const [viewed, setViewed] = useState<TimingRecord | null>(null);
  const [reviewing, setReviewing] = useState<DetailedRecord | null>(null);
  const [quick, setQuick] = useState<ReadinessAnswer | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [fresh, setFresh] = useState<Wishlist | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalidAmount, setInvalidAmount] = useState<AmountKey | null>(null);
  const [status, setStatus] = useState<Message | ''>('');
  const [outdated, setOutdated] = useState(false);
  const history = useAssessmentHistory(`${path}/timing/history`);
  const heading = useRef<HTMLHeadingElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const firstHint = useId();
  const items = item ? (fresh ?? list).items.filter(({ id }) => id === item.id) : (fresh ?? list).items;
  const selected = includedProducts(items, plan);
  const quote = getPurchaseQuote(selected);
  const quickQuote = getPurchaseQuote(items);
  const groups = [...new Set(plan.flatMap((line) => line.group === undefined ? [] : [line.group]))].sort((a, b) => a - b);
  const nextGroup = Array.from({ length: 100 }, (_, index) => index + 1).find((group) => !groups.includes(group));

  useEffect(() => { if (result || viewed || quick) heading.current?.focus(); }, [result, viewed, quick]);
  useEffect(() => { if (reviewing) formHeading.current?.focus(); }, [reviewing]);

  function invalidate() {
    if (result) setOutdated(true);
    setSubmitted(null);
    setError('');
    setStatus('');
    setInvalidAmount(null);
  }

  function change(key: keyof TimingInput, value: string) {
    setValues((current) => ({ ...current, [key]: key === 'targetDate' ? value : formatProductPriceInput(value, language) }));
    setConfirmed(false);
    invalidate();
  }

  function setLine(id: string, updates: Partial<Omit<PlanLine, 'id'>>) {
    setPlan((current) => {
      const old = current.find((line) => line.id === id) ?? { id, included: true, optional: false };
      const line = { ...old, ...updates };
      const others = current.filter((entry) => entry.id !== id);
      if (updates.group !== undefined && updates.group !== old.group &&
        others.some((entry) => entry.group === line.group && entry.included)) line.included = false;
      const unselect = line.included && line.group !== undefined;
      const next = [...others.map((entry) => unselect && entry.group === line.group ? { ...entry, included: false } : entry), line];
      return next.filter((entry) => entry.optional || !entry.included || entry.group !== undefined);
    });
    invalidate();
  }

  function beginReview() {
    if (!viewed) return;
    if (isQuickTiming(viewed)) {
      setViewed(null);
      setQuick(null);
      setAdvanced(false);
      setError('');
      setStatus('');
      requestAnimationFrame(() => formHeading.current?.focus());
      return;
    }
    const adjusted = (viewed.input.plan ?? []).filter((line) => items.some(({ id }) => id === line.id));
    setPlan(adjusted.map((line) => line.group !== undefined && adjusted.filter((entry) => entry.group === line.group).length < 2
      ? { ...line, group: undefined } : line));
    setValues({ targetDate: viewed.input.targetDate });
    setResult(null);
    setSubmitted(null);
    setStatus('');
    setOutdated(false);
    setConfirmed(false);
    setReviewing(viewed);
    setAdvanced(true);
    setViewed(null);
  }

  async function saveQuick() {
    if (!quick) return;
    setBusy(true);
    setError('');
    const input: QuickTimingInput = { mode: 'quick', answer: quick };
    try {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(readinessSelection(items)));
      const expectedSelection = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const saved = await history.save({ ...input, expectedSelection });
      if (saved.kind === 'timing') setViewed(saved);
      setQuick(null);
      setStatus('Decision saved.');
    } catch (failure) {
      const message = errorMessage(failure);
      setError(message);
      if (message === 'The saved products changed. Check again before saving.') {
        setQuick(null);
        try {
          setFresh(await api<Wishlist>(`/wishlists/${list.id}`));
          requestAnimationFrame(() => formHeading.current?.focus());
        } catch (reloadFailure) {
          setError(errorMessage(reloadFailure));
        }
      }
    } finally { setBusy(false); }
  }

  async function calculate() {
    setError('');
    setInvalidAmount(null);
    if (reviewing && (!confirmed || !values.liquidMinor?.trim() || !values.obligationsMinor?.trim() || !values.reserveMinor?.trim())) {
      setError('Enter or confirm your current finances before checking again.');
      return;
    }
    if (!selected.length) { setError('Choose at least one product.'); return; }
    if (groups.some((group) => plan.filter((line) => line.group === group).length < 2)) {
      setError('Each alternative group needs at least two products and at most one selection.');
      return;
    }
    const input: TimingPlanInput = { ...(plan.length ? { plan } : {}),
      ...(reviewing && { reviewId: reviewing.id, confirmedCurrent: confirmed }) };
    for (const key of amounts) {
      if (key === 'purchaseMinor' && quote.source === 'saved') continue;
      const amount = values[key]?.trim();
      if (!amount) continue;
      const parsed = parsePlanningAmount(normalizeProductPriceInput(amount, language));
      if (parsed === null) { setInvalidAmount(key); return; }
      input[key] = parsed;
    }
    if (values.targetDate) input.targetDate = values.targetDate;
    setBusy(true);
    try {
      const current = await api<TimingPreview>(`${path}/timing`, { method: 'POST', data: input });
      if (reviewing && current.review) history.markReview(reviewing.id, current.review);
      setResult(current);
      setSubmitted(input);
      setOutdated(false);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!submitted || !result) return;
    setBusy(true);
    setError('');
    try {
      await history.save({ ...submitted, previewToken: result.previewToken });
      setSubmitted(null);
      setStatus('Timing check saved.');
    } catch (failure) {
      const message = errorMessage(failure);
      setError(message);
      if (message === 'The saved products changed. Check again before saving.') {
        setOutdated(true); setSubmitted(null);
      }
    }
    finally { setBusy(false); }
  }

  function amountField(key: AmountKey) {
    return <label key={key}>{t(financialLabels[key])}
      <input inputMode="decimal" maxLength={25} value={values[key] ?? ''} onChange={(event) => change(key, event.target.value)}
        aria-invalid={invalidAmount === key || undefined}
        aria-describedby={key === 'extraMinor' || key === 'monthlyMinor' ? undefined : firstHint} />
    </label>;
  }

  const alert = error ? localError(error) : invalidAmount
    ? t('{field} must be a nonnegative amount with up to two decimal places.', { field: t(financialLabels[invalidAmount]) }) : '';
  return <ToolDialog title={t('Check purchase readiness')} context={item?.name ?? list.name} module="timing"
    version={viewed?.version ?? (advanced ? result?.version ?? timingVersion : undefined)} close={close} busy={busy}>
    {viewed ? <section className="decision-result">
      <h3 ref={heading} tabIndex={-1}>{t('Previous decision')}</h3>
      {isQuickTiming(viewed) ? <>
        <p className="hint">{t('Last checked {date}', { date: date(viewed.createdAt) })}</p>
        <QuickOutcome result={viewed.result} currency={list.currency} />
      </> : <>
        <p className="result-status">{t(viewed.result.status)}</p>
        <TimingHistorySummary record={viewed} currency={list.currency} />
        <SelectionDetails title="Previous selection" products={viewed.snapshot?.products ?? []} currency={list.currency} />
      </>}
      <ReviewDetails changes={viewed.review} currency={list.currency} />
      <div className="actions">
        <button type="button" className="primary" disabled={!items.length} onClick={beginReview}>{t('Check again')}</button>
        <button type="button" onClick={() => { setViewed(null); requestAnimationFrame(() => formHeading.current?.focus()); }}>{t('Back')}</button>
      </div>
    </section> : !items.length ? <h3 ref={formHeading} tabIndex={-1} className="decision-section">{t('No products yet')}</h3> : <>
      {!reviewing && (quick ? <section className="decision-result">
        <h3 ref={heading} tabIndex={-1}>{t(readinessLabels[quick])}</h3>
        <QuickOutcome result={checkReadiness(quick, items)} currency={list.currency} showTitle={false} />
        <div className="actions">
          <button type="button" onClick={() => { setQuick(null); setError(''); requestAnimationFrame(() => formHeading.current?.focus()); }}>
            {t('Change answer')}
          </button>
          <button type="button" className="primary" disabled={busy || history.busy} onClick={() => void saveQuick()}>{t('Save decision')}</button>
        </div>
      </section> : <section className="decision-section">
        <h3 ref={formHeading} tabIndex={-1}>{t('If you buy now, will you still have enough for essentials?')}</h3>
        <QuoteSummary quote={quickQuote} total={quickQuote.source === 'saved' ? quickQuote.subtotalMinor : null} currency={list.currency} />
        <div className="answer-buttons">{readinessAnswers.map((answer) => <button type="button" key={answer}
          onClick={() => { setQuick(answer); setError(''); setStatus(''); }}>{t(answerLabels[answer])}</button>)}</div>
      </section>)}
      <details className="decision-section advanced-check" open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
        <summary>{t('Check in more detail')}</summary>
        <div className="advanced-fields">
        <h3 ref={reviewing ? formHeading : undefined} tabIndex={reviewing ? -1 : undefined}>{t('Budget details')}</h3>
        {reviewing && <div className="review-details">
          <p><strong>{t('Previous result')}</strong> · {t(reviewing.result.status)}</p>
          <TimingHistorySummary record={reviewing} currency={list.currency} />
          <SelectionDetails title="Previous selection" products={reviewing.snapshot?.products ?? []} currency={list.currency} />
          <ReviewDetails changes={reviewing.review} currency={list.currency} />
          <p>{t('Your previous result stays in history. Enter your current finances before checking again.')}</p>
        </div>}
        {!item && <details>
          <summary>{t('Choose what’s included')} · {t('{n} products', { n: number(selected.length) })}</summary>
          <p className="hint">{t('Optional products start out excluded. Add products to the same group to choose just one of them.')}</p>
          <fieldset className="plan-lines" aria-label={t('Included products')} disabled={busy}>
            {items.map((product) => {
              const line = plan.find(({ id }) => id === product.id);
              return <div key={product.id} className="plan-line" role="group" aria-label={product.name}>
                <label className="check-label"><input type="checkbox" aria-label={t('Include {name}', { name: product.name })}
                  checked={line?.included ?? true} onChange={(event) => setLine(product.id, { included: event.target.checked })} />
                  {product.name} <small>· {t('Qty {n}', { n: number(product.quantity) })}</small></label>
                <div className="actions">
                  <label className="check-label"><input type="checkbox" checked={line?.optional ?? false}
                    onChange={(event) => setLine(product.id, event.target.checked ? { optional: true, included: false } : { optional: false })} />
                    {t('Optional item')}</label>
                  <label>{t('Alternative group')}<select value={line?.group ?? ''}
                    onChange={(event) => setLine(product.id, { group: event.target.value ? Number(event.target.value) : undefined })}>
                    <option value="">{t('No group')}</option>
                    {[...groups, ...(nextGroup === undefined ? [] : [nextGroup])].map((group) =>
                      <option key={group} value={group}>{t('Group {n}', { n: number(group) })}</option>)}
                  </select></label>
                </div>
              </div>;
            })}
          </fieldset>
        </details>}
        <p>{quote.source === 'saved' ? t('Saved purchase cost {price}', { price: money(quote.subtotalMinor, list.currency) }) : t('The full purchase cost is unknown.')}</p>
        {quote.source === 'incomplete' && !!selected.length && <>
          <p className="hint">{t('Known subtotal {price}', { price: money(quote.subtotalMinor, list.currency) })}. {t('Include the known subtotal in your full estimate.')}</p>
          <p className="hint">{t(quote.missingPrices === 1 ? '{n} selected item has no saved price.' :
            '{n} selected items have no saved price.', { n: number(quote.missingPrices) })}</p>
        </>}
        <p className="hint" id={firstHint}>{t('Use {currency} throughout. Enter 0 if you have no obligations or reserve.', { currency: list.currency })}</p>
        <form autoComplete="off" noValidate onSubmit={(event) => { event.preventDefault(); void calculate(); }}>
          <fieldset className="decision-inputs" disabled={busy}>
            {amounts.slice(quote.source === 'saved' ? 1 : 0, 4).map(amountField)}
            <details>
              <summary>{t('Additional costs, savings and target date')}</summary>
              <p className="hint">{t('Include taxes, delivery or other extras if they apply. Enter savings available after bills and reserve needs.')}</p>
              <div className="decision-inputs">
                {amounts.slice(4).map(amountField)}
                <label>{t('Target date')}<input lang={language} type="date" value={values.targetDate ?? ''}
                  onChange={(event) => change('targetDate', event.target.value)} /></label>
              </div>
            </details>
            {reviewing && <label className="check-label"><input type="checkbox" checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)} />{t('I confirm these are my current figures.')}</label>}
          </fieldset>
          {alert && <p className="error" role="alert">{alert}</p>}
          <div className="actions">
            <button className="primary" disabled={busy}>{t(busy ? 'Checking…' : reviewing ? 'Check again' : 'Check affordability')}</button>
            {reviewing && <button type="button" disabled={busy} onClick={() => { setViewed(reviewing); setReviewing(null); }}>{t('Cancel')}</button>}
          </div>
        </form>
        <p className="hint decision-privacy">{t('Saved timing checks keep the purchase details and outcome. Balances, bills, reserve and monthly savings amounts are not stored.')}</p>
        </div>
      {result && <section className="decision-result" data-outcome={result.status}>
        {outdated && <p className="review-badge" role="status">{t('Needs review')}</p>}
        <h3 ref={heading} tabIndex={-1}>{reviewing ? t('Current result') : t(result.status)}</h3>
        {reviewing && <strong>{t(result.status)}</strong>}
        <TimingExplanation result={result} currency={list.currency} />
        <SelectionDetails title="Current selection" products={result.snapshot.products} currency={list.currency} />
        <ReviewDetails changes={result.review} currency={list.currency} label="Changes since the previous check" />
        {!!result.review?.some((change) => change.kind === 'financial') && <p className="hint">
          {t('Financial changes are shown by field. Previous balances, bills, reserve and savings are kept out of history.')}</p>}
        {submitted && <button type="button" className="primary" disabled={busy || history.busy} onClick={() => void save()}>{t('Save timing check')}</button>}
      </section>}
      </details>
      {!advanced && alert && <p role="alert" className="error">{alert}</p>}
    </>}
    {viewed && alert && <p role="alert" className="error">{alert}</p>}
    <p role="status" className="decision-status">{status && t(status)}</p>
    <History history={history} name="Previous decisions" initialOpen={!items.length} disabled={busy}
      onSelect={(record) => { if (record.kind === 'timing') { setViewed(record); setStatus(''); setError(''); setInvalidAmount(null); } }}
      onDelete={(id) => {
        if (viewed?.id === id) setViewed(null);
        if (reviewing?.id === id) { setReviewing(null); setSubmitted(null); setResult(null); }
        setStatus('Timing check deleted.');
      }} />
  </ToolDialog>;
}

function QuickOutcome({ result, currency, showTitle = true }: { result: QuickTimingResult; currency: Currency; showTitle?: boolean }) {
  const { t } = useLocale();
  return <>
    {showTitle && <p className="result-status">{t(readinessLabels[result.answer])}</p>}
    <p>{t(readinessAdvice[result.answer])}</p>
    <QuoteSummary quote={result.quote} total={result.quote.source === 'saved' ? result.quote.subtotalMinor : null} currency={currency} />
    <p className="hint">{t('Based on your answer. No budget calculation was made.')}</p>
  </>;
}

function QuoteSummary({ quote, total, currency }: { quote: PurchaseQuote; total: string | null; currency: Currency }) {
  const { t, money } = useLocale();
  return <p>{t(quoteNames[quote.source])} · {total === null ? t('Unknown') : money(total, currency)}
    {quote.source !== 'saved' && <> · {t('Known subtotal {price}', { price: money(quote.subtotalMinor, currency) })}</>}</p>;
}

function TimingHistorySummary({ record, currency }: { record: DetailedRecord; currency: Currency }) {
  const { t, date, number, money } = useLocale();
  const { result, input } = record;
  return <>
    <p className="hint">{t('Last checked {date}', { date: date(record.createdAt) })}</p>
    <QuoteSummary quote={result.quote} total={result.totalMinor} currency={currency} />
    {input.extraMinor && input.extraMinor !== '0' && <p>{t('Additional costs')} · {money(input.extraMinor, currency)}</p>}
    {result.months && result.months !== '0' && <p>{t('Estimated time to afford')} · {
      t(result.months === '1' ? '{n} month' : '{n} months', { n: number(BigInt(result.months)) })
    }</p>}
    {input.targetDate && <p>{t('Target date')} · {date(input.targetDate)}{result.target && <> · {t(targetText[result.target])}</>}</p>}
  </>;
}

function SelectionDetails({ title, products, currency }: {
  title: 'Previous selection' | 'Current selection';
  products: TimingPreview['snapshot']['products']; currency: Currency;
}) {
  const { t, number, money } = useLocale();
  if (!products.length) return null;
  return <details>
    <summary>{t(title)}</summary>
    <ul>{products.map(({ id, name, quantity, priceMinor }) => <li key={id}>
      {name} · {t('Qty {n}', { n: number(quantity) })} · {priceMinor === null ? t('No price') :
        t('{price} each', { price: money(priceMinor, currency) })}
    </li>)}</ul>
  </details>;
}

const reason = {
  'Buy Now': 'The purchase fits after setting aside your obligations and reserve.',
  Wait: 'There is a funding gap. Your monthly savings could close it.',
  Reconsider: 'There is a funding gap and no positive monthly savings amount to estimate a date.',
  'Insufficient Data': 'Still needed: {fields}.',
} as const;
const targetText = {
  reachable: 'The purchase fits by your target date at this savings rate.',
  short: 'Your savings would fall short by the target date.',
  past: 'Your target date has already passed.',
  unknown: 'There is too little information to check the target date.',
} as const;

function TimingExplanation({ result, currency }: { result: TimingPreview; currency: Currency }) {
  const { t, money, number } = useLocale();
  return <>
    <h4>{t('Why this result?')}</h4>
    <p>{t(reason[result.status], { fields: result.missing.map((label) => t(label as Message)).join(', ') })}</p>
    <QuoteSummary quote={result.quote} total={result.totalMinor} currency={currency} />
    <details className="result-explanation">
      <summary>{t('Budget breakdown')}</summary>
      <dl className="decision-metrics">
      {([
        ['Total purchase cost', result.totalMinor], ['Available to spend', result.availableMinor],
        ['Funding gap', result.gapMinor], ['Essential obligations to protect', result.obligationsMinor],
        ['Reserve to protect', result.reserveMinor],
      ] as const).map(([label, value]) => <div key={label}><dt>{t(label)}</dt>
        <dd>{value === null ? t('Unknown') : value.startsWith('-') ? `−${money(value.slice(1), currency)}` : money(value, currency)}</dd></div>)}
      {result.months !== null && result.months !== '0' && <div><dt>{t('Estimated time to afford')}</dt>
        <dd>{t(result.months === '1' ? '{n} month' : '{n} months', { n: number(BigInt(result.months)) })}</dd></div>}
      </dl>
    </details>
    {result.protectionShortfallMinor && result.protectionShortfallMinor !== '0' && <p>
      {t('Your obligations and reserve already exceed your liquid funds by {price} before this purchase.', {
        price: money(result.protectionShortfallMinor, currency),
      })}</p>}
    {result.protectionShortfallMinor === '0' && result.gapMinor !== null && result.gapMinor !== '0' &&
      (result.obligationsMinor !== '0' || result.reserveMinor !== '0') &&
      <p>{t('Buying now would leave less than your combined obligations and reserve require.')}</p>}
    {result.target && <p>{t(targetText[result.target])}</p>}
    <p className="hint">{t('A planning estimate based on the numbers you entered.')}</p>
  </>;
}
