import { useEffect, useRef, useState } from 'react';
import { buyingReasons, evaluateBuyingReasons, factorsForImpulseVersion, waitingPeriods } from '../shared/impulse.js';
import type { BuyingAnswers, ImpulseResult, WaitingPeriod } from '../shared/impulse.js';
import type { SavedAssessment } from '../shared/intelligence.js';
import type { Currency } from '../shared/wishlist.js';
import { errorMessage } from './api.js';
import { History, ReviewDetails, ToolDialog, useAssessmentHistory } from './intelligence-ui.js';
import { useLocale } from './locale.js';
import { impulseCopy } from './methodology-id.js';
import type { Message } from './messages.js';

type SavedReason = Extract<SavedAssessment, { kind: 'impulse' }>;
const outcomes = {
  Low: ['Your reasons are taking shape', 'If it still fits your needs and budget, you can decide at your own pace.'],
  Moderate: ['Give it a little thought', 'Pick one of the points below and see if it changes how you feel about buying.'],
  High: ['Give yourself some time', 'If this can wait, take a break and come back when it feels easier to decide.'],
  'Insufficient information': ['A few things are still unclear', 'It’s okay to leave this for now or come back when you know more.'],
} as const;
const periodLabels = {
  '3-days': ['3 days', 'A quick pause before you decide.'],
  '1-week': ['1 week', 'See if it still feels useful next week.'],
  '1-month': ['1 month', 'Give a bigger purchase more time.'],
} as const;

