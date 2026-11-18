import { useEffect, useRef, useState } from 'react';
import { factorsForImpulseVersion, waitingPeriods } from '../shared/impulse.js';
import type { ImpulseResult, WaitingPeriod } from '../shared/impulse.js';
import { evaluateScreening, screeningQuestions, screeningSignals, screeningVersion } from '../shared/screening.js';
import type { ScreeningAnswers, ScreeningResult } from '../shared/screening.js';
import type { SavedAssessment } from '../shared/intelligence.js';
import type { Currency } from '../shared/wishlist.js';
import { errorMessage } from './api.js';
import { History, ReviewDetails, ToolDialog, useAssessmentHistory } from './intelligence-ui.js';
import { useLocale } from './locale.js';
import { impulseCopy } from './methodology-id.js';
import type { Message } from './messages.js';
import { screeningEvidence, screeningOutcomes, screeningPrompts } from './screening-copy.js';
import { Icon } from './visual.js';

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
const options = [
  { label: 'Yes', value: true }, { label: 'No', value: false }, { label: 'Not sure yet', value: undefined },
] as const;

export function ImpulseGuard({ path, name, currency, close, drafts }: {
  path: string; name: string; currency: Currency; close: () => void; drafts: Map<string, ScreeningAnswers>;
}) {
  const { t, number, date, error: localError } = useLocale();
  const [answers, setAnswers] = useState<ScreeningAnswers>(() => drafts.get(path) ?? {});
  const [step, setStep] = useState(0);
  const [viewed, setViewed] = useState<SavedReason | null>(null);
  const [period, setPeriod] = useState<WaitingPeriod | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<Message | ''>('');
  const [feedback, setFeedback] = useState<{ answer: Message; detail: Message } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const history = useAssessmentHistory(`${path}/impulse`);
  const { load } = history;
  const question = screeningQuestions[step];
  const today = new Date().toISOString().slice(0, 10);
  const result = viewed?.result ?? (!question ? evaluateScreening(answers, period, today) : null);
  const screening = result && 'outcome' in result ? result : null;
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
    setFeedback(null);
    focusStep();
  }

  async function saveResult() {
    setBusy(true);
    setError('');
    try {
      const saved = await history.save({ version: screeningVersion, answers, period });
      if (saved.kind === 'impulse') setViewed(saved);
      setStatus(period ? 'Pause saved. You can check again on your chosen date.' : 'Reflection saved.');
      setFeedback(null);
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
    setFeedback(null);
    focusStep();
  }

  return <ToolDialog title={t('Check buying reasons')} context={name} module="impulse"
    version={result?.version ?? screeningVersion} close={close} busy={busy}>
    {!viewed && step === 0 && latest?.kind === 'impulse' && reviewOn && <div className="decision-pause">
      <p>{t(reviewOn <= today ? 'Ready to look again? You planned to check on {date}.' : 'You planned to check again on {date}.',
        { date: date(reviewOn) })}</p>
      <button type="button" onClick={() => showRecord(latest)}>{t('View previous decision')}</button>
    </div>}
    <div className={feedback ? 'screening-feedback' : 'sr-only'} role="status" aria-atomic="true">
      {feedback && <><Icon name="check" /><span><strong>{t(feedback.answer)}</strong> · {t(feedback.detail)}</span></>}
    </div>
    {result ? <section className="screening-result">
      <div className="decision-result screening-summary" data-screening={screening?.outcome} data-outcome={result.concern}>
        {screening && <p className="screening-label">
          <Icon name={screening.outcome === 'green' ? 'check' : screening.outcome === 'yellow' ? 'clock' : 'bookmark'} />
          {t(screeningOutcomes[screening.outcome][0])}
        </p>}
        <h3 ref={heading} tabIndex={-1}>{t(screening ? screeningOutcomes[screening.outcome][1] : outcomes[result.concern][0])}</h3>
        <p>{t(screening ? screeningOutcomes[screening.outcome][2] : outcomes[result.concern][1])}</p>
        {'outcome' in result ? <ScreeningExplanation result={result} /> : <ImpulseExplanation result={result} />}
      </div>
      {viewed && <p className="hint">{t('Last checked {date}', { date: date(viewed.createdAt) })}</p>}
      <ReviewDetails changes={viewed?.review} currency={currency} />
      {viewed ? <>
        {'reviewOn' in result && result.reviewOn && <p>
          {t(result.reviewOn <= today ? 'Ready to look again? You planned to check on {date}.' : 'You planned to check again on {date}.',
            { date: date(result.reviewOn) })}
        </p>}
        <button type="button" className="primary" onClick={startAgain}>{t('Check again')}</button>
      </> : <>
        <fieldset className="wait-options" disabled={busy}>
          <legend>{t('Pick a review date (optional)')}</legend>
          <p className="hint">{t('A short pause can help you decide. Nanti saves the date in this check.')}</p>
          {waitingPeriods.map((option) => <label key={option} className="check-label">
            <input type="radio" name="wait-period" checked={period === option} onChange={() => setPeriod(option)} />
            <span><strong>{t(periodLabels[option][0])}</strong><small>{t(periodLabels[option][1])}</small></span>
            {period === option && <Icon name="check" />}
          </label>)}
          {period && 'reviewOn' in result && result.reviewOn && <p className="hint">
            {t('Check again on {date}', { date: date(result.reviewOn) })}{' '}
            <button type="button" className="text-button" onClick={() => setPeriod(null)}>{t('Clear wait')}</button>
          </p>}
        </fieldset>
        <div className="actions screening-actions">
          <button type="button" disabled={busy} onClick={() => { setStep(0); setFeedback(null); focusStep(); }}>{t('Review answers')}</button>
          <button type="button" className="primary" disabled={busy || history.busy} onClick={() => void saveResult()}>
            {t(busy ? 'Saving…' : period ? 'Save review date' : 'Save decision')}
          </button>
        </div>
      </>}
    </section> : question && <section className="decision-section">
      <div className="decision-progress">
        <p className="hint">{t('Question {n} of {total}', { n: number(step + 1), total: number(screeningQuestions.length) })}</p>
        <progress aria-label={t('Assessment progress')} value={step + 1} max={screeningQuestions.length} />
      </div>
      <div className="screening-question" key={question}>
        <h3 ref={heading} tabIndex={-1}>{t(screeningPrompts[question])}</h3>
        <div className="answer-buttons screening-answers">
          {options.map(({ label, value }) => {
            const selected = Object.hasOwn(answers, question) && answers[question] === value;
            return <button type="button" key={label} aria-pressed={selected} onClick={() => {
              setAnswers((current) => ({ ...current, [question]: value }));
              setFeedback({ answer: label, detail: value === undefined ? 'You left this one open.' :
                screeningEvidence[screeningSignals[question][value ? 1 : 0]] });
              setStep(step + 1);
              focusStep();
            }}>{t(label)}{selected && <Icon name="check" />}</button>;
          })}
        </div>
      </div>
      {step > 0 && <button type="button" className="text-button" onClick={() => { setStep(step - 1); setFeedback(null); focusStep(); }}>
        {t('Back')}
      </button>}
    </section>}
    {error && <p role="alert" className="error">{localError(error)}</p>}
    <p role="status" className={status ? 'decision-status screening-feedback' : 'sr-only'}>
      {status && <><Icon name="check" />{t(status)}</>}
    </p>
    <History history={history} name="Previous decisions" disabled={busy}
      onSelect={(record) => { if (record.kind === 'impulse') showRecord(record); }}
      onDelete={(id) => { if (viewed?.id === id) startAgain(); setStatus('Assessment deleted.'); }} />
  </ToolDialog>;
}

function ScreeningExplanation({ result }: { result: ScreeningResult }) {
  const { t } = useLocale();
  const evidence = result.signals.filter((signal) => signal !== 'no-fomo-reported');
  return <>
    {result.outcome === 'red' && result.signals.includes('fomo-reported') &&
      <p><strong>{t('Could it be fear of missing out?')}</strong></p>}
    {evidence.length > 0 && <ul className="decision-reasons">{evidence.map((signal) =>
      <li key={signal}>{t(screeningEvidence[signal])}</li>)}</ul>}
    {result.outcome === 'yellow' && result.unanswered.length > 0 && <p>{t('Still to check: {questions}', {
      questions: result.unanswered.map((question) => t(screeningPrompts[question])).join(' '),
    })}</p>}
  </>;
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
