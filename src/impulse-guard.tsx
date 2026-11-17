import { useEffect, useId, useRef, useState } from 'react';
import { evaluateImpulse, impulseFactors, impulseRules } from '../shared/impulse.js';
import type { ImpulseAnswers, ImpulseResult } from '../shared/impulse.js';
import type { Preferences, SavedAssessment } from '../shared/intelligence.js';
import { api, errorMessage } from './api.js';
import { History, ToolDialog, useAssessmentHistory } from './intelligence-ui.js';

export function ImpulseGuard({ path, name, close, drafts }: {
  path: string; name: string; close: () => void; drafts: Map<string, ImpulseAnswers>;
}) {
  const [answers, setAnswers] = useState<ImpulseAnswers>(() => drafts.get(path) ?? {});
  const [step, setStep] = useState(0);
  const [viewed, setViewed] = useState<Extract<SavedAssessment, { kind: 'impulse' }> | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [preference, setPreference] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [days, setDays] = useState('');
  const [preferenceError, setPreferenceError] = useState('');
  const [status, setStatus] = useState('');
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
    if (step > 0 || viewed) heading.current?.focus();
  }, [step, viewed]);

  async function savePreference() {
    const value = days.trim() ? Number(days) : null;
    if (value !== null && (!/^\d+$/.test(days.trim()) || value < 1 || value > impulseRules.maximumCoolingOffDays)) {
      setPreferenceError(`Enter a whole number from 1 to ${impulseRules.maximumCoolingOffDays}, or leave it blank.`);
      return;
    }
    setBusy(true);
    setPreferenceError('');
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

  return <ToolDialog title="Impulse Guard" context={name} module="impulse" version={result?.version} close={close} busy={busy}>
    {result ? <section className="decision-section">
      <h3 ref={heading} tabIndex={-1}>{result.concern === 'Insufficient information' ? result.concern : `${result.concern} concern`}</h3>
      <ImpulseExplanation result={result} />
      <div className="actions">
        {viewed ? <>
          <button type="button" onClick={() => { setViewed(null); if (savedId) changeStep(0); setSavedId(null); }}>Back to my check</button>
          <button type="button" onClick={() => {
            setAnswers(viewed.input); setViewed(null); setSavedId(null); changeStep(0);
          }}>Retake assessment</button>
        </> : <>
          <button type="button" disabled={busy} onClick={() => changeStep(impulseFactors.length - 1)}>Review answers</button>
          <button type="button" className="primary" disabled={busy || history.busy} onClick={() => void saveResult()}>Save assessment</button>
        </>}
      </div>
    </section> : factor && <form className="decision-section" onSubmit={(event) => { event.preventDefault(); changeStep(step + 1); }}>
      <p className="hint">Question {step + 1} of {impulseFactors.length}</p>
      <h3 ref={heading} id={`${radioGroup}-question`} tabIndex={-1}>{factor.question}</h3>
      <fieldset className="answer-options" aria-labelledby={`${radioGroup}-question`}>
        {(['Yes', 'No', 'Skip for now'] as const).map((label, index) => {
          const value = index === 2 ? undefined : index === 0;
          return <label key={label} className="check-label">
            <input name={radioGroup} type="radio" checked={answers[factor.id] === value} onChange={() =>
              setAnswers((current) => ({ ...current, [factor.id]: value }))} />{label}
          </label>;
        })}
      </fieldset>
      <div className="actions">
        <button type="button" disabled={step === 0} onClick={() => changeStep(step - 1)}>Back</button>
        <button className="primary">{step === impulseFactors.length - 1 ? 'See result' : 'Next question'}</button>
      </div>
    </form>}
    <details className="decision-section">
      <summary>Waiting preference</summary>
      <p className="hint">Choose how many days you’d like to wait before looking at a purchase again.</p>
      <form onSubmit={(event) => { event.preventDefault(); void savePreference(); }}>
        <label>Cooling-off days <span className="optional">(optional)</span>
          <input value={days} disabled={!loaded || busy} inputMode="numeric" maxLength={3} onChange={(event) => setDays(event.target.value)} />
        </label>
        {preferenceError && <p className="error" role="alert">{preferenceError}</p>}
        <div className="actions">
          {loaded ? <button disabled={busy}>Save preference</button> : preferenceError ?
            <button type="button" onClick={() => { setPreferenceError(''); setRevision((current) => current + 1); }}>Try again</button>
            : <span role="status">Loading preference…</span>}
        </div>
      </form>
    </details>
    {error && <p className="error" role="alert">{error}</p>}
    <p className="decision-status" role="status">{status}</p>
    <History history={history} name="assessments" disabled={busy} onDelete={(id) => {
      if (viewed?.id === id) { setViewed(null); setSavedId(null); }
      setStatus('Assessment deleted.');
    }} onSelect={(record) => {
      if (record.kind === 'impulse') {
        setViewed(record); setSavedId(null); setStatus(''); setError('');
      }
    }} />
  </ToolDialog>;
}

function ImpulseExplanation({ result }: { result: ImpulseResult }) {
  const factors = result.contributing.flatMap((id) => impulseFactors.filter((factor) => factor.id === id));
  return <>
    <h4>Why this result?</h4>
    {factors.length ? <ul>{factors.map(({ id, reason }) => <li key={id}>{reason}</li>)}</ul>
      : <p>Your answers so far raised no contributing factors.</p>}
    {result.unanswered.length > 0 && <p>{result.unanswered.length} {result.unanswered.length === 1 ? 'question is' : 'questions are'} unanswered.
      {result.concern === 'Insufficient information' ? ' Answer more questions to narrow down the result.' : ' The remaining answers would leave this concern level the same.'}</p>}
    <h4>What could change the result?</h4>
    <p>{result.unanswered.length && result.concern === 'Insufficient information'
      ? 'Review the unanswered questions and check whether the same reasons still apply.'
      : 'Retake the check if your reasons change, for example after looking at another option or coming back later.'}</p>
    <h4>What you could do</h4>
    <ul>
      {factors.slice(0, 3).map(({ id, action }) => <li key={id}>{action}</li>)}
      <li>{result.coolingOffDays === null ? 'If you want more time, pick a day to check again.'
        : `If you’d like to wait, check again after your chosen ${result.coolingOffDays} ${result.coolingOffDays === 1 ? 'day' : 'days'}.`}</li>
    </ul>
  </>;
}
