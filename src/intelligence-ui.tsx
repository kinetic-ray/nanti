import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AssessmentPage, SavedAssessment } from '../shared/intelligence.js';
import type { IntelligenceModule } from '../shared/methodology.js';
import { getMethodology } from '../shared/methodology.js';
import { api, errorMessage } from './api.js';
import { Dialog } from './forms.js';

type Methodology = NonNullable<ReturnType<typeof getMethodology>>;

export function ToolDialog({ title, context, module, version, close, busy = false, wide = false, children }: {
  title: string; context: string; module: IntelligenceModule; version?: string; close: () => void;
  busy?: boolean; wide?: boolean; children: ReactNode;
}) {
  const [research, setResearch] = useState(false);
  return <Dialog title={title} busy={busy} close={close} focusHeading className={wide ? 'decision decision-wide' : 'decision'}>
    <div className="decision-bar">
      <p className="hint">{context}</p>
      <div className="actions">
        <button type="button" onClick={() => setResearch(true)}><span aria-hidden="true">ⓘ</span> Research &amp; Methodology</button>
        <button type="button" disabled={busy} onClick={close}>Close</button>
      </div>
    </div>
    {children}
    {research && <MethodologyDialog module={module} version={version} close={() => setResearch(false)} />}
  </Dialog>;
}

function MethodologyDialog({ module, version, close }: {
  module: IntelligenceModule; version?: string; close: () => void;
}) {
  const [method, setMethod] = useState<Methodology | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const path = `/intelligence/methodology/${module}${version ? `/${version}` : ''}`;
    api<Methodology>(path, { signal: controller.signal }).then(setMethod, (failure: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    });
    return () => controller.abort();
  }, [module, version, attempt]);
  return <Dialog title="Research & Methodology" busy={false} close={close} focusHeading className="decision">
    <div className="form-actions"><button type="button" onClick={close}>Close methodology</button></div>
    {error ? <div><p role="alert" className="error">{error}</p>
      <button type="button" onClick={() => { setError(''); setAttempt((value) => value + 1); }}>Try again</button></div>
      : !method ? <p role="status">Loading methodology…</p> : <div className="methodology">
        <h3>{method.title}</h3><p className="hint">Version {method.version} · Updated <time dateTime={method.updated}>{method.updated}</time></p>
        <p>{method.purpose}</p>
        <h4>Research concepts</h4><p>{method.concepts}</p>
        <h4>Inputs</h4><p>{method.inputs}</p>
        <h4>How Nanti calculates the result</h4><ul>{method.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
        <h4>Assumptions and limitations</h4><p>{method.limitations}</p>
        <h4>References</h4><ul>{method.references.map(({ href, label }) =>
          <li key={href}><a href={href} target="_blank" rel="noopener noreferrer">{label}
            <span className="sr-only"> (opens in a new tab)</span></a></li>)}</ul>
      </div>}
  </Dialog>;
}

export function useAssessmentHistory(path: string) {
  const [page, setPage] = useState<AssessmentPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (before?: string) => {
    setBusy(true);
    setError('');
    try {
      const suffix = before ? `?before=${encodeURIComponent(before)}` : '';
      const loaded = await api<AssessmentPage>(path + suffix);
      setPage((current) => before && current ? { ...loaded, records: [...current.records, ...loaded.records] } : loaded);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }, [path]);

  async function save(data: unknown) {
    const saved = await api<SavedAssessment>(path, { method: 'POST', data });
    setPage((current) => current && { ...current, records: [saved, ...current.records] });
    return saved;
  }

  async function remove(recordId: string) {
    setBusy(true);
    setError('');
    try {
      await api(`${path}/${recordId}`, { method: 'DELETE' });
      setPage((current) => current && { ...current, records: current.records.filter(({ id }) => id !== recordId) });
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { page, busy, error, load, save, remove };
}

export function History({ history, name, onSelect, disabled }: {
  history: ReturnType<typeof useAssessmentHistory>; name: string;
  onSelect: (record: SavedAssessment) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [deletion, setDeletion] = useState<string | null>(null);
  const summary = useRef<HTMLElement>(null);
  const { page, busy, load, remove, error } = history;
  useEffect(() => {
    if (open && !page && !busy && !error && !disabled) void load();
  }, [open, page, busy, error, disabled, load]);
  return <section className="decision-history">
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary ref={summary}>Saved {name}</summary>
      {open && <>
        {error && <p className="error" role="alert">{error}</p>}
        {busy && <p role="status">Working…</p>}
        {!busy && !page && error && <button type="button" onClick={() => void load()}>Try again</button>}
        {page?.records.length === 0 && <p className="hint">You have no saved {name} here yet.</p>}
        {page && page.records.length > 0 && <ul className="history-list">
          {page.records.map((record) => <li key={record.id}>
            <div>
              <strong>{record.kind === 'impulse' ? record.result.concern : `${record.input.alternatives.length} products`}</strong>
              <div className="hint"><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString()}</time></div>
            </div>
            <div className="actions">
              {deletion === record.id ? <>
                <span>Delete this saved result?</span>
                <button type="button" disabled={busy || disabled} onClick={() => void remove(record.id).then((removed) => {
                  if (removed) {
                    setDeletion(null);
                    summary.current?.focus();
                  }
                })}>Delete result</button>
                <button type="button" disabled={busy} onClick={() => {
                  setDeletion(null);
                  requestAnimationFrame(() => summary.current?.focus());
                }}>Cancel</button>
              </> : <>
                <button type="button" disabled={disabled} onClick={() => onSelect(record)}>View result</button>
                <button type="button" disabled={busy || disabled} onClick={() => setDeletion(record.id)}>Delete</button>
              </>}
            </div>
          </li>)}
        </ul>}
        {page?.next && <button type="button" disabled={busy || disabled} onClick={() => void load(page.next ?? undefined)}>Load older results</button>}
      </>}
    </details>
  </section>;
}
