import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useState } from 'react';
import { formatPrice, safeProductUrl } from '../shared/wishlist.js';
import type { Currency, Item, ItemInput, Wishlist, WishlistSummary } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { DeleteForm, ItemForm, ListForm } from './forms.js';
import type { IntelligenceDrafts, IntelligenceSelection } from './intelligence.js';
import './styles.css';

const PurchaseTools = lazy(() => import('./intelligence.js').then(({ PurchaseTools }) => ({ default: PurchaseTools })));

type Editor =
  | { kind: 'list'; list?: WishlistSummary }
  | { kind: 'item'; item?: Item; list: WishlistSummary }
  | { kind: 'delete'; list: WishlistSummary; item?: Item };

function App() {
  const [lists, setLists] = useState<WishlistSummary[] | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Wishlist | null>(null);
  const [detailError, setDetailError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tools, setTools] = useState<IntelligenceSelection | null>(null);
  const [drafts] = useState<IntelligenceDrafts>(() => ({ impulse: new Map(), comparison: new Map() }));
  const [status, setStatus] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api<WishlistSummary[]>('/session', { method: 'POST', signal: controller.signal }).then(
      setLists,
      (error: unknown) => { if (!controller.signal.aborted) setSessionError(errorMessage(error)); },
    );
    return () => controller.abort();
  }, [sessionAttempt]);

  const selected = lists?.find((list) => list.id === selectedId) ?? lists?.[0];
  const activeId = selected?.id;

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    api<Wishlist>(`/wishlists/${activeId}`, { signal: controller.signal }).then(
      setDetail,
      (error: unknown) => { if (!controller.signal.aborted) setDetailError(errorMessage(error)); },
    );
    return () => controller.abort();
  }, [activeId, revision]);

  function refresh() {
    setDetail(null);
    setDetailError('');
    setRevision((current) => current + 1);
  }

  function finish(message: string) {
    setEditor(null);
    setStatus(message);
  }

  async function saveList(name: string, currency: Currency) {
    const list = editor?.kind === 'list' ? editor.list : undefined;
    if (list) {
      await api(`/wishlists/${list.id}`, { method: 'PATCH', data: { name } });
      setLists((current) => current?.map((entry) => entry.id === list.id ? { ...entry, name: name.trim() } : entry) ?? []);
      finish('Wishlist renamed.');
      return;
    }
    const created = await api<WishlistSummary>('/wishlists', { method: 'POST', data: { name, currency } });
    setLists((current) => [...(current ?? []), created]);
    setSelectedId(created.id);
    setDetailError('');
    finish('Wishlist created.');
  }

  async function saveItem(data: ItemInput) {
    if (editor?.kind !== 'item') return;
    const { item, list } = editor;
    const endpoint = `/wishlists/${list.id}/items`;
    await api(item ? `${endpoint}/${item.id}` : endpoint, { method: item ? 'PUT' : 'POST', data });
    refresh();
    finish(item ? 'Product updated.' : 'Product added.');
  }

  async function remove() {
    if (editor?.kind !== 'delete') return;
    const { item, list } = editor;
    const endpoint = `/wishlists/${list.id}`;
    await api(item ? `${endpoint}/items/${item.id}` : endpoint, { method: 'DELETE' });
    if (!item) {
      setLists((current) => current?.filter((entry) => entry.id !== list.id) ?? []);
      setSelectedId(null);
    }
    refresh();
    finish(item ? 'Product removed.' : 'Wishlist deleted.');
  }

  const list = detail?.id === activeId ? detail : null;
  return (
    <div className="site">
      <header className="masthead">
        <div className="brand">nanti<span>.</span></div>
        <span className="tagline">Save what you want. Decide when to buy.</span>
      </header>
      <div className="workspace">
        <aside>
          <div className="rail-heading">
            <h2>Wishlists</h2>
            <button disabled={!lists} onClick={() => setEditor({ kind: 'list' })}>New wishlist</button>
          </div>
          {lists && lists.length > 0 && <nav aria-label="Your wishlists">
            {lists.map((entry) => <button key={entry.id} type="button"
              aria-current={entry.id === activeId ? 'true' : undefined} onClick={() => {
                if (entry.id !== activeId) { setSelectedId(entry.id); setDetailError(''); }
              }}>
              <span>{entry.name}</span><small>{entry.currency}</small>
            </button>)}
          </nav>}
          <p className="hint">Your wishlists are private to this browser.</p>
        </aside>
        <main>
          {sessionError ? <>
            <h1>Your wishlists</h1><p role="alert" className="error">{sessionError}</p>
            <button onClick={() => { setSessionError(''); setSessionAttempt((value) => value + 1); }}>Try again</button>
          </> : !lists ? <p role="status">Opening your wishlists…</p> : !selected ? <>
            <h1>Your wishlists</h1>
            <p>Start a wishlist to keep links, quantities, and prices in one place.</p>
            <button className="primary" onClick={() => setEditor({ kind: 'list' })}>Create a wishlist</button>
          </> : <>
            <div className="list-heading">
              <h1>{selected.name}</h1>
              <div className="actions">
                <button onClick={() => setEditor({ kind: 'list', list: selected })}>Rename</button>
                <button onClick={() => setEditor({ kind: 'delete', list: selected })}>Delete wishlist</button>
              </div>
            </div>
            <div className="total">
              <div>
                <div className="total-label">Known total <small>{selected.currency}</small></div>
                <strong>{list ? formatPrice(list.totalMinor, list.currency) : '—'}</strong>
                {list && list.unpriced > 0 && <div className="hint">
                  {list.unpriced} {list.unpriced === 1 ? 'product has' : 'products have'} no price yet
                </div>}
              </div>
              <button className="primary" onClick={() => setEditor({ kind: 'item', list: selected })}>Add product</button>
            </div>
            {list && list.items.length > 0 && <div className="actions decision-entry">
              {list.items.length >= 2 && <button type="button" onClick={() => setTools({ kind: 'comparison' })}>Compare products</button>}
              <button type="button" onClick={() => setTools({ kind: 'timing' })}>Check wishlist timing</button>
            </div>}
            {detailError ? <div><p className="error" role="alert">{detailError}</p>
              <button onClick={refresh}>Try again</button></div>
              : !list ? <p role="status">Loading products…</p>
                : list.items.length === 0 ? <p className="empty">Add a product with a link or enter its details manually.</p>
                  : <ul className="products" aria-label="Saved products">
                    {list.items.map((item) => {
                      const link = item.url ? safeProductUrl(item.url) : null;
                      return <li key={item.id}>
                        <div className="product-info">
                          <h2>{item.name}</h2>
                          {link && <a href={link.href} target="_blank" rel="noopener noreferrer">
                            {link.hostname} <span className="sr-only">(opens in a new tab)</span>
                          </a>}
                        </div>
                        <div className="product-price">
                          <strong>{item.priceMinor === null ? 'No price' : formatPrice(item.priceMinor * item.quantity, list.currency)}</strong>
                          <span className="hint">Qty {item.quantity}
                            {item.priceMinor !== null && item.quantity > 1 ? ` · ${formatPrice(item.priceMinor, list.currency)} each` : ''}
                          </span>
                        </div>
                        <div className="actions">
                          <button type="button" aria-label={`Purchase tools for ${item.name}`}
                            onClick={() => setTools({ kind: 'product', item })}>Purchase tools</button>
                          <button aria-label={`Edit ${item.name}`} onClick={() => setEditor({ kind: 'item', list, item })}>Edit</button>
                          <button aria-label={`Remove ${item.name}`} onClick={() => setEditor({ kind: 'delete', list, item })}>Remove</button>
                        </div>
                      </li>;
                    })}
                  </ul>}
          </>}
          <p role="status" className="sr-only">{status}</p>
        </main>
      </div>
      {editor?.kind === 'list' && <ListForm list={editor.list} close={() => setEditor(null)} save={saveList} />}
      {editor?.kind === 'item' && <ItemForm item={editor.item} currency={editor.list.currency}
        close={() => setEditor(null)} save={saveItem} />}
      {editor?.kind === 'delete' && <DeleteForm name={editor.item?.name ?? editor.list.name}
        wishlist={!editor.item} close={() => setEditor(null)} remove={remove} />}
      {tools && list && <Suspense fallback={<p role="status" className="sr-only">Opening purchase tools…</p>}>
        <PurchaseTools list={list} selection={tools} close={() => setTools(null)} drafts={drafts} />
      </Suspense>}
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
