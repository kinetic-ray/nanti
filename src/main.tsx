import { CreatorAccess } from './creator-access.js';
import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { safeProductUrl } from '../shared/wishlist.js';
import { sharedProductLink } from './share-target.js';
import type { Currency, Item, ItemSaveInput, Wishlist, WishlistSummary } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { DeleteForm, ItemForm, ListForm, PrivacyForm } from './forms.js';
import { LocaleProvider, useLocale } from './locale.js';
import { HeaderActions } from './header-actions.js';
import type { Message } from './messages.js';
import type { IntelligenceDrafts, IntelligenceSelection } from './intelligence.js';
import { AccountDialog, announceAuthChange, authChangeKey, authNotices } from './account.js';
import type { AuthNotice } from './account.js';
import type { AccountStatus } from '../shared/account.js';
import { financialProfileReturnKey } from '../shared/account.js';
import type { PriceInbox } from '../shared/prices.js';
import { BookmarkArt, Icon, Loading, ProductMedia } from './visual.js';
import './styles.css';
import './consumer.css';

// Every route, including the standalone creator workspace, must discard a
// frozen page when the browser restores it from the back-forward cache.
window.addEventListener('pagehide', event => {
  if (event.persisted) document.documentElement.classList.add('session-suspended');
});
window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});

const PurchaseTools = lazy(() => import('./intelligence.js').then(({ PurchaseTools }) => ({ default: PurchaseTools })));
const AccountAdmin = lazy(() => import('./account-admin.js').then(({ AccountAdmin }) => ({ default: AccountAdmin })));
const AdminCenter = lazy(() => import('./admin.js').then(({ AdminCenter }) => ({ default: AdminCenter })));
const CreatorWorkspace = lazy(() => import('./creator-workspace.js').then(({ CreatorWorkspace }) => ({ default: CreatorWorkspace })));
const LiveCreatorStorefront = lazy(() => import('./creator-workspace.js').then(({ LiveCreatorStorefront }) => ({ default: LiveCreatorStorefront })));
const CreatorStorefront = lazy(() => import('./creator-storefront.js').then(({ CreatorStorefront }) => ({ default: CreatorStorefront })));
const CreatorLanding = lazy(() => import('./creator.js').then(({ CreatorLanding }) => ({ default: CreatorLanding })));
const PriceAlerts = lazy(() => import('./price-tools.js').then(({ PriceAlerts }) => ({ default: PriceAlerts })));
const RecommendationInbox = lazy(() => import('./RecommendationInbox.js').then(({ RecommendationInbox }) => ({ default: RecommendationInbox })));
const FinancialProfilePage = lazy(() => import('./financial-profile.js').then(({ FinancialProfilePage }) => ({ default: FinancialProfilePage })));

type Editor =
  | { kind: 'list'; list?: WishlistSummary }
  | { kind: 'item'; item?: Item; list: WishlistSummary }
  | { kind: 'privacy' }
  | { kind: 'delete'; list: WishlistSummary; item?: Item };

