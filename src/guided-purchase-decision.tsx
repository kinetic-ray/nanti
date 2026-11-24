import { useEffect, useRef, useState } from 'react';
import { evaluateScreening } from '../shared/screening.js';
import { assessPurchase } from '../shared/purchase-decision.js';
import { analyzePurchaseImpact, type PurchaseFinanceContext } from '../shared/purchase-impact.js';
import type { SavedPurchaseFinanceContext } from '../shared/intelligence.js';
import type { Item, Wishlist } from '../shared/wishlist.js';
import { useLocale } from './locale.js';
import { api, errorMessage } from './api.js';
import { AlternativeRecommendations } from './AlternativeRecommendations.js';
import type { RecommendationMatch } from '../server/recommendation-matching.js';

const prompts = {
  practicalNeed: 'Do you actually need this item?',
  alreadyHave: 'Do you already own something similar?',
  useOften: 'Will you use it often?',
  canWait: 'Can this purchase wait without consequences?',
  withoutDiscount: 'Would you still want it without a discount?',
  socialPressure: 'Are trends or fear of missing out driving this purchase?',
} as const;
const questions = Object.keys(prompts) as (keyof typeof prompts)[];
const reasons = {
  green: 'Your answers suggest a clear practical benefit.',
  yellow: 'Some buying reasons are still uncertain.',
  red: 'Your answers suggest the purchase may be driven by low need or outside pressure.',
} as const;

