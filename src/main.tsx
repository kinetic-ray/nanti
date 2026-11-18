import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useState } from 'react';
import { safeProductUrl } from '../shared/wishlist.js';
import { sharedProductLink } from './share-target.js';
import type { Currency, Item, ItemWriteInput, Wishlist, WishlistSummary } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { DeleteForm, ItemForm, ListForm, PrivacyForm } from './forms.js';
import { LanguagePicker, LocaleProvider, useLocale } from './locale.js';
import type { Message } from './messages.js';
import type { IntelligenceDrafts, IntelligenceSelection } from './intelligence.js';
import { AccountDialog, announceAuthChange, authChangeKey, authNotices } from './account.js';
import type { AuthNotice } from './account.js';
import type { AccountStatus } from '../shared/account.js';
import type { PriceInbox } from '../shared/prices.js';
import { BookmarkArt, Icon, Loading, ProductMedia } from './visual.js';
import './styles.css';
import './consumer.css';

const PurchaseTools = lazy(() => import('./intelligence.js').then(({ PurchaseTools }) => ({ default: PurchaseTools })));
const AdminCenter = lazy(() => import('./admin.js').then(({ AdminCenter }) => ({ default: AdminCenter })));
const CreatorStorefront = lazy(() => import('./creator-storefront.js').then(({ CreatorStorefront }) => ({ default: CreatorStorefront })));
const CreatorLanding = lazy(() => import('./creator.js').then(({ CreatorLanding }) => ({ default: CreatorLanding })));
const PriceAlerts = lazy(() => import('./price-tools.js').then(({ PriceAlerts }) => ({ default: PriceAlerts })));

type Editor =
  | { kind: 'list'; list?: WishlistSummary }
  | { kind: 'item'; item?: Item; list: WishlistSummary }
  | { kind: 'privacy' }
  | { kind: 'delete'; list: WishlistSummary; item?: Item };

