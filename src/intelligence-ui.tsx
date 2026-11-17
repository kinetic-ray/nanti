import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AssessmentPage, ReviewChange, SavedAssessment } from '../shared/intelligence.js';
import type { IntelligenceModule, Methodology } from '../shared/methodology.js';
import type { TimingInput } from '../shared/purchase-timing.js';
import type { Currency } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { Dialog } from './forms.js';
import { useLocale } from './locale.js';
import { localizedMethodology } from './methodology-id.js';
import type { Message } from './messages.js';
import { Icon, Loading } from './visual.js';

export const financialLabels = {
  purchaseMinor: 'Full purchase cost', liquidMinor: 'Liquid funds',
  obligationsMinor: 'Essential upcoming obligations', reserveMinor: 'Protected reserve',
  extraMinor: 'Additional costs', monthlyMinor: 'Monthly savings', targetDate: 'Target date',
} as const satisfies Record<keyof TimingInput, Message>;

export function ToolDialog({ title, context, module, version, close, busy = false, wide = false, children }: {
  title: string; context: string; module: IntelligenceModule; version?: string; close: () => void;
  busy?: boolean; wide?: boolean; children: ReactNode;
}) {
  const { t } = useLocale();
  const [research, setResearch] = useState(false);
  return <Dialog title={title} busy={busy} close={close} focusHeading
    className={`decision tool-dialog${wide ? ' decision-wide' : ''}`}>
    <div className="decision-bar">
      <p className="hint">{context}</p>
      <div className="actions">
        <button type="button" className="methodology-entry" onClick={() => setResearch(true)}>{t('Research & Methodology')}</button>
        <button type="button" className="icon-button" aria-label={t('Close')} title={t('Close')} disabled={busy} onClick={close}>
          <Icon name="close" />
        </button>
      </div>
    </div>
    {children}
    {research && <MethodologyDialog module={module} version={version} close={() => setResearch(false)} />}
  </Dialog>;
}

function MethodologyDialog({ module, version, close }: {
  module: IntelligenceModule; version?: string; close: () => void;
}) {
  const { language, t, date, error: localError } = useLocale();
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
  const copy = method ? localizedMethodology(module, method, language) : null;
  return <Dialog title={t('Research & Methodology')} busy={false} close={close} focusHeading className="decision">
    <div className="form-actions"><button type="button" onClick={close}>{t('Close methodology')}</button></div>
    {error ? <div><p role="alert" className="error">{localError(error)}</p>
      <button type="button" onClick={() => { setError(''); setAttempt((value) => value + 1); }}>{t('Try again')}</button></div>
      : !copy ? <Loading label={t('Loading methodology…')} /> : <div className="methodology">
        <h3>{copy.title}</h3><p className="hint">{t('Version {version} · Updated {date}', { version: copy.version, date: date(copy.updated) })}</p>
        <p>{copy.purpose}</p>
        <h4>{t('Research concepts')}</h4><p>{copy.concepts}</p>
        <h4>{t('Inputs')}</h4><p>{copy.inputs}</p>
        <h4>{t('How Nanti calculates the result')}</h4><ul>{copy.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
        <h4>{t('Assumptions and limitations')}</h4><p>{copy.limitations}</p>
        <h4>{t('References')}</h4><ul>{copy.references.map(({ href, label }) =>
          <li key={href}><a href={href} target="_blank" rel="noopener noreferrer"><span lang="en">{label}</span>
            <span className="sr-only"> ({t('opens in a new tab')})</span></a></li>)}</ul>
      </div>}
  </Dialog>;
}

export function useAssessmentHistory(path: string) {
  const [page, setPage] = useState<AssessmentPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ signature: string; key: string } | null>(null);

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
    const signature = JSON.stringify(data);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    const saved = await api<SavedAssessment>(path, { method: 'POST', data, requestKey: pending.current.key });
    pending.current = null;
    setPage((current) => current && { ...current, records: [saved, ...current.records.filter(({ id }) => id !== saved.id)] });
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

  function markReview(id: string, review: ReviewChange[]) {
    setPage((current) => current && { ...current,
      records: current.records.map((record) => record.id === id ? { ...record, review } : record),
    });
  }

  return { page, busy, error, load, save, remove, markReview };
}

