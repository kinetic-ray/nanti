import { useEffect, useRef, useState } from 'react';
import type { Currency } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { useLocale } from './locale.js';
import { Icon } from './visual.js';

type Notice = {
  id: string; readAt: string | null; createdAt: string;
  request: { productName: string };
  product: { id: string; title: string; url: string; priceMinor: number | null; currency: Currency };
};
export function RecommendationInbox({ close, focusOnOpen }: { close: () => void; focusOnOpen: boolean }) {
  const { t, money, error: localizeError } = useLocale();
  const heading = useRef<HTMLHeadingElement>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (focusOnOpen) heading.current?.focus();
  }, [focusOnOpen]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<{ notices: Notice[] }>('/recommendations/notifications', { signal: controller.signal })
      .then(result => { setNotices(result.notices); setError(''); }, failure => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  async function markRead(id: string, trigger?: HTMLButtonElement) {
    try {
      await api(`/recommendations/notifications/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
      });
      if (trigger && trigger === trigger.ownerDocument.activeElement) {
        const productLink = trigger.parentElement?.querySelector<HTMLAnchorElement>('a[href]');
        (productLink ?? heading.current)?.focus();
      }
      setNotices(current => current.map(notice =>
        notice.id === id ? { ...notice, readAt: new Date().toISOString() } : notice));
    } catch (failure) { setError(errorMessage(failure)); }
  }
  return <section className="recommendation-inbox" aria-labelledby="recommendation-heading">
    <div className="recommendation-heading">
      <h2 id="recommendation-heading" ref={heading} tabIndex={-1}>{t('Alternative updates')}</h2>
      <div className="recommendation-status" role="status">
        {loading ? t('Loading alternative updates…') : !error && notices.length === 0 && t('No alternative updates yet.')}
      </div>
    </div>
    <button type="button" className="icon-button recommendation-close" onClick={close}
      aria-label={t('Close alternative updates')}><Icon name="close" /></button>
    {error && <div className="recommendation-details">
      <p role="alert">{localizeError(error)}</p>
      <button type="button" onClick={() => setReload(value => value + 1)}>{t('Try again')}</button>
    </div>}
    {notices.length > 0 && <div className="recommendation-details">
      <p>{t('Check the price and whether it fits your needs before buying.')}</p>
      <ul className="recommendation-list">
        {notices.map(notice => <li key={notice.id}>
          <h3>{notice.product.title}</h3>
          <p>{t('Alternative for {product}', { product: notice.request.productName })}</p>
          {notice.product.priceMinor !== null && <strong>{money(notice.product.priceMinor, notice.product.currency)}</strong>}
          <div className="actions recommendation-actions">
            <a href={notice.product.url} target="_blank" rel="noopener noreferrer"
              onClick={() => { if (!notice.readAt) void markRead(notice.id); }}>
              {t('View product')}<span className="sr-only"> ({t('opens in a new tab')})</span>
            </a>
            {!notice.readAt && <button type="button" onClick={event =>
              void markRead(notice.id, event.currentTarget)}>{t('Mark as read')}</button>}
          </div>
        </li>)}
      </ul>
    </div>}
  </section>;
}