export function ImpulseGuard({ path, name, currency, close, drafts }: {
  path: string; name: string; currency: Currency; close: () => void; drafts: Map<string, BuyingAnswers>;
}) {
  const { t, number, date, language, error: localError } = useLocale();
  const [answers, setAnswers] = useState<BuyingAnswers>(() => drafts.get(path) ?? {});
  const [step, setStep] = useState(0);
  const [viewed, setViewed] = useState<SavedReason | null>(null);
  const [period, setPeriod] = useState<WaitingPeriod | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<Message | ''>('');
  const heading = useRef<HTMLHeadingElement>(null);
  const history = useAssessmentHistory(`${path}/impulse`);
  const { load } = history;
  const factor = buyingReasons[step];
  const today = new Date().toISOString().slice(0, 10);
  const result = viewed?.result ?? (!factor ? evaluateBuyingReasons(answers, period, today) : null);
  const latest = history.page?.records[0];
  const reviewOn = latest?.kind === 'impulse' && 'reviewOn' in latest.result ? latest.result.reviewOn : null;

  useEffect(() => { drafts.set(path, answers); }, [drafts, path, answers]);
  useEffect(() => { void load(); }, [load]);

  function focusStep() {
    requestAnimationFrame(() => heading.current?.focus());
  }

  function startAgain() {
    setViewed(null);
    setAnswers({});
    setPeriod(null);
    setStep(0);
    setError('');
    setStatus('');
    focusStep();
  }

  async function saveResult() {
    setBusy(true);
    setError('');
    try {
      const saved = await history.save({ answers, period });
      if (saved.kind === 'impulse') setViewed(saved);
      setStatus('Decision saved.');
      focusStep();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function showRecord(record: SavedReason) {
    setViewed(record);
    setStatus('');
    setError('');
    focusStep();
  }

  return <ToolDialog title={t('Check buying reasons')} context={name} module="impulse"
    version={result?.version} close={close} busy={busy}>
    {!viewed && step === 0 && latest?.kind === 'impulse' && reviewOn && <div className="decision-pause">
      <p>{t(reviewOn <= today ? 'Ready to look again? You planned to check on {date}.' : 'You planned to check again on {date}.',
        { date: date(reviewOn) })}</p>
      <button type="button" onClick={() => showRecord(latest)}>{t('View previous decision')}</button>
    </div>}
    {result ? <section className="decision-result" data-outcome={result.concern}>
      <h3 ref={heading} tabIndex={-1}>{t(outcomes[result.concern][0])}</h3>
      {viewed && <p className="hint">{t('Last checked {date}', { date: date(viewed.createdAt) })}</p>}
      <p>{t(outcomes[result.concern][1])}</p>
      <ImpulseExplanation result={result} />
      <ReviewDetails changes={viewed?.review} currency={currency} />
      {viewed ? <>
        {'reviewOn' in result && result.reviewOn && <p>
          {t(result.reviewOn <= today ? 'Ready to look again? You planned to check on {date}.' : 'You planned to check again on {date}.',
            { date: date(result.reviewOn) })}
        </p>}
        <button type="button" className="primary" onClick={startAgain}>{t('Check again')}</button>
      </> : <>
        <fieldset className="wait-options">
          <legend>{t('Want to give it time?')}</legend>
          <p className="hint">{t('If this can wait, a pause can help you see if it’s a passing want.')}</p>
          {waitingPeriods.map((option) => <label key={option} className="check-label">
            <input type="radio" name="wait-period" checked={period === option} onChange={() => setPeriod(option)} />
            <span><strong>{t(periodLabels[option][0])}</strong><small>{t(periodLabels[option][1])}</small></span>
          </label>)}
          {period && 'reviewOn' in result && result.reviewOn && <p className="hint">
            {t('Check again on {date}', { date: date(result.reviewOn) })}{' '}
            <button type="button" className="text-button" onClick={() => setPeriod(null)}>{t('Clear wait')}</button>
          </p>}
        </fieldset>
        <div className="actions">
          <button type="button" onClick={() => { setStep(buyingReasons.length - 1); focusStep(); }}>{t('Review answers')}</button>
          <button type="button" className="primary" disabled={busy || history.busy} onClick={() => void saveResult()}>
            {t(period ? 'Save and check later' : 'Save decision')}
          </button>
        </div>
      </>}
    </section> : factor && <section className="decision-section">
      <div className="decision-progress">
        <p className="hint">{t('Question {n} of {total}', { n: number(step + 1), total: number(buyingReasons.length) })}</p>
        <progress aria-label={t('Assessment progress')} value={step + 1} max={buyingReasons.length} />
      </div>
      <h3 ref={heading} tabIndex={-1}>{impulseCopy(language, factor).question}</h3>
      <div className="answer-buttons">
        {(['Yes', 'No', 'Not sure yet'] as const).map((label, index) => <button type="button" key={label}
          onClick={() => {
            setAnswers((current) => ({ ...current, [factor.id]: index === 2 ? undefined : index === 0 }));
            setStep(step + 1);
            focusStep();
          }}>{t(label)}</button>)}
      </div>
      {step > 0 && <button type="button" className="text-button" onClick={() => { setStep(step - 1); focusStep(); }}>
        {t('Back')}
      </button>}
    </section>}
    {error && <p role="alert" className="error">{localError(error)}</p>}
    <p role="status" className="decision-status">{status && t(status)}</p>
    <History history={history} name="Previous decisions" disabled={busy}
      onSelect={(record) => { if (record.kind === 'impulse') showRecord(record); }}
      onDelete={(id) => { if (viewed?.id === id) startAgain(); setStatus('Assessment deleted.'); }} />
  </ToolDialog>;
}

function ImpulseExplanation({ result }: { result: ImpulseResult }) {
  const { t, number, language } = useLocale();
  const factors = factorsForImpulseVersion(result.version)
    .filter(({ id }) => (result.contributing as readonly string[]).includes(id))
    .map((factor) => impulseCopy(language, factor));
  return <>
    {factors.length > 0 && <ul className="decision-reasons">{factors.map(({ id, reason, action }) =>
      <li key={id}><strong>{reason}</strong> {action}</li>)}</ul>}
    {!('period' in result) && result.coolingOffDays !== null && <p className="hint">
      {t(result.coolingOffDays === 1 ? 'If you’d like to wait, check again after your chosen {days} day.' :
        'If you’d like to wait, check again after your chosen {days} days.', { days: number(result.coolingOffDays) })}
    </p>}
  </>;
}