export function formatMoneyInput(raw: string, language: 'id' | 'en'): string {
  const separator = language === 'id' ? '.' : ',';
  const digits = raw.replace(/[^\d]/g, '').slice(0, 15);
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

export function toMinor(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (!/^\d{1,15}$|^\d{1,3}(?:[.,]\d{3}){1,4}$/.test(trimmed)) return null;
  return BigInt(trimmed.replace(/[.,]/g, '')) * 100n;
}

export function formatCurrencyInput(raw: string, language: 'id' | 'en'): string {
  const decimal = language === 'id' ? ',' : '.';
  const wholeRaw = raw.includes(decimal) ? raw.slice(0, raw.indexOf(decimal)) : raw;
  const fractionRaw = raw.includes(decimal) ? raw.slice(raw.indexOf(decimal) + 1).replace(/\D/g, '').slice(0, 2) : null;
  const whole = formatMoneyInput(wholeRaw, language);
  return fractionRaw === null ? whole : `${whole}${decimal}${fractionRaw}`;
}

export function parseCurrencyMinor(raw: string, language: 'id' | 'en'): bigint | null {
  const decimal = language === 'id' ? ',' : '.';
  const group = language === 'id' ? '.' : ',';
  const parts = raw.trim().split(decimal);
  if (parts.length > 2) return null;
  const whole = (parts[0] ?? '').replaceAll(group, '');
  const fraction = parts[1];
  if (!/^\d{1,15}$/.test(whole) || (fraction !== undefined && !/^\d{1,2}$/.test(fraction))) return null;
  return BigInt(whole) * 100n + BigInt((fraction ?? '').padEnd(2, '0') || '0');
}

const toInput = (minor: string | null, language: 'id' | 'en') => {
  if (minor === null) return '';
  const amount = BigInt(minor);
  const whole = formatCurrencyInput((amount / 100n).toString(), language);
  const fraction = (amount % 100n).toString().padStart(2, '0').replace(/0$/u, '');
  return fraction ? `${whole}${language === 'id' ? ',' : '.'}${fraction}` : whole;
};

export function GuidedPurchaseDecision({ list, item, close }: { list: Wishlist; item: Item; close: () => void }) {
  const { language, money, t, date } = useLocale();
  const [stage, setStage] = useState<1 | 2>(1);
  const [price, setPrice] = useState('');
  const [cash, setCash] = useState('');
  const [expenses, setExpenses] = useState('');
  const [aside, setAside] = useState('');
  const [nextIncomeDate, setNextIncomeDate] = useState('');
  const [nextIncome, setNextIncome] = useState('');
  const [canWait, setCanWait] = useState<'yes' | 'no' | ''>('');
  const [remember, setRemember] = useState(false);
  const [answers, setAnswers] = useState<Partial<Record<keyof typeof prompts, boolean>>>({});
  const [saved, setSaved] = useState<SavedPurchaseFinanceContext | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [error, setError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const profilePath = `/intelligence/financial-context/${list.currency}`;
  const fixedPrice = item.priceMinor === null ? null : BigInt(item.priceMinor) * BigInt(item.quantity);
  const estimatedPrice = parseCurrencyMinor(price, language);
  const priceMinor = fixedPrice ?? estimatedPrice;
  const context: PurchaseFinanceContext = {
    cashMinor: parseCurrencyMinor(cash, language)?.toString() ?? null,
    essentialExpensesMinor: parseCurrencyMinor(expenses, language)?.toString() ?? null,
    setAsideMinor: parseCurrencyMinor(aside, language)?.toString() ?? null,
    nextIncomeDate: nextIncomeDate || null,
    nextIncomeMinor: parseCurrencyMinor(nextIncome, language)?.toString() ?? null,
    canWait: canWait === '' ? null : canWait === 'yes',
  };
  const impact = analyzePurchaseImpact(priceMinor, context);
  const hasEnteredContext = Object.values(context).some(value => value !== null);
  const format = (value: bigint) => money(value.toString(), list.currency);

  useEffect(() => {
    const controller = new AbortController();
    void api<SavedPurchaseFinanceContext | null>(profilePath, { signal: controller.signal })
      .then(setSaved)
      .catch(() => setSaved(null))
      .finally(() => setLoadingSaved(false));
    return () => controller.abort();
  }, [profilePath]);
  useEffect(() => { heading.current?.focus(); }, [stage]);

  function useSavedContext() {
    if (!saved) return;
    setCash(toInput(saved.context.cashMinor, language));
    setExpenses(toInput(saved.context.essentialExpensesMinor, language));
    setAside(toInput(saved.context.setAsideMinor, language));
    setNextIncomeDate(saved.context.nextIncomeDate ?? '');
    setNextIncome(toInput(saved.context.nextIncomeMinor, language));
    setCanWait(saved.context.canWait === null ? '' : saved.context.canWait ? 'yes' : 'no');
    setRemember(false);
    setError('');
  }

  async function continueAnalysis() {
    setError('');
    setSaveNotice('');
    if (remember && hasEnteredContext) {
      try {
        // Urgency belongs to this item, so do not carry it into a future analysis.
        await api(profilePath, { method: 'PUT', data: { ...context, canWait: null } });
        setSaved(await api<SavedPurchaseFinanceContext>(profilePath));
        setSaveNotice(t('Your details were saved for future analyses.'));
      } catch {
        setSaveNotice(t('Could not save these details. You can still continue without saving them.'));
      }
    }
    setStage(2);
  }

  async function removeSavedContext() {
    try {
      await api(profilePath, { method: 'DELETE' });
      setSaved(null);
      setCash(''); setExpenses(''); setAside(''); setNextIncomeDate(''); setNextIncome(''); setCanWait('');
      setSaveNotice(t('Saved purchase context was removed.'));
    } catch (failure) { setError(errorMessage(failure)); }
  }

  const screening = questions.every(question => answers[question] !== undefined)
    ? evaluateScreening(answers, null, new Date().toISOString().slice(0, 10)) : null;
  const cashBeforePurchase = context.cashMinor === null ? null : BigInt(context.cashMinor);
  const expensesBeforeIncome = context.essentialExpensesMinor === null ? null : BigInt(context.essentialExpensesMinor);
  const setAsideMinor = context.setAsideMinor === null ? null : BigInt(context.setAsideMinor);
  const cheaperOptionLimit = cashBeforePurchase !== null && expensesBeforeIncome !== null && setAsideMinor !== null
    ? cashBeforePurchase - expensesBeforeIncome - setAsideMinor : null;
  const alternativeFinance = priceMinor !== null && cashBeforePurchase !== null && expensesBeforeIncome !== null &&
    setAsideMinor !== null && context.nextIncomeDate !== null
    ? { priceMinor, cashMinor: cashBeforePurchase, billsMinor: expensesBeforeIncome, setAsideMinor } : null;
  const alternativeAssessment = screening && alternativeFinance ? assessPurchase(answers, alternativeFinance) : null;
  const canLoadAlternatives = alternativeAssessment !== null && screening?.outcome === 'green' &&
    ['save', 'alternative'].includes(alternativeAssessment.decision);

  return <div className="guided-decision">
    <p className="hint">{item.name}</p>
    {stage === 1 && <section className="decision-section">
      <h3 tabIndex={-1} ref={heading}>{t('Current purchase impact')}</h3>
      <div className="decision-result guided-impact-preview" aria-live="polite">
        <strong>{t('Available information')}</strong>
        <p><span>{t('Product price')}: </span>{priceMinor === null ? t('The item price is unknown.') : format(priceMinor)}</p>
        {impact.cashAfterPurchaseMinor !== null
          ? <p>{t('If you buy now, {amount} would remain before other expenses.', { amount: format(impact.cashAfterPurchaseMinor) })}</p>
          : <p>{t('Add an amount to estimate what would remain after the purchase.')}</p>}
      </div>
      {impact.missing.length > 0 && <details className="decision-section guided-missing">
        <summary>{t('Show what is missing')}</summary>
        <ul className="decision-reasons">
          {impact.missing.includes('price') && <li>{t('The saved price is missing, so we cannot calculate the amount left after buying.')}</li>}
          {impact.missing.includes('cash') && <li>{t('Your available cash is missing, so we cannot estimate what would remain.')}</li>}
          {impact.missing.includes('nextIncomeDate') && <li>{t('We do not know how long the remaining money needs to last because the next income date is missing.')}</li>}
          {impact.missing.includes('essentialExpenses') && <li>{t('Expenses due before that income are unknown, so the remainder may still need to cover them.')}</li>}
          {impact.missing.includes('setAside') && <li>{t('Money you want to protect is unknown, so this estimate does not account for it.')}</li>}
        </ul>
      </details>}

      {saved && <aside className="account-notice" aria-label={t('Saved financial details for {currency} were last updated {date}. Review them before using them.', {
        currency: list.currency, date: date(saved.updatedAt),
      })}>
        <p>{t('Saved financial details for {currency} were last updated {date}. Review them before using them.', {
          currency: list.currency, date: date(saved.updatedAt),
        })}</p>
        <div className="actions">
          <button type="button" onClick={useSavedContext}>{t('Use saved details')}</button>
          <button type="button" onClick={() => void removeSavedContext()}>{t('Remove saved details')}</button>
        </div>
      </aside>}
      {loadingSaved && <p className="hint" role="status">{t('Loading preference…')}</p>}

      <form noValidate autoComplete="off" onSubmit={event => { event.preventDefault(); void continueAnalysis(); }}>
        <div className="guided-fields">
          {fixedPrice === null && <label>{t('Estimated price (optional)')}<input inputMode="decimal" value={price}
            onChange={event => setPrice(formatCurrencyInput(event.target.value, language))} placeholder="0" /></label>}
          <label>{t('Cash available now (optional)')}<input inputMode="decimal" value={cash}
            onChange={event => setCash(formatCurrencyInput(event.target.value, language))} placeholder="0" />
            <small className="hint">{t('This information is optional. You can continue without it.')}</small>
          </label>
        </div>
        <details className="decision-section guided-context-details">
          <summary>{t('Add context that would make this estimate more useful')}</summary>
          <div className="guided-fields">
            <label>{t('Next income date (optional)')}<input type="date" value={nextIncomeDate} onChange={event => setNextIncomeDate(event.target.value)} /></label>
            <label>{t('Expected amount (optional)')}<input inputMode="decimal" value={nextIncome}
              onChange={event => setNextIncome(formatCurrencyInput(event.target.value, language))} placeholder="0" /></label>
            <label>{t('Essential expenses due before your next income (optional)')}<input inputMode="decimal" value={expenses}
              onChange={event => setExpenses(formatCurrencyInput(event.target.value, language))} placeholder="0" />
              <small className="hint">{t('For example food, rent, installments and bills due before your next income.')}</small>
            </label>
            <label>{t('Money set aside that you do not want to spend (optional)')}<input inputMode="decimal" value={aside}
              onChange={event => setAside(formatCurrencyInput(event.target.value, language))} placeholder="0" /></label>
            <label>{t('Can this purchase wait? (optional)')}<select value={canWait} onChange={event => setCanWait(event.target.value as typeof canWait)}>
              <option value="">{t('Not sure yet')}</option><option value="yes">{t('Yes, I can wait')}</option><option value="no">{t('No, I may need it sooner')}</option>
            </select></label>
          </div>
        </details>

        {hasEnteredContext && <fieldset className="guided-save-choice">
          <legend>{t('How should we use this information?')}</legend>
          <label><input type="radio" name="finance-context-use" checked={!remember} onChange={() => setRemember(false)} />
            {t('Use this information for this analysis only')}</label>
          <label><input type="radio" name="finance-context-use" checked={remember} onChange={() => setRemember(true)} />
            {t('Save these details for future analyses')}</label>
          {remember && <small className="hint">{t('Saved details stay private to your Nanti profile and are kept separately for each currency. You can remove them here; check that they are current before using them again.')}</small>}
        </fieldset>}
        {error && <p className="error" role="alert">{error}</p>}
        {saveNotice && <p role="status" className="hint">{saveNotice}</p>}
        <div className="actions"><button type="submit" className="primary">{t('Continue with this limited analysis')}</button></div>
      </form>
    </section>}

    {stage === 2 && <section className="decision-result guided-result">
      <h3 tabIndex={-1} ref={heading}>{t('Current purchase impact')}</h3>
      {priceMinor !== null && <p><strong>{t('Product price')}: </strong>{format(priceMinor)}</p>}
      {impact.cashAfterPurchaseMinor !== null && <p>
        {impact.cashAfterPurchaseMinor >= 0n
          ? t('If you buy now, {amount} would remain before other expenses.', { amount: format(impact.cashAfterPurchaseMinor) })
          : t('Based only on the amounts you entered, the purchase is {amount} above the cash available.', { amount: format(-impact.cashAfterPurchaseMinor) })}
      </p>}
      {impact.cashAfterKnownCostsMinor !== null && (expensesBeforeIncome !== null || setAsideMinor !== null) && <div className="guided-result-grid">
        <div><small>{t('Cash after the listed purchase and costs')}</small><strong>{format(impact.cashAfterKnownCostsMinor)}</strong></div>
      </div>}

      {impact.missing.length > 0 && <details className="decision-section guided-missing" open>
        <summary>{t('Show what is missing')}</summary>
        <ul className="decision-reasons">
          {impact.missing.includes('price') && <li>{t('The saved price is missing, so we cannot calculate the amount left after buying.')}</li>}
          {impact.missing.includes('cash') && <li>{t('Your available cash is missing, so we cannot estimate what would remain.')}</li>}
          {impact.missing.includes('nextIncomeDate') && <li>{t('We do not know how long the remaining money needs to last because the next income date is missing.')}</li>}
          {impact.missing.includes('essentialExpenses') && <li>{t('Expenses due before that income are unknown, so the remainder may still need to cover them.')}</li>}
          {impact.missing.includes('setAside') && <li>{t('Money you want to protect is unknown, so this estimate does not account for it.')}</li>}
        </ul>
      </details>}

      <h4>{t('Options to consider')}</h4>
      <ul className="decision-reasons">
        {impact.cashAfterPurchaseMinor !== null && <li><strong>{t('Buy now')}: </strong>
          {impact.cashAfterPurchaseMinor >= 0n
            ? t('If you buy now, {amount} would remain before other expenses.', { amount: format(impact.cashAfterPurchaseMinor) })
            : t('Based only on the amounts you entered, the purchase is {amount} above the cash available.', { amount: format(-impact.cashAfterPurchaseMinor) })}
        </li>}
        <li><strong>{t('Wait until your next income')}: </strong>{context.nextIncomeDate
          ? t('Your next income date is {date}. Waiting lets you review the purchase then; the amount and other costs still matter.', { date: date(context.nextIncomeDate) })
          : t('Without a next income date, we cannot estimate how long your remaining cash needs to last.')}</li>
        {cheaperOptionLimit !== null && priceMinor !== null && priceMinor > cheaperOptionLimit && cheaperOptionLimit > 0n &&
          <li><strong>{t('A cheaper option')}: </strong>{t('Based on the expenses and money you chose to protect, you could compare options priced at or below {amount}. This does not account for unknown costs.', { amount: format(cheaperOptionLimit) })}</li>}
      </ul>
      {canLoadAlternatives && alternativeFinance && <>
        <p className="hint">{t('If you request product alternatives, the item price may be stored to match options.')}</p>
        <AlternativeRecommendations
          eligible
          currency={list.currency}
          canNotify={false}
          load={async () => {
          const result = await api<{ alternatives: RecommendationMatch[] }>(
            '/recommendations/alternatives', { method: 'POST', data: { wishlistId: list.id, itemId: item.id, answers,
              finances: { cashMinor: alternativeFinance.cashMinor.toString(), billsMinor: alternativeFinance.billsMinor.toString(),
                setAsideMinor: alternativeFinance.setAsideMinor.toString() },
              ...(item.priceMinor === null && priceMinor !== null && priceMinor <= 2_000_000_000n
                ? { estimatedPriceMinor: Number(priceMinor) } : {}) } });
          return result.alternatives;
          }}
          requestRecommendation={async () => {
          await api('/recommendations/requests', {
            method: 'POST', data: { wishlistId: list.id, itemId: item.id, answers,
              finances: { cashMinor: alternativeFinance.cashMinor.toString(), billsMinor: alternativeFinance.billsMinor.toString(),
                setAsideMinor: alternativeFinance.setAsideMinor.toString() },
              ...(item.priceMinor === null && priceMinor !== null && priceMinor <= 2_000_000_000n
                ? { estimatedPriceMinor: Number(priceMinor) } : {}) },
          });
          }}
          onOpenProduct={url => { window.open(url, '_blank', 'noopener,noreferrer'); }}
        />
      </>}
      {context.nextIncomeMinor !== null && <p className="hint">{t('Expected income you entered: {amount}. Costs after that income are not included.', { amount: format(BigInt(context.nextIncomeMinor)) })}</p>}
      {context.canWait === false && <p className="hint">{t('You said you may need this sooner. Weigh the reason and cost of waiting alongside the money impact above.')}</p>}
      {context.canWait === true && <p className="hint">{t('You said this can wait, so checking again after your next income is one option.')}</p>}
      <p className="hint">{t('This is a partial estimate, not a claim that the purchase is safe or affordable.')}</p>

      <details className="decision-section guided-reasons">
        <summary>{t('Buying reasons (optional)')}</summary>
        <p className="hint">{t('Complete this reflection only if it helps you decide.')}</p>
        {questions.map(question => <fieldset key={question} className="guided-reason-question">
          <legend>{t(prompts[question])}</legend>
          <div className="answer-buttons screening-answers">
            <button type="button" aria-pressed={answers[question] === true} onClick={() => setAnswers(current => ({ ...current, [question]: true }))}>{t('Yes')}</button>
            <button type="button" aria-pressed={answers[question] === false} onClick={() => setAnswers(current => ({ ...current, [question]: false }))}>{t('No')}</button>
          </div>
        </fieldset>)}
        {screening && <p role="status">{t(reasons[screening.outcome as keyof typeof reasons])} {t('This reflection does not decide for you.')}</p>}
      </details>

      {saveNotice && <p role="status" className="hint">{saveNotice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><button type="button" onClick={() => setStage(1)}>{t('Edit information')}</button><button type="button" className="primary" onClick={close}>{t('Done')}</button></div>
    </section>}
  </div>;
}
