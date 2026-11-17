import { useEffect, useState } from 'react';
import type { PurchaseDestination } from '../shared/affiliate.js';
import { safeProductUrl } from '../shared/wishlist.js';
import type { Item } from '../shared/wishlist.js';
import { api } from './api.js';
import { useLocale } from './locale.js';

export function BuyLink({ listId, item }: { listId: string; item: Item }) {
  const { t, language } = useLocale();
  const [destination, setDestination] = useState<PurchaseDestination | null>(null);
  const original = item.url ? safeProductUrl(item.url)?.href ?? null : null;
  const path = `/wishlists/${listId}/items/${item.id}/purchase`;

  useEffect(() => {
    if (!original) return;
    const controller = new AbortController();
    api<PurchaseDestination>(path, { signal: controller.signal }).then(
      (result) => { if (!controller.signal.aborted) setDestination(result); },
      () => { if (!controller.signal.aborted) setDestination({ originalUrl: original, affiliatePath: null }); },
    );
    return () => controller.abort();
  }, [original, path]);

  const available = destination && destination.originalUrl === original && destination.affiliatePath?.startsWith(`/api${path}/open?`)
    ? destination.affiliatePath : null;
  const href = available ? `${available}&lang=${language}` : original;
  return <div className="buy-link">
    <div className="actions">
      {href && destination ? <a className="buy-action" href={href} target="_blank"
        rel={available ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}>
        {t('Buy product')}<span className="sr-only"> ({t('opens in a new tab')})</span>
      </a> : <button type="button" className="primary" disabled>{t('Buy product')}</button>}
      {available && original && <a className="buy-original" href={original} target="_blank" rel="noopener noreferrer">
        {t('Open original listing')}<span className="sr-only"> ({t('opens in a new tab')})</span>
      </a>}
    </div>
    {available && <p className="hint">{t('Nanti may earn a commission through this link, at no additional charge from Nanti.')}</p>}
    {original && !destination && <p className="hint" role="status">{t('Checking the purchase link…')}</p>}
    {!original && <p className="hint">{t('Add a product link to use this action.')}</p>}
  </div>;
}
