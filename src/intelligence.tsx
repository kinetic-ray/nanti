import { useState } from 'react';
import type { ScreeningAnswers } from '../shared/screening.js';
import type { Item, Wishlist, WishlistSummary } from '../shared/wishlist.js';
import { Dialog } from './forms.js';
import { ImpulseGuard } from './impulse-guard.js';
import { PurchaseTiming } from './purchase-timing.js';
import { ValueRanker } from './value-ranker.js';
import { useLocale } from './locale.js';
import { BuyLink } from './buy-link.js';
import { Icon, ProductMedia } from './visual.js';
import { safeProductUrl } from '../shared/wishlist.js';
import { PriceDetails } from './price-tools.js';

export type IntelligenceSelection =
  | { kind: 'product'; item: Item }
  | { kind: 'comparison' }
  | { kind: 'timing' };

export type IntelligenceDrafts = { impulse: Map<string, ScreeningAnswers> };

export function PurchaseTools({ list, lists, selection, close, drafts, onPriceUpdate }: {
  list: Wishlist; lists: WishlistSummary[]; selection: IntelligenceSelection; close: () => void; drafts: IntelligenceDrafts; onPriceUpdate: () => void;
}) {
  const path = `/intelligence/wishlists/${list.id}`;
  if (selection.kind === 'comparison') return <ValueRanker list={list} lists={lists} path={path} close={close} />;
  if (selection.kind === 'timing') return <PurchaseTiming list={list} path={path} close={close} />;
  const item = list.items.find(entry => entry.id === selection.item.id) ?? selection.item;
  return <ProductDetails list={list} item={item} path={`${path}/items/${item.id}`} close={close}
    drafts={drafts.impulse} onPriceUpdate={onPriceUpdate} />;
}

function ProductDetails({ list, item, path, close, drafts, onPriceUpdate }: {
  list: Wishlist; item: Item; path: string; close: () => void; drafts: IntelligenceDrafts['impulse']; onPriceUpdate: () => void;
}) {
  const { t, money, number } = useLocale();
  const [tool, setTool] = useState<'impulse' | 'timing' | 'prices' | null>(null);
  const merchant = item.url ? safeProductUrl(item.url) : null;
  return <Dialog title={item.name} busy={false} close={close} focusHeading className="decision product-dialog">
    <div className="product-overview">
      <ProductMedia item={item} listId={list.id} />
      <div className="product-facts">
        <p className="hint">{list.name}</p>
        <strong>{item.priceMinor === null ? t('Price unknown') :
          money((BigInt(item.priceMinor) * BigInt(item.quantity)).toString(), list.currency)}</strong>
        <p className="hint">{t('Qty {n}', { n: number(item.quantity) })}
          {item.priceMinor !== null && item.quantity > 1 &&
            ` · ${t('{price} each', { price: money(item.priceMinor, list.currency) })}`}</p>
        {merchant && <a href={merchant.href} className="merchant" target="_blank" rel="noopener noreferrer">
          {merchant.hostname.replace(/^www\./u, '')}
          <span className="sr-only"> ({t('opens in a new tab')})</span>
        </a>}
      </div>
    </div>
    <BuyLink key={item.url ?? item.id} listId={list.id} item={item} />
    <h3 className="product-decision-title">{t('Purchase decisions')}</h3>
    <div className="product-decision-tools">
      <button type="button" onClick={() => setTool('impulse')}><Icon name="bookmark" />{t('Check buying reasons')}<Icon name="arrow" /></button>
      <button type="button" onClick={() => setTool('timing')}><Icon name="clock" />{t('Check purchase readiness')}<Icon name="arrow" /></button>
      <button type="button" onClick={() => setTool('prices')}><Icon name="bell" />{t('Price history and alerts')}<Icon name="arrow" /></button>
    </div>
    <div className="form-actions detail-footer"><button type="button" onClick={close}>{t('Close')}</button></div>
    {tool === 'prices' && <PriceDetails listId={list.id} item={item} close={() => setTool(null)} onUpdate={onPriceUpdate} />}
    {tool === 'impulse' && <ImpulseGuard path={path} name={item.name} currency={list.currency} close={() => setTool(null)} drafts={drafts} />}
    {tool === 'timing' && <PurchaseTiming list={list} item={item} path={path} close={() => setTool(null)} />}
  </Dialog>;
}
