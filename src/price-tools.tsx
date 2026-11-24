import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { ItemPrices, PriceInbox, PriceSource, UserPriceSource } from '../shared/prices.js';
import { parsePrice } from '../shared/wishlist.js';
import type { Item } from '../shared/wishlist.js';
import { safeImportUrl } from '../shared/product-import.js';
import { api, errorMessage } from './api.js';
import { Dialog } from './forms.js';
import { useLocale } from './locale.js';
import { formatProductPriceInput, normalizeProductPriceInput } from './product-price-input.js';
import type { Message } from './messages.js';
import { Loading } from './visual.js';

const sourceLabel = {
  existing: 'Existing saved price',
  manual: 'Entered manually',
  imported_unverified: 'Copied from a listing · unverified',
  marketplace_verified: 'Verified marketplace price',
} as const satisfies Record<PriceSource, Message>;
const invalidPrice = 'Enter a price up to 21,474,836.47 with at most two decimal places.';

export function PriceDetails({ listId, item, close, onUpdate }: {
  listId: string; item: Item; close: () => void; onUpdate: () => void;
}) {
  const { t, money, date, number, language, error: localError } = useLocale();
  const path = `/wishlists/${listId}/items/${item.id}/prices`;
  const editorId = useId();
  const [page, setPage] = useState<ItemPrices | null>(null);
  const [editor, setEditor] = useState<'price' | 'target' | null>(null);
  const [price, setPrice] = useState('');
  const [source, setSource] = useState<UserPriceSource>('manual');
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<ItemPrices>(path, { signal: controller.signal }).then(setPage, failure => {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    });
    return () => controller.abort();
  }, [path, attempt]);

  function choose(mode: 'price' | 'target') {
    setError('');
    setStatus(null);
    if (editor === mode) { setEditor(null); return; }
    setEditor(mode);
    setSource('manual');
    setNotify(page?.target?.notify ?? true);
    const stored = mode === 'target' ? page?.target?.priceMinor : null;
    setPrice(stored == null ? '' : formatProductPriceInput((stored / 100).toFixed(2).replace('.', language === 'id' ? ',' : '.'), language));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const priceMinor = parsePrice(normalizeProductPriceInput(price, language));
    if (priceMinor === null) { setError(invalidPrice); return; }
    await run(async () => {
      if (editor === 'target') {
        await api(`${path}/target`, { method: 'PUT', data: { priceMinor, notify } });
        setStatus('Target price saved.');
      } else {
        const saved = await api<{ recorded: boolean }>(path, { method: 'POST', data: { priceMinor, source } });
        setStatus(saved.recorded ? 'Price recorded.' : 'This price is already recorded.');
        if (saved.recorded) onUpdate();
      }
      setEditor(null);
      setPage(await api<ItemPrices>(path));
    });
  }

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setStatus(null);
    try {
      await operation();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const current = page?.currentMinor;
  const previous = page?.previousMinor;
  const change = current != null && previous != null ? current - previous : 0;
  const head = page?.observations[0];
  const trend = page?.observations.slice(0, 12).toReversed() ?? [];
  const chartMax = Math.max(1, ...trend.map(row => row.priceMinor));
  const listing = item.url ? safeImportUrl(item.url) : null;
  return <Dialog title={t('Price history and alerts')} busy={busy} close={close} focusHeading className="decision price-details">
    <p className="hint">{item.name}</p>
    {error && <p role="alert" className="error">{localError(error)}</p>}
    {!page ? error ? <button type="button" onClick={() => {
      setError(''); setAttempt(value => value + 1);
    }}>{t('Try again')}</button> : <Loading label={t('Loading price history…')} /> : <>
      <section className="price-summary" aria-label={t('Current recorded unit price')}>
        <p>{t('Current recorded unit price')}</p>
        <strong>{current == null ? t('No price') : money(current, page.currency)}</strong>
        {current != null && head && <p className="hint">{t(sourceLabel[head.source])}</p>}
        {!!change && <p className="price-change">{t(change > 0 ? 'Up {price} from previous' : 'Down {price} from previous', {
          price: money(Math.abs(change), page.currency),
        })}</p>}
      </section>
      <div className="actions price-controls">
        <button type="button" className="primary" disabled={busy} aria-expanded={editor === 'price'} aria-controls={editorId}
          onClick={() => choose('price')}>{t('Record a price')}</button>
        <button type="button" disabled={busy} aria-expanded={editor === 'target'} aria-controls={editorId}
          onClick={() => choose('target')}>{t(page.target ? 'Edit target price' : 'Set target price')}</button>
      </div>
      <div id={editorId}>
        {editor && <form className="price-editor" onSubmit={submit} noValidate>
          <label>{t(editor === 'price' ? 'New unit price ({currency})' : 'Target unit price ({currency})', { currency: page.currency })}
            <input inputMode="decimal" maxLength={15} value={price} disabled={busy} onChange={event => setPrice(formatProductPriceInput(event.target.value, language))} />
          </label>
          {editor === 'price' && item.url && <label>{t('Price source')}
            <select value={source} disabled={busy} onChange={event => setSource(event.target.value as UserPriceSource)}>
              <option value="manual">{t(sourceLabel.manual)}</option>
              <option value="imported_unverified">{t(sourceLabel.imported_unverified)}</option>
            </select>
          </label>}
          {editor === 'target' && <label className="check-label">
            <input type="checkbox" disabled={busy} checked={notify} onChange={event => setNotify(event.target.checked)} />
            {t('Show in-app alerts for this product')}
          </label>}
          <div className="actions">
            <button className="primary" disabled={busy}>{t(editor === 'price' ? 'Save recorded price' : 'Save target price')}</button>
            {editor === 'target' && page.target && <button type="button" disabled={busy} onClick={() => void run(async () => {
              await api(`${path}/target`, { method: 'DELETE' });
              setEditor(null);
              setStatus('Target price removed.');
              setPage(await api<ItemPrices>(path));
            })}>{t('Remove target price')}</button>}
            <button type="button" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>{t('Cancel')}</button>
          </div>
        </form>}
      </div>
      {page.target && <div className="price-target">
        <strong>{t('Target price {price}', { price: money(page.target.priceMinor, page.currency) })}</strong>
        <p className="hint">{page.target.lastReachedAt
          ? t('Last reached {date}', { date: date(page.target.lastReachedAt) })
          : current != null && current <= page.target.priceMinor ? t('The current recorded price meets this target.')
          : t('Waiting for a recorded price at or below your target.')}</p>
        {!page.target.notify && <p className="hint">{t('In-app alerts are muted for this product.')}</p>}
      </div>}
      {status && <p className="decision-status" role="status">{t(status)}</p>}
      {busy && <p role="status">{t('Working…')}</p>}
      <section className="decision-section">
        <h3>{t('Recorded prices')}</h3>
        {head && <dl className="decision-metrics">
          <div><dt>{t('Lowest recorded')}</dt><dd>{money(page.lowestMinor!, page.currency)}</dd></div>
          <div><dt>{t('Highest recorded')}</dt><dd>{money(page.highestMinor!, page.currency)}</dd></div>
          <div><dt>{t('Last recorded')}</dt><dd>{date(head.observedAt)}</dd></div>
        </dl>}
        <p className="hint">{page.lastVerifiedAt
          ? t('Last verified marketplace check {date}', { date: date(page.lastVerifiedAt) })
          : t('No verified marketplace checks yet. Record prices after checking the listing.')}</p>
        {listing && <a className="buy-original" href={listing.href} target="_blank" rel="noopener noreferrer">
          {t('Open original listing')}<span className="sr-only"> ({t('opens in a new tab')})</span>
        </a>}
        {trend.length > 1 ? <figure className="price-chart">
          <figcaption>{t('Latest {n} recorded prices', { n: number(trend.length) })}</figcaption>
          <div className="price-chart-bars" aria-hidden="true">
            {trend.map(row => <div key={row.id}><span style={{ height: `${row.priceMinor / chartMax * 100}%` }} /></div>)}
          </div>
        </figure> : <p className="hint">{head ? t('Record another price to see the trend.') : t('Record a price to start tracking this product.')}</p>}
        {head && <ol className="price-log">
          {page.observations.map(row => <li key={row.id}>
            <div><strong>{money(row.priceMinor, row.currency)}</strong><span>{t(sourceLabel[row.source])}</span></div>
            <time dateTime={row.observedAt}>{date(row.observedAt)}</time>
          </li>)}
        </ol>}
        {page.next && <button type="button" disabled={busy} onClick={() => void run(async () => {
          const older = await api<ItemPrices>(`${path}?before=${page.next}`);
          setPage({ ...page, next: older.next, observations: [...page.observations, ...older.observations] });
        })}>{t('Load earlier prices')}</button>}
      </section>
    </>}
    <div className="form-actions"><button type="button" onClick={close} disabled={busy}>{t('Close')}</button></div>
  </Dialog>;
}

