import { useEffect, useId, useRef, useState } from 'react';
import { evaluateImpulse, factorsForImpulseVersion, impulseFactors, impulseRules } from '../shared/impulse.js';
import type { ImpulseAnswers, ImpulseResult } from '../shared/impulse.js';
import type { Preferences, SavedAssessment } from '../shared/intelligence.js';
import type { Currency } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { History, ReviewDetails, ToolDialog, useAssessmentHistory } from './intelligence-ui.js';
import { useLocale } from './locale.js';
import { impulseCopy } from './methodology-id.js';
import type { Message } from './messages.js';

const concernLabels = { Low: 'Low concern', Moderate: 'Moderate concern', High: 'High concern',
  'Insufficient information': 'Insufficient information' } as const;

export function ImpulseGuard({ path, name, currency, close, drafts }: {
  path: string; name: string; currency: Currency; close: () => void; drafts: Map<string, ImpulseAnswers>;
}) {
  const { t, number, language, error: localError } = useLocale();
  const [answers, setAnswers] = useState<ImpulseAnswers>(() => drafts.get(path) ?? {});
  const [step, setStep] = useState(0);
  const [viewed, setViewed] = useState<Extract<SavedAssessment, { kind: 'impulse' }> | null>(null);
  const [previous, setPrevious] = useState<Extract<SavedAssessment, { kind: 'impulse' }> | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [preference, setPreference] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [days, setDays] = useState('');
  const [preferenceError, setPreferenceError] = useState('');
  const [badDays, setBadDays] = useState(false);
  const [status, setStatus] = useState<Message | ''>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const radioGroup = useId();
  const history = useAssessmentHistory(`${path}/impulse`);
  const factor = impulseFactors[step];
  const result = viewed?.result ?? (factor ? null : evaluateImpulse(answers, preference));

  useEffect(() => { drafts.set(path, answers); }, [drafts, path, answers]);
  useEffect(() => {
    const controller = new AbortController();
    api<Preferences>('/intelligence/preferences', { signal: controller.signal }).then(({ coolingOffDays }) => {
      setPreference(coolingOffDays);
      setDays(coolingOffDays?.toString() ?? '');
      setLoaded(true);
    }, (failure: unknown) => {
      if (!controller.signal.aborted) setPreferenceError(errorMessage(failure));
    });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (step > 0 || viewed || previous) heading.current?.focus();
  }, [step, viewed, previous]);

  async function savePreference() {
    const value = days.trim() ? Number(days) : null;
    if (value !== null && (!/^\d+$/.test(days.trim()) || value < 1 || value > impulseRules.maximumCoolingOffDays)) {
      setBadDays(true);
      return;
    }
    setBusy(true);
    setPreferenceError('');
    setBadDays(false);
    setStatus('');
    try {
      await api('/intelligence/preferences', { method: 'PUT', data: { coolingOffDays: value } });
      setPreference(value);
      setStatus('Waiting preference saved.');
    } catch (failure) {
      setPreferenceError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function saveResult() {
    setBusy(true);
    setError('');
    try {
      const saved = await history.save(answers);
      if (saved.kind === 'impulse') {
        setViewed(saved);
        setSavedId(saved.id);
      }
      setStatus('Assessment saved.');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function changeStep(next: number) {
    setStep(next);
    setError('');
    setStatus('');
    if (next === 0) requestAnimationFrame(() => heading.current?.focus());
  }

  return <ToolDialog title={t('Impulse Guard')} context={name} module="impulse" version={result?.version} close={close} busy={busy}>
    {previous && <div className="review-details">
      <details>
        <summary>{t('Previous result')} · {t(concernLabels[previous.result.concern])}</summary>
        <ImpulseExplanation result={previous.result} />
      </details>
      <ReviewDetails changes={previous.review} currency={currency} />
      <p>{t('Your previous result stays in history. Confirm the details before checking again.')}</p>
    </div>}
    {result ? <section className="decision-section">
      <h3 ref={heading} tabIndex={-1}>{t(previous ? 'Current result' : concernLabels[result.concern])}</h3>
      {previous && <strong>{t(concernLabels[result.concern])}</strong>}
      <ReviewDetails changes={viewed?.review} currency={currency} />
      <ImpulseExplanation result={result} />
      <div className="actions">
        {viewed ? <>
          <button type="button" onClick={() => {
            setViewed(null); setPrevious(null); changeStep(savedId ? 0 : step); setSavedId(null);
            requestAnimationFrame(() => heading.current?.focus());
          }}>{t('Back to my check')}</button>
          <button type="button" onClick={() => {
            const { temporary: _temporary, ...priorAnswers } = viewed.input;
            setAnswers(priorAnswers); setPrevious(viewed); setViewed(null); setSavedId(null); changeStep(0);
          }}>{t('Retake assessment')}</button>
        </> : <>
          <button type="button" disabled={busy} onClick={() => changeStep(impulseFactors.length - 1)}>{t('Review answers')}</button>
          <button type="button" className="primary" disabled={busy || history.busy} onClick={() => void saveResult()}>{t('Save assessment')}</button>
        </>}
      </div>
    </section> : factor && <form className="decision-section" onSubmit={(event) => { event.preventDefault(); changeStep(step + 1); }}>
      <p className="hint">{t('Question {n} of {total}', { n: number(step + 1), total: number(impulseFactors.length) })}</p>
      <h3 ref={heading} id={`${radioGroup}-question`} tabIndex={-1}>{impulseCopy(language, factor).question}</h3>
      <fieldset className="answer-options" aria-labelledby={`${radioGroup}-question`}>
        {(['Yes', 'No', 'Skip for now'] as const).map((label, index) => {
          const value = index === 2 ? undefined : index === 0;
          return <label key={label} className="check-label">
            <input name={radioGroup} type="radio" checked={answers[factor.id] === value} onChange={() =>
              setAnswers((current) => ({ ...current, [factor.id]: value }))} />{t(label)}
          </label>;
        })}
      </fieldset>
      <div className="actions">
        <button type="button" disabled={step === 0} onClick={() => changeStep(step - 1)}>{t('Back')}</button>
        <button className="primary">{t(step === impulseFactors.length - 1 ? 'See result' : 'Next question')}</button>
      </div>
    </form>}
    <details className="decision-section">
      <summary>{t('Waiting preference')}</summary>
      <p className="hint">{t('Choose how many days you’d like to wait before looking at a purchase again.')}</p>
      <form onSubmit={(event) => { event.preventDefault(); void savePreference(); }}>
        <label>{t('Cooling-off days')} <span className="optional">{t('(optional)')}</span>
          <input value={days} disabled={!loaded || busy} inputMode="numeric" maxLength={3} onChange={(event) => {
            setBadDays(false); setDays(event.target.value);
          }} />
        </label>
        {(badDays || preferenceError) && <p className="error" role="alert">{badDays
          ? t('Enter a whole number from 1 to {max}, or leave it blank.', { max: number(impulseRules.maximumCoolingOffDays) })
          : localError(preferenceError)}</p>}
        <div className="actions">
          {loaded ? <button disabled={busy}>{t('Save preference')}</button> : preferenceError ?
            <button type="button" onClick={() => { setPreferenceError(''); setRevision((current) => current + 1); }}>{t('Try again')}</button>
            : <span role="status">{t('Loading preference…')}</span>}
        </div>
      </form>
    </details>
    {error && <p className="error" role="alert">{localError(error)}</p>}
    <p className="decision-status" role="status">{status && t(status)}</p>
    <History history={history} name="Saved assessments" disabled={busy} onDelete={(id) => {
      if (viewed?.id === id) { setViewed(null); setSavedId(null); }
      if (previous?.id === id) setPrevious(null);
      setStatus('Assessment deleted.');
    }} onSelect={(record) => {
      if (record.kind === 'impulse') {
        setViewed(record); setPrevious(null); setSavedId(null); setStatus(''); setError('');
      }
    }} />
  </ToolDialog>;
}

function ImpulseExplanation({ result }: { result: ImpulseResult }) {
  const { t, language, number } = useLocale();
  const version = factorsForImpulseVersion(result.version);
  const factors = result.contributing.flatMap((id) => version.filter((factor) => factor.id === id))
    .map((factor) => impulseCopy(language, factor));
  return <>
    <h4>{t('Why this result?')}</h4>
    {factors.length ? <ul>{factors.map(({ id, reason }) => <li key={id}>{reason}</li>)}</ul>
      : <p>{t('Your answers so far raised no contributing factors.')}</p>}
    {result.unanswered.length > 0 && <p>{t(result.unanswered.length === 1 ? '{n} question unanswered.' :
      '{n} questions unanswered.', { n: number(result.unanswered.length) })}{' '}
      {t(result.concern === 'Insufficient information' ? 'Answer more questions to narrow down the result.' :
        'The remaining answers would leave this concern level the same.')}</p>}
    <h4>{t('What could change the result?')}</h4>
    <p>{t(result.unanswered.length && result.concern === 'Insufficient information'
      ? 'Review the unanswered questions and check whether the same reasons still apply.'
      : 'Retake the check if your reasons change, for example after looking at another option or coming back later.')}</p>
    <h4>{t('What you could do')}</h4>
    <ul>
      {factors.slice(0, 3).map(({ id, action }) => <li key={id}>{action}</li>)}
      <li>{result.coolingOffDays === null ? t('If you want more time, pick a day to check again.')
        : t(result.coolingOffDays === 1 ? 'If you’d like to wait, check again after your chosen {days} day.' :
          'If you’d like to wait, check again after your chosen {days} days.', { days: number(result.coolingOffDays) })}</li>
    </ul>
  </>;
}
