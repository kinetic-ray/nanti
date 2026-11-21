import { useEffect, useRef, useState } from 'react';
import type { CreatorCatalog, PublicStorefront } from '../shared/creator-catalog.js';
import type { FormEvent } from 'react';
import { validateDesign } from '../shared/creator-design.js';
import { api, errorMessage } from './api.js';
import { CreatorProducts } from './creator-products.js';
import { CreatorDesignStudio } from './creator-studio.js';
import { CreatorStorefront } from './creator-storefront.js';
import { LanguagePicker, useLocale } from './locale.js';
import './creator-workspace.css';

const path = '/account/creator/catalog';
const tabs = ['overview', 'products', 'appearance', 'preview', 'publishing'] as const;
type Tab = typeof tabs[number];

export function CreatorWorkspace({ ownerId, draft }: { ownerId: string; draft: unknown }) {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>('overview');
  const [openedAppearance, setOpenedAppearance] = useState(false);
  const [catalog, setCatalog] = useState<CreatorCatalog>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [reload, setReload] = useState(0);
  const [savedDesign, setSavedDesign] = useState(() => validateDesign(draft));
  const panel = useRef<HTMLElement>(null);
  const labels = [t('Overview'), t('Products'), t('Appearance'),
    t('Preview'), t('Publishing')];

  async function load() {
    setCatalog(await api<CreatorCatalog>(path));
  }
  useEffect(() => {
    const controller = new AbortController();
    api<CreatorCatalog>(path, { signal: controller.signal }).then(setCatalog, failure => {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    });
    return () => controller.abort();
  }, [reload]);

  function open(next: Tab) {
    setTab(next);
    if (next === 'appearance') setOpenedAppearance(true);
    if (catalog) setError('');
    setNotice('');
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(':scope > div:not([hidden]) h1')?.focus());
  }

  async function publish(published: boolean) {
    setPublishing(true);
    setError('');
    setNotice('');
    try {
      await api(path + '/publication', { method: 'PUT', data: { published } });
      await load();
      setNotice(published ? t('Storefront published.') : t('Storefront unpublished.'));
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setPublishing(false); }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    setError('');
    setNotice('');
    setPublishing(true);
    try {
      await api(path + '/settings', { method: 'PATCH', data: { name } });
      await load();
      setNotice(t('Storefront name saved.'));
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setPublishing(false); }
  }

  const visible = catalog?.products.filter(product => product.published) ?? [];
  const store = catalog ? '/store/' + catalog.handle : '';
  const isLive = Boolean(catalog?.publishedDesign);
  return <div className="creator-workspace">
    <a className="catalog-skip" href="#creator-content">{t('Skip to content')}</a>
    <header className="catalog-header"><div className="catalog-shell catalog-top">
      <a href="/creator" className="catalog-brand">nanti<span>.</span> <small>Creator Studio</small></a>
      <div><LanguagePicker /><a href="/account">{t('Account')}</a></div>
    </div></header>
    <nav className="catalog-shell catalog-nav" aria-label={t('Creator Studio navigation')}>
      {tabs.map((value, index) => <button key={value} aria-current={tab === value ? 'page' : undefined}
        type="button" onClick={() => open(value)}>{labels[index]}</button>)}
    </nav>
    <main id="creator-content" className="catalog-shell catalog-main" ref={panel} tabIndex={-1}>
      {error && <p className="catalog-error" role="alert">{error} {error === 'Sign in to continue.'
        ? <a href="/account?next=creator">{t('Sign in again')}</a>
        : !catalog && <button type="button" onClick={() => { setError(''); setReload(value => value + 1); }}>{t('Try again')}</button>}</p>}
      {!error && !catalog && <p role="status">{t('Loading your storefront…')}</p>}
      {catalog && <>
        <div hidden={tab !== 'overview'}>
          <div className="catalog-heading"><h1 tabIndex={-1}>{t('Make it yours.')}</h1>
            {isLive && <a href={store}>{t('View live storefront')}</a>}</div>
          <section className="catalog-panel" aria-label={t('Storefront overview')}>
            <span className="catalog-badge" data-published={isLive}>{isLive ? t('Storefront live') : t('Storefront private')}</span>
            <h2>{catalog.name}</h2>
            <p>{catalog.products.length ? t('{published} of {total} products are published.', { published: visible.length, total: catalog.products.length }) : t('Add your first recommendation. Preview your storefront before opening it to visitors.')}</p>
            <button type="button" className="catalog-primary" onClick={() => open('products')}>{t('Manage products')}</button>
          </section>
        </div>
        <div hidden={tab !== 'products'}><CreatorProducts catalog={catalog} load={load} openPublishing={() => open('publishing')} /></div>
        {openedAppearance && <div hidden={tab !== 'appearance'}>
          <CreatorDesignStudio ownerId={ownerId} draft={draft} catalog={{ name: catalog.name, products: visible }} onSaved={setSavedDesign} />
        </div>}
        {tab === 'preview' && <div>
          <div className="catalog-heading"><h1 tabIndex={-1}>{t('Storefront preview')}</h1>
            {isLive && <a href={store}>{t('View live storefront')}</a>}</div>
          <p>{isLive ? t('This is what visitors see now.')
            : t('Private preview with your saved design and published products.')}</p>
          <CreatorStorefront preview design={catalog.publishedDesign ?? savedDesign} catalog={{ name: catalog.name, products: visible }} />
        </div>}
        <div hidden={tab !== 'publishing'}>
          <div className="catalog-heading"><h1 tabIndex={-1}>{t('Storefront publishing')}</h1></div>
          <section className="catalog-panel" aria-label={t('Storefront visibility')}>
            <span className="catalog-badge" data-published={isLive}>{isLive ? t('Public') : t('Private')}</span>
            <h2>{catalog.name}</h2>
            <p>{t('Your public storefront shows published products. Save any appearance changes before publishing your design.')}</p>
            {notice && <p role="status" className="catalog-notice">{notice}</p>}
            <div className="catalog-actions">
              <button className="catalog-primary" type="button" disabled={publishing} onClick={() => void publish(true)}>{isLive
                ? t('Publish saved design') : t('Publish storefront')}</button>
              {isLive && <><button type="button" disabled={publishing} onClick={() => void publish(false)}>{t('Unpublish storefront')}</button>
                <a href={store}>{t('View live storefront')}</a></>}
            </div>
          </section>
          <form className="catalog-panel catalog-form catalog-settings" key={catalog.name} onSubmit={event => void saveSettings(event)}>
            <h2>{t('Storefront settings')}</h2>
            <label htmlFor="storefront-name">{t('Storefront name')}</label>
            <input id="storefront-name" name="name" defaultValue={catalog.name} required maxLength={100} disabled={publishing} />
            <p>{t('Visitors see this name on your storefront. Your storefront link stays the same.')}</p>
            <button type="submit" disabled={publishing}>{t('Save name')}</button>
          </form>
        </div>
      </>}
    </main>
  </div>;
}

export function LiveCreatorStorefront() {
  const { language } = useLocale();
  const [store, setStore] = useState<PublicStorefront>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const handle = location.pathname.split('/')[2];
    api<PublicStorefront>('/account/creator/storefront/' + encodeURIComponent(handle ?? ''), { signal: controller.signal })
      .then(setStore, failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [revision]);
  if (store) return <CreatorStorefront design={store.design} catalog={store} />;
  return <div className="creator-workspace"><main className="catalog-shell catalog-main">
    {error ? <><h1>{language === 'id' ? 'Etalase tidak tersedia' : 'Storefront unavailable'}</h1>
      {error !== 'This creator resource could not be found.' && <button type="button" onClick={() => {
        setError(''); setRevision(value => value + 1);
      }}>{language === 'id' ? 'Coba lagi' : 'Try again'}</button>}
      <p><a href="/creator">{language === 'id' ? 'Kembali ke Nanti Kreator' : 'Back to Nanti Creator'}</a></p></>
      : <p role="status">{language === 'id' ? 'Membuka etalase…' : 'Loading storefront…'}</p>}
  </main></div>;
}
