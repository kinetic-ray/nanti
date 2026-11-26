import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
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
import { AccountDialog, AccountSignInPage, accountWorkspaceReturnKey, announceAuthChange, authChangeKey, authNotices, hasAccountRecovery } from './account.js';
import type { AuthNotice } from './account.js';
import type { AccountStatus } from '../shared/account.js';
import { financialProfileReturnKey } from '../shared/account.js';
import type { PriceInbox } from '../shared/prices.js';
import { BookmarkArt, Icon, Loading, ProductMedia } from './visual.js';
import { isInternalNavigationClick, navigateTo, prefetchInternalNavigation } from './navigation.js';
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
const CreatorAccess = lazy(() => import('./creator-access.js').then(({ CreatorAccess }) => ({ default: CreatorAccess })));
const CreatorStorefront = lazy(() => import('./creator-storefront.js').then(({ CreatorStorefront }) => ({ default: CreatorStorefront })));
const CreatorLanding = lazy(() => import('./creator.js').then(({ CreatorLanding }) => ({ default: CreatorLanding })));
const PriceAlerts = lazy(() => import('./price-tools.js').then(({ PriceAlerts }) => ({ default: PriceAlerts })));
const RecommendationInbox = lazy(() => import('./RecommendationInbox.js').then(({ RecommendationInbox }) => ({ default: RecommendationInbox })));
const AccountWorkspace = lazy(() => import('./account-workspace.js').then(({ AccountWorkspace }) => ({ default: AccountWorkspace })));

type Editor =
  | { kind: 'list'; list?: WishlistSummary }
  | { kind: 'item'; item?: Item; list: WishlistSummary }
  | { kind: 'privacy' }
  | { kind: 'delete'; list: WishlistSummary; item?: Item };

