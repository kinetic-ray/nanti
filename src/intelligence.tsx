import { useState } from 'react';
import type { ImpulseAnswers } from '../shared/impulse.js';
import type { ComparisonInput } from '../shared/value-ranker.js';
import { formatPrice } from '../shared/wishlist.js';
import type { Item, Wishlist } from '../shared/wishlist.js';
import { Dialog } from './forms.js';
import { ImpulseGuard } from './impulse-guard.js';
import { PurchaseTiming } from './purchase-timing.js';
import { ValueRanker } from './value-ranker.js';

export type IntelligenceSelection =
  | { kind: 'product'; item: Item }
  | { kind: 'comparison' }
  | { kind: 'timing' };

export type IntelligenceDrafts = { impulse: Map<string, ImpulseAnswers>; comparison: Map<string, ComparisonInput> };

export function PurchaseTools({ list, selection, close, drafts }: {
  list: Wishlist; selection: IntelligenceSelection; close: () => void; drafts: IntelligenceDrafts;
}) {
  const path = `/intelligence/wishlists/${list.id}`;
  if (selection.kind === 'comparison') return <ValueRanker list={list} path={path} close={close} drafts={drafts.comparison} />;
  if (selection.kind === 'timing') return <PurchaseTiming list={list} path={path} close={close} />;
  return <ProductDetails list={list} item={selection.item} path={`${path}/items/${selection.item.id}`} close={close} drafts={drafts.impulse} />;
}

function ProductDetails({ list, item, path, close, drafts }: {
  list: Wishlist; item: Item; path: string; close: () => void; drafts: IntelligenceDrafts['impulse'];
}) {
  const [tool, setTool] = useState<'impulse' | 'timing' | null>(null);
  return <Dialog title={item.name} busy={false} close={close} focusHeading className="decision">
    <p className="hint">{list.name}</p>
    <p>Quantity {item.quantity} · {item.priceMinor === null ? 'Price unknown' :
      formatPrice((BigInt(item.priceMinor) * BigInt(item.quantity)).toString(), list.currency)}</p>
    <div className="actions">
      <button type="button" onClick={() => setTool('impulse')}>Check buying impulse</button>
      <button type="button" onClick={() => setTool('timing')}>Check purchase timing</button>
      <button type="button" onClick={close}>Close</button>
    </div>
    {tool === 'impulse' && <ImpulseGuard path={path} name={item.name} close={() => setTool(null)} drafts={drafts} />}
    {tool === 'timing' && <PurchaseTiming list={list} item={item} path={path} close={() => setTool(null)} />}
  </Dialog>;
}