function App() {
  const { t, error, money, number, language } = useLocale();
  const [lists, setLists] = useState<WishlistSummary[] | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Wishlist | null>(null);
  const [detailError, setDetailError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tools, setTools] = useState<IntelligenceSelection | null>(null);
  const [drafts] = useState<IntelligenceDrafts>(() => ({ impulse: new Map() }));
  const [status, setStatus] = useState<Message | ''>('');
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [showAccount, setShowAccount] = useState(/^\/account\/?$/u.test(location.pathname));
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [sharedLink, setSharedLink] = useState(() => sharedProductLink(new URL(location.href)));
  const [sharedDraft, setSharedDraft] = useState(() => sharedProductLink(new URL(location.href)));

  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === authChangeKey) location.reload(); };
    const hide = (event: PageTransitionEvent) => {
      if (event.persisted) document.documentElement.classList.add('session-suspended');
    };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) location.reload(); };
    window.addEventListener('storage', changed);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', restore);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const wishlistRequest = api<WishlistSummary[]>('/session', { method: 'POST', signal: controller.signal });
    const accountRequest = api<AccountStatus>('/account', { signal: controller.signal }).catch(() => null);
    Promise.all([wishlistRequest, accountRequest]).then(
      ([lists, current]) => {
        if (controller.signal.aborted) return;
        setAccountStatus(current);
        setLists(lists);
        const address = new URL(location.href);
        const auth = address.searchParams.get('auth');
        if (!auth || !Object.hasOwn(authNotices, auth)) return;
        address.searchParams.delete('auth');
        history.replaceState(null, '', address);
        const outcome = auth as AuthNotice;
        if (['signed-in', 'signed-out', 'imported', 'deleted'].includes(outcome)) announceAuthChange();
        if (['linked', 'verified', 'failed', 'cancelled'].includes(outcome) ||
            (outcome === 'signed-in' && current?.account?.import)) {
          setNotice(outcome);
          setShowAccount(true);
        } else setStatus(authNotices[outcome]);
      },
      (error: unknown) => { if (!controller.signal.aborted) setSessionError(errorMessage(error)); },
    );
    return () => controller.abort();
  }, [sessionAttempt]);

  const selected = lists?.find((list) => list.id === selectedId) ?? lists?.[0];
  const activeId = selected?.id;

  useEffect(() => {
    if (!lists || !sharedLink || !selected) return;
    setEditor({ kind: 'item', list: selected });
    setSharedLink(null);
    const address = new URL(location.href);
    for (const key of ['title', 'text', 'url']) address.searchParams.delete(key);
    history.replaceState(history.state, '', address.pathname + address.search + address.hash);
  }, [lists, selected, sharedLink]);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    api<PriceInbox>('/prices/alerts', { signal: controller.signal }).then(
      inbox => setUnreadAlerts(inbox.unread), () => undefined,
    );
    return () => controller.abort();
  }, [activeId, revision]);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    api<Wishlist>(`/wishlists/${activeId}`, { signal: controller.signal }).then(
      setDetail,
      (error: unknown) => { if (!controller.signal.aborted) setDetailError(errorMessage(error)); },
    );
    return () => controller.abort();
  }, [activeId, revision]);

  useEffect(() => {
    if (!status) return;
    const delay = window.setTimeout(() => setStatus(''), 5000);
    return () => window.clearTimeout(delay);
  }, [status]);

  function refresh() {
    setDetail(null);
    setDetailError('');
    setRevision((current) => current + 1);
  }

  function finish(message: Message) {
    setSharedDraft(null);
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

  async function saveItem(data: ItemWriteInput) {
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
  const account = accountStatus?.account;
  return (
    <div className="site consumer">
      <header className="masthead">
        <div className="brand-group">
          <span className="brand-symbol" aria-hidden="true" />
          <div className="brand">nanti<span>.</span></div>
        </div>
        <div className="masthead-controls">
          <button className="icon-button price-alert-entry" type="button" aria-label={t('Price alerts')}
            title={t('Price alerts')} disabled={!lists} onClick={() => setAlertsOpen(true)}>
            <Icon name="bell" />{activeId && unreadAlerts > 0 && <span aria-hidden="true">{number(Math.min(99, unreadAlerts))}</span>}
          </button>
          <details className="masthead-menu">
            <summary className="icon-button masthead-menu-toggle" aria-label={language === 'id' ? 'Buka menu' : 'Open menu'}
              title={language === 'id' ? 'Menu' : 'Menu'} aria-haspopup="true">
              <span className="masthead-hamburger" aria-hidden="true"><span /><span /><span /></span>
            </summary>
            <div className="masthead-menu-panel">
              <button type="button" disabled={!lists} onClick={() => {
                document.querySelector<HTMLDetailsElement>('.masthead-menu')?.removeAttribute('open');
                setShowAccount(true);
                void api<AccountStatus>('/account').then(setAccountStatus, () => undefined);
              }}><Icon name="person" />{t(account ? 'Account' : 'Sign in')}</button>
              <a href="/creator"><span className="masthead-menu-symbol" aria-hidden="true">✳</span>{language === 'id' ? 'Kreator' : 'Creator'}</a>
            </div>
          </details>
          <LanguagePicker />
        </div>
      </header>
      <div className={`workspace${selected ? ' workspace-collection' : ''}`}>
        {selected && <aside className="collection-rail">
          <div className="rail-heading">
            <h2>{t('Wishlists')}</h2>
            <button className="icon-button rail-add" aria-label={t('New wishlist')} title={t('New wishlist')}
              onClick={() => setEditor({ kind: 'list' })}><Icon name="plus" /></button>
          </div>
          <label className="collection-picker"><span className="sr-only">{t('Your wishlists')}</span>
            <select value={activeId} onChange={event => { setSelectedId(event.target.value); setDetailError(''); }}>
              {lists?.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          <nav aria-label={t('Your wishlists')}>
            {lists?.map(entry => <button key={entry.id} type="button" aria-current={entry.id === activeId ? 'true' : undefined}
              onClick={() => { setSelectedId(entry.id); setDetailError(''); }}>
              <Icon name="bookmark" /><span>{entry.name}</span><small>{entry.currency}</small>
            </button>)}
          </nav>
          <div className="rail-session">
            <Icon name={account ? 'person' : 'privacy'} />
            <strong>{account?.displayName || t(account ? 'Your account' : 'Guest mode')}</strong>
          </div>
        </aside>}
        <main className="consumer-main">
          {sessionError ? <section className="feedback-panel">
            <h1>{t('Your wishlists')}</h1><p role="alert" className="error">{error(sessionError)}</p>
            <button onClick={() => { setSessionError(''); setSessionAttempt((value) => value + 1); }}>{t('Try again')}</button>
          </section> : !lists ? <Loading label={t('Opening your wishlists…')} /> : !selected ? <section className="home-hero">
            <div className="hero-copy">
              <h1>{t('Save it now.')}<br />{t('Decide later.')}</h1>
              <p>{t('Save what you like, compare your options, and buy when it fits.')}</p>
              <button className="primary" onClick={() => setEditor({ kind: 'list' })}><Icon name="plus" />{t('Create a wishlist')}</button>
              <p className="hero-session">{t(account ? 'Your wishlists are private to your account.' : 'Start as a guest on this browser.')}</p>
            </div>
            <BookmarkArt />
          </section> : <>
            <section className="collection-banner">
              <div className="list-heading">
                <h1>{selected.name}</h1>
                <div className="actions collection-management">
                  <button className="icon-button" aria-label={t('Rename')} title={t('Rename')}
                    onClick={() => setEditor({ kind: 'list', list: selected })}><Icon name="edit" /></button>
                  <button className="icon-button" aria-label={t('Delete wishlist')} title={t('Delete wishlist')}
                    onClick={() => setEditor({ kind: 'delete', list: selected })}><Icon name="trash" /></button>
                </div>
              </div>
              <div className="collection-total">
                <div className="total-label">{t('Known total')} <small>{selected.currency}</small></div>
                <strong>{list ? money(list.totalMinor, list.currency) : '—'}</strong>
                {list && list.unpriced > 0 && <p className="collection-unpriced">
                  {t(list.unpriced === 1 ? '{n} product without a price' : '{n} products without a price', { n: number(list.unpriced) })}
                </p>}
              </div>
              <button className="primary collection-add" onClick={() => setEditor({ kind: 'item', list: selected })}>
                <Icon name="plus" />{t('Add product')}
              </button>
            </section>
            {detailError ? <div className="feedback-panel"><p className="error" role="alert">{error(detailError)}</p>
              <button onClick={refresh}>{t('Try again')}</button></div>
              : !list ? <Loading label={t('Loading products…')} /> : <>
                <div className="collection-tools">
                  <button type="button" onClick={() => setTools({ kind: 'comparison' })}>
                    <Icon name="compare" />{t('Compare priorities')}
                  </button>
                  <button type="button" onClick={() => setTools({ kind: 'timing' })}>
                    <Icon name="clock" />{t(list.items.length ? 'Check wishlist timing' : 'Saved timing checks')}
                  </button>
                </div>
                {list.items.length === 0 ? <section className="collection-empty">
                  <span className="empty-icon"><Icon name="bookmark" /></span><h2>{t('No products yet')}</h2>
                  <p>{t('Add a product with a link or enter its details manually.')}</p></section>
                  : <section className="collection-products" aria-labelledby="collection-products-heading">
                    <div className="product-shelf-heading">
                      <h2 id="collection-products-heading">{t('On your wishlist')}</h2>
                      <span>{t(list.items.length === 1 ? '{n} product' : '{n} products', { n: number(list.items.length) })}</span>
                    </div>
                    <ul className="products" aria-label={t('Saved products')}>
                    {list.items.map((item) => {
                      const link = item.url ? safeProductUrl(item.url) : null;
                      return <li key={item.id}>
                        <ProductMedia item={item} listId={list.id} />
                        <div className="product-body">
                          {link && <a className="merchant" href={link.href} target="_blank" rel="noopener noreferrer">
                            {link.hostname.replace(/^www\./u, '')}
                            <span className="sr-only"> ({t('opens in a new tab')})</span>
                          </a>}
                          <h3>{item.name}</h3>
                          <div className="product-price">
                            <strong className={item.priceMinor === null ? 'price-missing' : undefined}>
                              {item.priceMinor === null ? t('No price') : money(item.priceMinor * item.quantity, list.currency)}
                            </strong>
                            <span className="hint">{t('Qty {n}', { n: number(item.quantity) })}
                              {item.priceMinor !== null && item.quantity > 1 ? ` · ${t('{price} each', { price: money(item.priceMinor, list.currency) })}` : ''}
                            </span>
                          </div>
                        </div>
                        <div className="product-actions">
                          <button className="product-tools" type="button" aria-label={t('Purchase tools for {name}', { name: item.name })}
                            onClick={() => setTools({ kind: 'product', item })}>{t('Purchase tools')}<Icon name="arrow" /></button>
                          <button className="icon-button" aria-label={t('Edit {name}', { name: item.name })} title={t('Edit')}
                            onClick={() => setEditor({ kind: 'item', list, item })}><Icon name="edit" /></button>
                          <button className="icon-button remove-action" aria-label={t('Remove {name}', { name: item.name })} title={t('Remove')}
                            onClick={() => setEditor({ kind: 'delete', list, item })}><Icon name="trash" /></button>
                        </div>
                      </li>;
                    })}
                    </ul></section>}
              </>}
          </>}
        </main>
      </div>
      {lists && <footer className="consumer-footer">
        <span><Icon name="privacy" />{t(account ? 'Your wishlists are private to your account.' : 'Your wishlists are private to this browser.')}</span>
        <button className="privacy-entry" onClick={() => setEditor({ kind: 'privacy' })}>{t('Privacy and history')}</button>
      </footer>}
      <div className={status ? 'toast' : 'sr-only'} role="status">
        {status && <><Icon name="check" />{t(status)}</>}
      </div>
      {editor?.kind === 'list' && <ListForm list={editor.list} close={() => setEditor(null)} save={saveList} />}
      {editor?.kind === 'item' && <ItemForm item={editor.item} initialUrl={!editor.item ? sharedDraft ?? undefined : undefined} listId={editor.list.id} currency={editor.list.currency}
        close={() => { setSharedDraft(null); setEditor(null); }} save={saveItem} />}
      {editor?.kind === 'delete' && <DeleteForm name={editor.item?.name ?? editor.list.name}
        wishlist={!editor.item} close={() => setEditor(null)} remove={remove} />}
      {editor?.kind === 'privacy' && <PrivacyForm signedIn={Boolean(accountStatus?.account)} close={() => setEditor(null)} cleared={() => {
        drafts.impulse.clear(); finish('Assessment data cleared.');
      }} />}
      {tools && list && <Suspense fallback={<p role="status" className="sr-only">{t('Opening purchase tools…')}</p>}>
        <PurchaseTools list={list} lists={lists ?? []} selection={tools} close={() => setTools(null)} drafts={drafts}
          onPriceUpdate={() => setRevision(value => value + 1)} />
      </Suspense>}
      {alertsOpen && <Suspense fallback={<p role="status" className="sr-only">{t('Loading price alerts…')}</p>}>
        <PriceAlerts close={() => setAlertsOpen(false)} onRead={() => setRevision(value => value + 1)} />
      </Suspense>}
      {showAccount && lists && <AccountDialog status={accountStatus} notice={notice}
        close={() => {
          if (/^\/account\/?$/u.test(location.pathname)) history.replaceState(null, '', '/');
          setShowAccount(false);
          setNotice(null);
        }} update={setAccountStatus} />}
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  if (/^\/admin\/?$/u.test(location.pathname)) {
    document.documentElement.lang = 'en';
    createRoot(root).render(<Suspense fallback={<p className="site" role="status">Opening Affiliate Center…</p>}><AdminCenter /></Suspense>);
  } else if (/^\/creator\/demo\/?$/u.test(location.pathname)) {
    createRoot(root).render(<LocaleProvider><Suspense fallback={<p className="site" role="status">Opening creator storefront…</p>}><CreatorStorefront /></Suspense></LocaleProvider>);
  } else if (/^\/creator\/?$/u.test(location.pathname)) {
    createRoot(root).render(<LocaleProvider><Suspense fallback={<p className="site" role="status">Opening Nanti Kreator…</p>}><CreatorLanding /></Suspense></LocaleProvider>);
  } else createRoot(root).render(<LocaleProvider><App /></LocaleProvider>);
}
