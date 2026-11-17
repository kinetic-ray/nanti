import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useState } from 'react';
import { safeProductUrl } from '../shared/wishlist.js';
import type { Currency, Item, ItemInput, Wishlist, WishlistSummary } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { DeleteForm, ItemForm, ListForm, PrivacyForm } from './forms.js';
import { LanguagePicker, LocaleProvider, useLocale } from './locale.js';
import type { Message } from './messages.js';
import type { IntelligenceDrafts, IntelligenceSelection } from './intelligence.js';
import './styles.css';

const PurchaseTools = lazy(() => import('./intelligence.js').then(({ PurchaseTools }) => ({ default: PurchaseTools })));

type Editor =
  | { kind: 'list'; list?: WishlistSummary }
  | { kind: 'item'; item?: Item; list: WishlistSummary }
  | { kind: 'privacy' }
  | { kind: 'delete'; list: WishlistSummary; item?: Item };

function App() {
  const { t, error, money, number } = useLocale();
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
  const [status, setStatus] = useState<Message | ''>('');

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

  function finish(message: Message) {
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
        <div className="brand-group">
          <span className="brand-symbol" aria-hidden="true" />
          <div><div className="brand">nanti<span>.</span></div>
            <span className="tagline">{t('Save it now. Decide later.')}</span></div>
        </div>
        <LanguagePicker />
      </header>
      <div className="workspace">
        <aside>
          <div className="rail-heading">
            <h2>{t('Wishlists')}</h2>
            <button disabled={!lists} onClick={() => setEditor({ kind: 'list' })}>{t('New wishlist')}</button>
          </div>
          {lists && lists.length > 0 && <nav aria-label={t('Your wishlists')}>
            {lists.map((entry) => <button key={entry.id} type="button"
              aria-current={entry.id === activeId ? 'true' : undefined} onClick={() => {
                if (entry.id !== activeId) { setSelectedId(entry.id); setDetailError(''); }
              }}>
              <span>{entry.name}</span><small>{entry.currency}</small>
            </button>)}
          </nav>}
          <p className="hint">{t('Your wishlists are private to this browser.')}</p>
          <button className="privacy-entry" disabled={!lists} onClick={() => setEditor({ kind: 'privacy' })}>{t('Privacy and history')}</button>
        </aside>
        <main>
          {sessionError ? <>
            <h1>{t('Your wishlists')}</h1><p role="alert" className="error">{error(sessionError)}</p>
            <button onClick={() => { setSessionError(''); setSessionAttempt((value) => value + 1); }}>{t('Try again')}</button>
          </> : !lists ? <p role="status">{t('Opening your wishlists…')}</p> : !selected ? <section className="empty">
            <h1>{t('Your wishlists')}</h1>
            <p>{t('Start a wishlist to keep links, quantities, and prices in one place.')}</p>
            <button className="primary" onClick={() => setEditor({ kind: 'list' })}>{t('Create a wishlist')}</button>
          </section> : <>
            <div className="list-heading">
              <h1>{selected.name}</h1>
              <div className="actions">
                <button onClick={() => setEditor({ kind: 'list', list: selected })}>{t('Rename')}</button>
                <button onClick={() => setEditor({ kind: 'delete', list: selected })}>{t('Delete wishlist')}</button>
              </div>
            </div>
            <div className="total">
              <div>
                <div className="total-label">{t('Known total')} <small>{selected.currency}</small></div>
                <strong>{list ? money(list.totalMinor, list.currency) : '—'}</strong>
                {list && list.unpriced > 0 && <div className="hint">
                  {t(list.unpriced === 1 ? '{n} product without a price' : '{n} products without a price', { n: number(list.unpriced) })}
                </div>}
              </div>
              <button className="primary" onClick={() => setEditor({ kind: 'item', list: selected })}>{t('Add product')}</button>
            </div>
            {list && <div className="actions decision-entry">
              <button type="button" onClick={() => setTools({ kind: 'comparison' })}>
                {t(list.items.length >= 2 ? 'Compare products' : 'Saved comparisons')}
              </button>
              <button type="button" onClick={() => setTools({ kind: 'timing' })}>
                {t(list.items.length ? 'Check wishlist timing' : 'Saved timing checks')}
              </button>
            </div>}
            {detailError ? <div><p className="error" role="alert">{error(detailError)}</p>
              <button onClick={refresh}>{t('Try again')}</button></div>
              : !list ? <p role="status">{t('Loading products…')}</p>
                : list.items.length === 0 ? <div className="empty"><h2>{t('No products yet')}</h2>
                  <p>{t('Add a product with a link or enter its details manually.')}</p></div>
                  : <ul className="products" aria-label={t('Saved products')}>
                    {list.items.map((item) => {
                      const link = item.url ? safeProductUrl(item.url) : null;
                      return <li key={item.id}>
                        <div className="product-info">
                          <span className="product-mark" aria-hidden="true">{Array.from(item.name)[0]?.toLocaleUpperCase()}</span>
                          <div><h2>{item.name}</h2>
                            {link && <a href={link.href} target="_blank" rel="noopener noreferrer">
                              {link.hostname} <span className="sr-only">({t('opens in a new tab')})</span>
                            </a>}
                          </div>
                        </div>
                        <div className="product-price">
                          <strong>{item.priceMinor === null ? t('No price') : money(item.priceMinor * item.quantity, list.currency)}</strong>
                          <span className="hint">{t('Qty {n}', { n: number(item.quantity) })}
                            {item.priceMinor !== null && item.quantity > 1 ? ` · ${t('{price} each', { price: money(item.priceMinor, list.currency) })}` : ''}
                          </span>
                        </div>
                        <div className="actions">
                          <button className="product-tools" type="button" aria-label={t('Purchase tools for {name}', { name: item.name })}
                            onClick={() => setTools({ kind: 'product', item })}>{t('Purchase tools')}</button>
                          <button aria-label={t('Edit {name}', { name: item.name })} onClick={() => setEditor({ kind: 'item', list, item })}>{t('Edit')}</button>
                          <button aria-label={t('Remove {name}', { name: item.name })} onClick={() => setEditor({ kind: 'delete', list, item })}>{t('Remove')}</button>
                        </div>
                      </li>;
                    })}
                  </ul>}
          </>}
          <p role="status" className="sr-only">{status && t(status)}</p>
        </main>
      </div>
      {editor?.kind === 'list' && <ListForm list={editor.list} close={() => setEditor(null)} save={saveList} />}
      {editor?.kind === 'item' && <ItemForm item={editor.item} currency={editor.list.currency}
        close={() => setEditor(null)} save={saveItem} />}
      {editor?.kind === 'delete' && <DeleteForm name={editor.item?.name ?? editor.list.name}
        wishlist={!editor.item} close={() => setEditor(null)} remove={remove} />}
      {editor?.kind === 'privacy' && <PrivacyForm close={() => setEditor(null)} cleared={() => {
        drafts.impulse.clear(); drafts.comparison.clear(); finish('Assessment data cleared.');
      }} />}
      {tools && list && <Suspense fallback={<p role="status" className="sr-only">{t('Opening purchase tools…')}</p>}>
        <PurchaseTools list={list} selection={tools} close={() => setTools(null)} drafts={drafts} />
      </Suspense>}
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<LocaleProvider><App /></LocaleProvider>);