const sessionCache: { account: AccountStatus | null; lists: WishlistSummary[] | null; identity: string | null; validatedAt: number } = {
  account: null, lists: null, identity: null, validatedAt: 0,
};

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
  const [lists, setListsState] = useState<WishlistSummary[] | null>(() => sessionCache.lists);
  const [sessionError, setSessionError] = useState('');
  const [sessionRefreshing, setSessionRefreshing] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const listsLoaded = useRef(sessionCache.lists !== null);
  const listsRef = useRef<WishlistSummary[] | null>(sessionCache.lists);
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
  const [accountStatus, setAccountStatusState] = useState<AccountStatus | null>(() => sessionCache.account);
  const accountStatusRef = useRef<AccountStatus | null>(sessionCache.account);
  const accountRoute = /^\/account\/?$/u.test(location.pathname);
  const [showAccount, setShowAccount] = useState(false);
  const [accountRecovery] = useState(hasAccountRecovery);
  const accountEntry = accountRoute || accountRecovery;
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [recommendations, setRecommendations] = useState<'initial' | 'dismissed' | 'reopened'>('initial');
  const reopenRecommendations = useRef<HTMLButtonElement>(null);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [sharedLink, setSharedLink] = useState(() => sharedProductLink(new URL(location.href)));
  const [sharedDraft, setSharedDraft] = useState(() => sharedProductLink(new URL(location.href)));

  function setLists(update: SetStateAction<WishlistSummary[] | null>) {
    setListsState(current => {
      const next = typeof update === 'function' ? update(current) : update;
      sessionCache.lists = next;
      return next;
    });
  }

  function setAccountStatus(status: AccountStatus | null) {
    sessionCache.account = status;
    setAccountStatusState(status);
  }

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
    const sessionFresh = accountStatusRef.current !== null && Date.now() - sessionCache.validatedAt < 5 * 60_000;
    const useLoadedSession = sessionAttempt === 0 && sessionFresh;
    if (listsLoaded.current && !accountEntry && !useLoadedSession) setSessionRefreshing(true);
    if (accountEntry && !useLoadedSession) setAccountStatus(null);
    const accountRequest = useLoadedSession
      ? Promise.resolve(accountStatusRef.current!)
      : api<AccountStatus>('/account', { signal: controller.signal });
    const loadLists = () => api<WishlistSummary[]>('/session', { method: 'POST', signal: controller.signal });
    const wishlistRequest = accountEntry ? Promise.resolve(null)
      : useLoadedSession && listsLoaded.current ? Promise.resolve(listsRef.current ?? []) : loadLists();
    Promise.all([wishlistRequest, accountRequest]).then(
      ([lists, current]) => {
        if (controller.signal.aborted) return;
        const identity = current.account
          ? `account:${current.account.email?.trim().toLocaleLowerCase() || 'signed-in'}`
          : 'guest';
        if ((identityLoaded.current && previousIdentity.current !== identity) ||
            (sessionCache.identity !== null && sessionCache.identity !== identity)) {
          location.reload();
          return;
        }
        previousIdentity.current = identity;
        identityLoaded.current = true;
        sessionCache.identity = identity;
        sessionCache.validatedAt = Date.now();
        accountStatusRef.current = current;
        setSessionRefreshing(false);
        setSessionError('');
        setAccountStatus(current);
        if (lists !== null && !accountEntry) {
          listsLoaded.current = true;
          listsRef.current = lists;
          setLists(lists);
        }
        const address = new URL(location.href);
        if (accountRoute && address.searchParams.get('next') === 'creator' && current.account && !accountRecovery) {
          navigateTo('/creator?onboard=1', { replace: true });
          return;
        }
        if (accountRoute && address.searchParams.get('section') === 'financial-profile' && !current.account) {
          address.searchParams.set('next', 'financial-profile');
          history.replaceState(history.state, '', address);
        }
        const auth = address.searchParams.get('auth');
        if (!auth || !Object.hasOwn(authNotices, auth)) return;
        address.searchParams.delete('auth');
        history.replaceState(null, '', address);
        const outcome = auth as AuthNotice;
        if (['signed-in', 'signed-out', 'imported', 'deleted'].includes(outcome)) announceAuthChange();
        if (outcome === 'signed-in' && current.account && !accountEntry) {
          try {
            const financialReturn = Number(sessionStorage.getItem(financialProfileReturnKey));
            const workspaceReturn = Number(sessionStorage.getItem(accountWorkspaceReturnKey));
            sessionStorage.removeItem(financialProfileReturnKey);
            sessionStorage.removeItem(accountWorkspaceReturnKey);
            if (Math.max(financialReturn, workspaceReturn) > Date.now()) {
              const section = financialReturn > workspaceReturn ? '&section=financial-profile' : '';
              navigateTo('/account?auth=signed-in' + section, { replace: true });
              return;
            }
          } catch { /* Sign-in can continue without storage. */ }
        }
        if (['linked', 'verified', 'failed', 'cancelled'].includes(outcome) ||
            (outcome === 'signed-in' && current?.account?.import)) {
          if (current.account && !accountEntry && !['failed', 'cancelled'].includes(outcome)) {
            const section = outcome === 'signed-in' ? '' : '&section=security';
            navigateTo('/account?auth=' + outcome + section, { replace: true });
            return;
          }
          setNotice(outcome);
        } else setStatus(authNotices[outcome]);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        listsLoaded.current = false;
        listsRef.current = null;
        sessionCache.account = null;
        sessionCache.lists = null;
        sessionCache.identity = null;
        sessionCache.validatedAt = 0;
        setSessionRefreshing(false);
        setDetailLoading(false);
        setLists(null);
        setDetail(null);
        setAccountStatus(null);
        accountStatusRef.current = null;
        setSessionError(errorMessage(error));
      },
    );
    return () => controller.abort();
  }, [sessionAttempt, accountRecovery, accountEntry, accountRoute]);

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

  function renderHeader() {
    return <header className="masthead">
      <div className="brand-group">
        <span className="brand-symbol" aria-hidden="true" />
        <div className="brand">nanti<span>.</span></div>
      </div>
      <HeaderActions account={account} ready={Boolean(lists)} unread={activeId ? unreadAlerts : 0}
        openAlerts={() => setAlertsOpen(true)} signIn={() => setShowAccount(true)} signOut={requestSignOut} />
    </header>;
  }

  async function signOut() {
    await api('/account/logout', { method: 'POST' });
    sessionCache.account = null;
    sessionCache.lists = null;
    sessionCache.identity = null;
    sessionCache.validatedAt = 0;
    announceAuthChange();
    location.replace('/?auth=signed-out');
  }

  function requestSignOut() {
    void signOut().catch(() => setStatus('Could not load your account. Try again.'));
  }

  if (accountRoute && !accountRecovery && accountStatus?.account) {
    return <div className="site consumer">{renderHeader()}
      <Suspense fallback={<RouteLoading label="Preparing your account…" />}>
        <AccountWorkspace status={accountStatus} notice={notice} update={setAccountStatus}
          signOut={signOut} statusMessage={status} requestSignOut={requestSignOut} />
      </Suspense>
    </div>;
  }

  if (accountEntry && !accountStatus) {
    return <div className="site consumer">{renderHeader()}{sessionError ? <main className="account-route-panel">
      <p role="alert">{t('Could not load your account. Try again.')}</p>
      <button type="button" onClick={() => setSessionAttempt(value => value + 1)}>{t('Try again')}</button>
      <a href="/">{t('Back to wishlists')}</a>
    </main> : <RouteLoading label="Preparing your account…" />}</div>;
  }

  if (accountEntry) {
    return <div className="site consumer">
      {renderHeader()}
      <AccountSignInPage status={accountStatus} notice={notice} update={setAccountStatus}
        close={() => navigateTo(new URLSearchParams(location.search).get('next') === 'creator' ? '/creator' : '/', { replace: true })} />
    </div>;
  }

  return (
    <div className="site consumer">
      {renderHeader()}
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
      {notice && !showAccount && <p className="toast" role={notice === 'failed' ? 'alert' : 'status'}>
        {t(authNotices[notice])}
      </p>}
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
          if (sessionError) setSessionAttempt(value => value + 1);
          setShowAccount(false);
          setNotice(null);
        }} update={setAccountStatus} />}
    </div>
  );
}