function WishlistPicker({ lists, activeId, label, onChange }: {
  lists: WishlistSummary[]; activeId: string; label: string; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = `wishlist-options-${useId()}`;
  const selectedIndex = Math.max(0, lists.findIndex(list => list.id === activeId));

  useEffect(() => {
    if (!open) return;
    options.current[selectedIndex]?.focus();
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    return () => document.removeEventListener('pointerdown', dismissOutside, true);
  }, [open, selectedIndex]);

  function moveFocus(index: number) {
    const next = (index + lists.length) % lists.length;
    options.current[next]?.focus();
  }

  function select(id: string) {
    onChange(id);
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }

  return <div ref={root} className={`collection-picker wishlist-picker${open ? ' is-open' : ''}`}>
    <span className="sr-only" id={`${listboxId}-label`}>{label}</span>
    <button ref={trigger} type="button" className="wishlist-picker-trigger" aria-haspopup="listbox"
      aria-expanded={open} aria-controls={listboxId} onClick={() => setOpen(value => !value)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!open) setOpen(true);
          else moveFocus(selectedIndex + (event.key === 'ArrowDown' ? 1 : -1));
        }
      }}>
      <span>{lists.find(list => list.id === activeId)?.name ?? label}</span><ChevronDown size={18} aria-hidden="true" />
    </button>
    {open && <div className="wishlist-picker-options" id={listboxId} role="listbox" aria-labelledby={`${listboxId}-label`}
      onKeyDown={event => {
        const current = options.current.findIndex(option => option === document.activeElement);
        if (event.key === 'Escape') {
          event.preventDefault(); setOpen(false); trigger.current?.focus();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); moveFocus(current + (event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault(); moveFocus(event.key === 'Home' ? 0 : lists.length - 1);
        }
      }}>
      {lists.map((list, index) => <button key={list.id} ref={element => { options.current[index] = element; }}
        type="button" role="option" aria-selected={list.id === activeId} onClick={() => select(list.id)}>
        <span>{list.name}</span>{list.id === activeId ? <Check size={17} aria-hidden="true" /> : <span className="wishlist-option-empty" aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}

function WishlistLoadingSkeleton({ label }: { label: string }) {
  return <section className="wishlist-loading" aria-busy="true" aria-label={label}>
    <p className="wishlist-loading-label" role="status">{label}</p>
    <div className="wishlist-skeleton-summary" aria-hidden="true"><i /><i /></div>
    <ul aria-hidden="true">{[0, 1, 2].map(item => <li key={item}><i /><span><i /><i /><i /></span></li>)}</ul>
  </section>;
}

function RouteLoading({ label, storefront = false }: { label: Message; storefront?: boolean }) {
  const { t } = useLocale();
  return <main className="route-loading" aria-busy="true" aria-label={t(label)}>
    <p role="status">{t(label)}</p>
    {storefront && <>
      <div className="route-storefront-identity" aria-hidden="true"><i /><span><i /><i /></span></div>
      <div className="route-storefront-search" aria-hidden="true"><i /></div>
      <div className="route-storefront-products" aria-hidden="true">{[0, 1, 2, 3].map(item => <i key={item} />)}</div>
    </>}
  </main>;
}

function App() {
  const { t, error, money, number } = useLocale();
  const [lists, setLists] = useState<WishlistSummary[] | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [sessionRefreshing, setSessionRefreshing] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const listsLoaded = useRef(false);
  const previousIdentity = useRef<string | null>(null);
  const identityLoaded = useRef(false);
  const hiddenAt = useRef(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Wishlist | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tools, setTools] = useState<IntelligenceSelection | null>(null);
  const [drafts] = useState<IntelligenceDrafts>(() => ({ impulse: new Map() }));
  const [status, setStatus] = useState<Message | ''>('');
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [showAccount, setShowAccount] = useState(/^\/account\/?$/u.test(location.pathname));
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [recommendations, setRecommendations] = useState<'initial' | 'dismissed' | 'reopened'>('initial');
  const reopenRecommendations = useRef<HTMLButtonElement>(null);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [sharedLink, setSharedLink] = useState(() => sharedProductLink(new URL(location.href)));
  const [sharedDraft, setSharedDraft] = useState(() => sharedProductLink(new URL(location.href)));

  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === authChangeKey) location.reload(); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);

  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
      } else if (hiddenAt.current && Date.now() - hiddenAt.current >= 5 * 60_000) {
        hiddenAt.current = 0;
        setSessionAttempt(value => value + 1);
      } else hiddenAt.current = 0;
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setSessionError('');
    if (listsLoaded.current) setSessionRefreshing(true);
    const wishlistRequest = api<WishlistSummary[]>('/session', { method: 'POST', signal: controller.signal });
    const accountRequest = api<AccountStatus>('/account', { signal: controller.signal });
    Promise.all([wishlistRequest, accountRequest]).then(
      ([lists, current]) => {
        if (controller.signal.aborted) return;
        const identity = current.account
          ? `account:${current.account.email?.trim().toLocaleLowerCase() || 'signed-in'}`
          : 'guest';
        if (identityLoaded.current && previousIdentity.current !== identity) {
          location.reload();
          return;
        }
        previousIdentity.current = identity;
        identityLoaded.current = true;
        listsLoaded.current = true;
        setSessionRefreshing(false);
        setSessionError('');
        setAccountStatus(current);
        setLists(lists);
        const address = new URL(location.href);
        const auth = address.searchParams.get('auth');
        if (!auth || !Object.hasOwn(authNotices, auth)) return;
        address.searchParams.delete('auth');
        history.replaceState(null, '', address);
        const outcome = auth as AuthNotice;
        if (['signed-in', 'signed-out', 'imported', 'deleted'].includes(outcome)) announceAuthChange();
        if (outcome === 'signed-in' && current?.account) {
          const returnUntil = Number(sessionStorage.getItem(financialProfileReturnKey) ?? 0);
          sessionStorage.removeItem(financialProfileReturnKey);
          if (returnUntil > Date.now()) {
            location.replace('/account/financial-profile?auth=signed-in');
            return;
          }
        }
        if (['linked', 'verified', 'failed', 'cancelled'].includes(outcome) ||
            (outcome === 'signed-in' && current?.account?.import)) {
          setNotice(outcome);
          setShowAccount(true);
        } else setStatus(authNotices[outcome]);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        listsLoaded.current = false;
        setSessionRefreshing(false);
        setDetailLoading(false);
        setLists(null);
        setDetail(null);
        setAccountStatus(null);
        setSessionError(errorMessage(error));
      },
    );
    return () => controller.abort();
  }, [sessionAttempt]);

  const selected = lists?.find((list) => list.id === selectedId) ?? lists?.[0];
  const activeId = selected?.id;

  useEffect(() => {
    if (recommendations === 'dismissed') reopenRecommendations.current?.focus();
  }, [recommendations]);

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
    setDetailLoading(true);
    api<Wishlist>(`/wishlists/${activeId}`, { signal: controller.signal }).then(
      (wishlist) => {
        if (controller.signal.aborted) return;
        setDetail(wishlist);
        setDetailError('');
      },
      (error: unknown) => { if (!controller.signal.aborted) setDetailError(errorMessage(error)); },
    ).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [activeId, revision]);

  useEffect(() => {
    if (!status) return;
    const delay = window.setTimeout(() => setStatus(''), 5000);
    return () => window.clearTimeout(delay);
  }, [status]);

  function refresh() {
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

  async function saveItem(data: ItemSaveInput, requestKey?: string) {
    if (editor?.kind !== 'item') return;
    const { item, list } = editor;
    const endpoint = `/wishlists/${list.id}/items`;
    const result = await api<{ photoStatus: 'saved' | 'unavailable' } | undefined>(
      item ? `${endpoint}/${item.id}` : endpoint, { method: item ? 'PUT' : 'POST', data, requestKey },
    );
    refresh();
    finish(result?.photoStatus === 'unavailable' ? 'Product added without its store photo.' :
      item ? 'Product updated.' : 'Product added.');
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
        <HeaderActions account={account} ready={Boolean(lists)} unread={activeId ? unreadAlerts : 0}
          openAlerts={() => setAlertsOpen(true)} signIn={() => setShowAccount(true)} signOut={() => void api('/account/logout', { method: 'POST' }).then(() => {
            announceAuthChange();
            location.replace('/?auth=signed-out');
          }, () => setStatus('Could not load your account. Try again.'))} />
      </header>
      <div className={`workspace${selected ? ' workspace-collection' : ''}`}>
        {selected && <aside className="collection-rail">
          <div className="rail-heading">
            <h2>{t('Wishlists')}</h2>
            <button className="icon-button rail-add" aria-label={t('New wishlist')} title={t('New wishlist')}
              onClick={() => setEditor({ kind: 'list' })}><Icon name="plus" /></button>
          </div>
          <WishlistPicker lists={lists ?? []} activeId={activeId ?? ''} label={t('Your wishlists')}
            onChange={id => { setSelectedId(id); setDetailError(''); }} />
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
        <main className="consumer-main" aria-busy={(!lists && !sessionError) || sessionRefreshing || detailLoading}>
          {sessionRefreshing && <p className="session-refresh-status" role="status">{t('Refreshing the page…')}</p>}
          {sessionError ? <section className="feedback-panel">
            <h1>{t('Your wishlists')}</h1><p role="alert" className="error">{error(sessionError)}</p>
            <button onClick={() => { setSessionError(''); setSessionAttempt((value) => value + 1); }}>{t('Try again')}</button>
          </section> : !lists ? <Loading label={t('Preparing your account…')} /> : !selected ? <section className="home-hero">
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
                  <button className="icon-button remove-action" aria-label={t('Delete wishlist')} title={t('Delete wishlist')}
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
            {detailError && !list ? <div className="feedback-panel"><p className="error" role="alert">{error(detailError)}</p>
              <button onClick={refresh}>{t('Try again')}</button></div>
              : !list ? <WishlistLoadingSkeleton label={t('Loading wishlist…')} /> : <>
                {detailLoading && <p className="wishlist-refresh-status" role="status">{t('Refreshing wishlist…')}</p>}
                {detailError && <div className="wishlist-refresh-error"><p className="error" role="alert">{t('Wishlist could not be refreshed. Your saved products are still shown.')}</p>
                  <button type="button" onClick={refresh}>{t('Try again')}</button></div>}
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
                    {list.items.map((item, index) => {
                      const link = item.url ? safeProductUrl(item.url) : null;
                      return <li key={item.id}>
                        <ProductMedia item={item} listId={list.id} priority={index === 0} />
                        <div className="product-body">
                          {link && <a className="merchant" href={link.href} target="_blank" rel="noopener noreferrer">
                            {link.hostname.replace(/^www\./u, '')}
                            <span className="sr-only"> ({t('opens in a new tab')})</span>
                          </a>}
                          <h3>{item.name}</h3>
                          {item.sellerName && <span className="hint">{t('Seller: {seller}', { seller: item.sellerName })}</span>}
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
          {lists && <div className="recommendation-slot">
            {recommendations === 'dismissed'
              ? <button ref={reopenRecommendations} className="recommendation-reopen" type="button"
                onClick={() => setRecommendations('reopened')}>{t('Show alternative updates')}</button>
              : <Suspense fallback={<p className="recommendation-status" role="status">{t('Loading alternative updates…')}</p>}>
                <RecommendationInbox close={() => setRecommendations('dismissed')} focusOnOpen={recommendations === 'reopened'} />
              </Suspense>}
          </div>}
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
        existingItems={detail?.id === editor.list.id ? detail.items : undefined}
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
      {showAccount && <AccountDialog status={accountStatus} notice={notice}
        close={() => {
          if (/^\/account\/?$/u.test(location.pathname)) {
            if (new URLSearchParams(location.search).get('next') === 'creator') {
              location.replace('/creator?onboard=1');
              return;
            }
            history.replaceState(history.state, '', '/');
          }
          setShowAccount(false);
          setNotice(null);
        }} update={setAccountStatus} />}
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  if (/^\/account\/financial-profile\/?$/u.test(location.pathname)) {
    createRoot(root).render(<LocaleProvider><Suspense fallback={<p className="site" role="status">Membuka profil finansial…</p>}>
      <FinancialProfilePage />
    </Suspense></LocaleProvider>);
  } else if (/^\/admin\/?$/u.test(location.pathname)) {
    document.documentElement.lang = 'id';
    const accounts = new URLSearchParams(location.search).get('view') === 'accounts';
    createRoot(root).render(<Suspense fallback={<p className="site" role="status">Membuka administrasi…</p>}>
      {accounts ? <AccountAdmin /> : <AdminCenter />}
    </Suspense>);
  } else if (/^\/creator\/studio\/?$/u.test(location.pathname)) {
    createRoot(root).render(<LocaleProvider><Suspense fallback={<RouteLoading label="Preparing the studio…" />}><CreatorAccess studio={(ownerId, draft) => <CreatorWorkspace key={ownerId} ownerId={ownerId} draft={draft} />} /></Suspense></LocaleProvider>);
  } else if (/^\/store\/[^/]+\/?$/u.test(location.pathname)) {
    createRoot(root).render(<LocaleProvider><Suspense fallback={<RouteLoading label="Loading storefront…" storefront />}><LiveCreatorStorefront /></Suspense></LocaleProvider>);
  } else if (/^\/creator\/demo\/?$/u.test(location.pathname)) {
    createRoot(root).render(<LocaleProvider><Suspense fallback={<RouteLoading label="Loading storefront…" storefront />}><CreatorStorefront /></Suspense></LocaleProvider>);
  } else if (/^\/creator\/?$/u.test(location.pathname)) {
    createRoot(root).render(<LocaleProvider><Suspense fallback={<RouteLoading label="Loading creator page…" />} >
      {new URLSearchParams(location.search).get('onboard') === '1' ? <CreatorAccess studio={() => null} /> : <CreatorLanding />}
    </Suspense></LocaleProvider>);
  } else createRoot(root).render(<LocaleProvider><App /></LocaleProvider>);
}