export function PriceAlerts({ close, onRead }: { close: () => void; onRead: () => void }) {
  const { t, money, date, error: localError } = useLocale();
  const [inbox, setInbox] = useState<PriceInbox | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<PriceInbox>('/prices/alerts', { signal: controller.signal }).then(setInbox, failure => {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    });
    return () => controller.abort();
  }, [attempt]);

  async function markRead() {
    setBusy(true);
    setError('');
    try {
      await api('/prices/alerts', { method: 'PATCH' });
      setInbox(await api<PriceInbox>('/prices/alerts'));
      onRead();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={t('Price alerts')} busy={busy} close={close} focusHeading className="decision price-inbox">
    {error && <p role="alert" className="error">{localError(error)}</p>}
    {!inbox ? error ? <button type="button" onClick={() => {
      setError(''); setAttempt(value => value + 1);
    }}>{t('Try again')}</button> : <Loading label={t('Loading price alerts…')} /> :
      !inbox.alerts.length ? <p>{t('Set a target price on a saved product to receive an alert here.')}</p> : <>
        {inbox.unread > 0 && <button type="button" disabled={busy} onClick={() => void markRead()}>{t('Mark all as read')}</button>}
        <ul className="price-alerts-list">
          {inbox.alerts.map(({ id, itemName, targetMinor, readAt, observation }) => <li key={id}>
            <h3>{itemName}</h3>
            {!readAt && <span className="price-unread">{t('Unread')}</span>}
            <p>{t('Target reached at {price}', { price: money(observation.priceMinor, observation.currency) })}</p>
            <p className="hint">{t('Target price {price}', { price: money(targetMinor, observation.currency) })}</p>
            <p className="hint">{t(sourceLabel[observation.source])} <time dateTime={observation.observedAt}>{date(observation.observedAt)}</time></p>
          </li>)}
        </ul>
      </>}
    <div className="form-actions"><button type="button" onClick={close} disabled={busy}>{t('Close')}</button></div>
  </Dialog>;
}