export function ReviewDetails({ changes, currency, label = 'Needs review' }: {
  changes?: ReviewChange[]; currency: Currency; label?: 'Needs review' | 'Changes since the previous check';
}) {
  const { t, number, money, date } = useLocale();
  if (!changes?.length) return null;
  return <div className="review-details">
    <p className="review-badge">{t(label)}</p>
    <ul>{changes.map((change, index) => {
      switch (change.kind) {
        case 'legacy': return <li key={index}>{t('This older result has no product snapshot. Check it again using today’s data.')}</li>;
        case 'methodology': return <li key={index}>{t('The calculation method has changed.')}</li>;
        case 'selection': return <li key={index}>{t('The selected products or alternative groups have changed.')}</li>;
        case 'preference': return <li key={index}>{t('The waiting preference has changed.')}</li>;
        case 'financial': return <li key={index}>{t('{field} differs from the previous check.', { field: t(financialLabels[change.field]) })}</li>;
        case 'planning': {
          const format = (value: string | null) => value === null ? t('Unknown') :
            change.field === 'targetDate' ? date(value) : money(value, currency);
          return <li key={index}>{t('{field} changed from {before} to {after}.', {
            field: t(change.field === 'purchaseMinor' ? 'User-supplied estimate' : financialLabels[change.field]),
            before: format(change.before), after: format(change.after),
          })}</li>;
        }
        case 'price':
        case 'quantity': {
          const format = (value: number | null) => value === null ? t('Unknown') :
            change.kind === 'price' ? money(value, currency) : number(value);
          return <li key={index}>{t('{name} · {field} changed from {before} to {after}.', {
            name: change.name, field: t(change.kind === 'price' ? 'Price' : 'Quantity'),
            before: format(change.before), after: format(change.after),
          })}</li>;
        }
      }
    })}</ul>
  </div>;
}

export function History({ history, name, onSelect, onDelete, disabled, initialOpen = false }: {
  history: ReturnType<typeof useAssessmentHistory>; name: Message;
  onSelect: (record: SavedAssessment) => void; onDelete: (id: string) => void; disabled?: boolean; initialOpen?: boolean;
}) {
  const { t, date, number, error: localError } = useLocale();
  const [open, setOpen] = useState(initialOpen);
  const [deletion, setDeletion] = useState<string | null>(null);
  const summary = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const previousButton = useRef<HTMLButtonElement>(null);
  const { page, busy, load, remove, error } = history;
  useLayoutEffect(() => { if (deletion) cancel.current?.focus(); }, [deletion]);
  useEffect(() => {
    if (open && !page && !busy && !error && !disabled) void load();
  }, [open, page, busy, error, disabled, load]);
  return <section className="decision-history">
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary ref={summary}>{t(name)}</summary>
      {open && <>
        {error && <p className="error" role="alert">{localError(error)}</p>}
        {busy && !page && <Loading label={t('Working…')} />}
        {busy && page && <p role="status">{t('Working…')}</p>}
        {!busy && !page && error && <button type="button" onClick={() => void load()}>{t('Try again')}</button>}
        {page?.records.length === 0 && <p className="hint">{t('No saved results here yet.')}</p>}
        {page && page.records.length > 0 && <ol className="history-list">
          {page.records.map((record) => <li key={record.id}>
            <div>
              <strong>{record.kind === 'impulse' ? t(record.result.concern) :
                record.kind === 'timing' ? t(record.result.status) : t('{n} products', { n: number(record.input.alternatives.length) })}</strong>
              <div className="hint"><time dateTime={record.createdAt}>{date(record.createdAt)}</time></div>
              {!!record.review?.length && <span className="review-badge">{t('Needs review')}</span>}
            </div>
            <div className="actions">
              {deletion === record.id ? <>
                <span>{t('Delete this saved result?')}</span>
                <button type="button" className="danger" disabled={busy || disabled} onClick={() => void remove(record.id).then((removed) => {
                  if (removed) {
                    setDeletion(null);
                    onDelete(record.id);
                    summary.current?.focus();
                  }
                })}>{t('Delete result')}</button>
                <button ref={cancel} type="button" disabled={busy} onClick={() => {
                  setDeletion(null);
                  requestAnimationFrame(() => previousButton.current?.focus());
                }}>{t('Cancel')}</button>
              </> : <>
                <button type="button" disabled={disabled} onClick={() => onSelect(record)}>{t('View result')}</button>
                <button ref={(element) => { if (element && element.dataset.target === previousButton.current?.dataset.target) previousButton.current = element; }}
                  data-target={record.id} type="button" disabled={busy || disabled}
                  onClick={(event) => { previousButton.current = event.currentTarget; setDeletion(record.id); }}>{t('Delete')}</button>
              </>}
            </div>
          </li>)}
        </ol>}
        {page?.next && <button type="button" disabled={busy || disabled} onClick={() => void load(page.next ?? undefined)}>{t('Load older results')}</button>}
      </>}
    </details>
  </section>;
}