function normalizeLocation() {
  const address = new URL(location.href);
  const original = `${address.pathname}${address.search}${address.hash}`;
  if (/^\/account\/financial-profile\/?$/u.test(address.pathname)) {
    address.pathname = '/account';
    address.searchParams.set('section', 'financial-profile');
  } else if (/^\/account\/?$/u.test(address.pathname) && address.searchParams.get('view') === 'settings') {
    address.searchParams.delete('view');
    address.searchParams.set('section', 'security');
  }
  if (/^\/account\/?$/u.test(address.pathname) && address.searchParams.get('next') === 'financial-profile') {
    address.searchParams.set('section', 'financial-profile');
  }
  const normalized = `${address.pathname}${address.search}${address.hash}`;
  if (normalized !== original) history.replaceState(history.state, '', normalized);
  return normalized;
}

function isMainRoute(pathname: string) {
  return !/^\/admin\/?$/u.test(pathname) &&
    !/^\/creator\/?$/u.test(pathname) &&
    !/^\/creator\/studio\/?$/u.test(pathname) &&
    !/^\/creator\/demo\/?$/u.test(pathname) &&
    !/^\/store\/[^/]+\/?$/u.test(pathname);
}

function ApplicationRouter() {
  const [route, setRoute] = useState(normalizeLocation);
  const address = new URL(route, location.origin);
  const { pathname } = address;
  const mainRoute = isMainRoute(pathname);
  const adminRoute = /^\/admin\/?$/u.test(pathname);
  const creatorStudioRoute = /^\/creator\/studio\/?$/u.test(pathname);
  const storefrontRoute = /^\/store\/[^/]+\/?$/u.test(pathname);
  const demoRoute = /^\/creator\/demo\/?$/u.test(pathname);
  const creatorRoute = /^\/creator\/?$/u.test(pathname);

  useEffect(() => {
    function syncLocation() {
      setRoute(normalizeLocation());
      if (/^\/admin\/?$/u.test(location.pathname)) document.documentElement.lang = 'id';
    }
    function onAuthChange(event: StorageEvent) {
      if (event.key === authChangeKey) location.reload();
    }
    function onClick(event: MouseEvent) {
      const destination = isInternalNavigationClick(event);
      if (!destination) return;
      event.preventDefault();
      navigateTo(destination);
    }
    window.addEventListener('popstate', syncLocation);
    document.addEventListener('click', onClick);
    document.addEventListener('pointerover', prefetchInternalNavigation);
    document.addEventListener('focusin', prefetchInternalNavigation);
    window.addEventListener('storage', onAuthChange);
    if (adminRoute) document.documentElement.lang = 'id';
    return () => {
      window.removeEventListener('popstate', syncLocation);
      document.removeEventListener('click', onClick);
      document.removeEventListener('pointerover', prefetchInternalNavigation);
      document.removeEventListener('focusin', prefetchInternalNavigation);
      window.removeEventListener('storage', onAuthChange);
    };
  }, [adminRoute]);

  return <LocaleProvider>
    {mainRoute && <App />}
    {adminRoute && <Suspense fallback={<p className="site" role="status">Membuka administrasi…</p>}>
      {new URLSearchParams(address.search).get('view') === 'accounts' ? <AccountAdmin /> : <AdminCenter />}
    </Suspense>}
    {creatorStudioRoute && <Suspense fallback={<RouteLoading label="Preparing the studio…" />}>
      <CreatorAccess studio={(ownerId, draft) => <CreatorWorkspace key={ownerId} ownerId={ownerId} draft={draft} />} />
    </Suspense>}
    {storefrontRoute && <Suspense fallback={<RouteLoading label="Loading storefront…" storefront />}><LiveCreatorStorefront /></Suspense>}
    {demoRoute && <Suspense fallback={<RouteLoading label="Loading storefront…" storefront />}><CreatorStorefront /></Suspense>}
    {creatorRoute && <Suspense fallback={<RouteLoading label="Loading creator page…" />}>
      {new URLSearchParams(address.search).get('onboard') === '1' ? <CreatorAccess studio={() => null} /> : <CreatorLanding />}
    </Suspense>}
  </LocaleProvider>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<ApplicationRouter />);
