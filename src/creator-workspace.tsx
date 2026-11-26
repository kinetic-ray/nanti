import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, BarChart3, CircleCheck, Clock3, ExternalLink, Eye, FileText, LayoutDashboard, LogOut, Package, Palette, Plus, Settings, Store, UserRound } from 'lucide-react';
import type { CreatorCatalog, PublicStorefront } from '../shared/creator-catalog.js';
import { validateDesign } from '../shared/creator-design.js';
import { announceAuthChange } from './account.js';
import { AdminWorkspace, WorkspaceAnalytics, WorkspaceEmpty, WorkspaceHeading, WorkspaceLoading, WorkspaceStats, WorkspaceThumbnail, useWorkspaceSection } from './admin-workspace.js';
import { api, errorMessage } from './api.js';
import { CreatorProducts } from './creator-products.js';
import { CreatorDesignStudio } from './creator-studio.js';
import { CreatorStorefront } from './creator-storefront.js';
import { LanguagePicker, useLocale } from './locale.js';
import './creator-workspace.css';

const path = '/account/creator/catalog';
const sections = ['overview', 'products', 'storefront', 'appearance', 'preview', 'settings', 'analytics'] as const;

export function CreatorWorkspace({ ownerId, draft }: { ownerId: string; draft: unknown }) {
  const { language, t, date, error } = useLocale();
  const l = (id: string, en: string) => language === 'id' ? id : en;
  const section = useWorkspaceSection(sections, 'overview');
  const active = section.active;
  const [openedAppearance, setOpenedAppearance] = useState(active === 'appearance');
  const [startDraft, setStartDraft] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CreatorCatalog>();
  const [loadFailure, setLoadFailure] = useState('');
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [reload, setReload] = useState(0);
  const [savedDesign, setSavedDesign] = useState(() => validateDesign(draft));
  const unpublish = useRef<HTMLDialogElement>(null);
  const catalogRequest = useRef(0);

  useEffect(() => {
    if (active === 'appearance') setOpenedAppearance(true);
  }, [active]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++catalogRequest.current;
    try {
      const data = await api<CreatorCatalog>(path, { signal });
      if (requestId === catalogRequest.current && !signal?.aborted) {
        setCatalog(data);
        setLoadFailure('');
      }
    } catch (problem) {
      if (requestId === catalogRequest.current && !signal?.aborted) throw problem;
    }
  }, []);

  useEffect(() => {
    if (active === 'analytics') return;
    const controller = new AbortController();
    void load(controller.signal).catch(problem => setLoadFailure(errorMessage(problem)));
    return () => controller.abort();
  }, [active, load, reload]);

  async function updateStore(operation: () => Promise<unknown>, feedback: string) {
    setBusy(true);
    setFailure('');
    setNotice('');
    try {
      await operation();
      setNotice(feedback);
      await load();
    } catch (problem) {
      setFailure(errorMessage(problem));
    } finally { setBusy(false); }
  }

  async function publish(published: boolean) {
    await updateStore(async () => {
      await api(path + '/publication', { method: 'PUT', data: { published } });
      unpublish.current?.close();
    }, t(published ? 'Storefront published.' : 'Storefront unpublished.'));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (!name) {
      setFailure(t('Enter a creator name.'));
      event.currentTarget.querySelector('input')?.focus();
      return;
    }
    await updateStore(() => api(path + '/settings', { method: 'PATCH', data: { name } }), t('Storefront name saved.'));
  }

  async function signOut() {
    setSigningOut(true);
    setFailure('');
    try {
      await api('/account/logout', { method: 'POST' });
      announceAuthChange();
      location.replace('/account?next=creator');
    } catch (problem) {
      setFailure(errorMessage(problem));
      setSigningOut(false);
    }
  }

  function addProduct() {
    setStartDraft(crypto.randomUUID());
    section.open('products');
  }

  const visible = catalog?.products.filter(product => product.published) ?? [];
  const store = catalog ? '/store/' + catalog.handle : '';
  const isLive = Boolean(catalog?.publishedDesign);
  const hasDesignUpdate = isLive && JSON.stringify(catalog?.publishedDesign) !== JSON.stringify(savedDesign);
  const labels = {
    overview: t('Overview'), products: t('Products'), storefront: l('Etalase', 'Storefront'), appearance: t('Appearance'),
    preview: t('Storefront preview'), settings: l('Pengaturan', 'Settings'), analytics: l('Analitik', 'Analytics'),
  };
  const catalogSection = active !== 'analytics';
  return <AdminWorkspace name={l('Studio Kreator', 'Creator Studio')} section={section} language={language} hideCurrentPage
    items={[
      { id: 'overview', label: labels.overview, icon: LayoutDashboard },
      { id: 'products', label: labels.products, icon: Package },
      { id: 'storefront', label: labels.storefront, icon: Store },
      { id: 'appearance', label: labels.appearance, icon: Palette },
      { id: 'preview', label: labels.preview, icon: Eye, hidden: true },
      { id: 'analytics', label: labels.analytics, icon: BarChart3 },
      { id: 'settings', label: labels.settings, icon: Settings },
    ]}
    account={catalog?.name ?? l('Kreator', 'Creator')}
    accountActions={<>
      <a href="/"><ArrowLeft size={16} aria-hidden="true" />{t('Back to wishlists')}</a>
      <a href="/account"><UserRound size={16} aria-hidden="true" />{t('Account')}</a>
      <button type="button" disabled={signingOut} onClick={() => void signOut()}><LogOut size={16} aria-hidden="true" />{l('Keluar', 'Sign out')}</button>
    </>}
    secondaryActions={<LanguagePicker />}>
    {catalogSection && !catalog && <>
      <WorkspaceHeading title={labels[active]} />
      {loadFailure ? <div className="aw-error aw-actions" role="alert">
        <span>{error(loadFailure)}</span>
        {loadFailure === 'Sign in to continue.' ? <a href="/account?next=creator">{t('Sign in again')}</a>
          : <button type="button" onClick={() => { setLoadFailure(''); setReload(value => value + 1); }}>{t('Try again')}</button>}
      </div> : <WorkspaceLoading label={t('Loading your storefront…')} />}
    </>}
    {failure && !unpublish.current?.open && <p className="aw-error" role="alert">{error(failure)} {failure === 'Sign in to continue.'
      ? <a href="/account?next=creator">{t('Sign in again')}</a> : <button type="button"
        onClick={() => { setFailure(''); void load().catch(problem => setFailure(errorMessage(problem))); }}>{t('Try again')}</button>}</p>}
    {catalog && <>
      {active === 'overview' && <>
        <WorkspaceHeading title={labels.overview}
          description={l('Pantau katalog dan aktivitas produk etalasemu.', 'Review your catalog and recent storefront product activity.')}
          action={<button type="button" className="aw-primary" onClick={addProduct}><Plus size={17} aria-hidden="true" />{t('Add product')}</button>} />
        <WorkspaceStats locale={language === 'id' ? 'id-ID' : 'en-US'} items={[
          { label: l('Total produk', 'Total products'), value: catalog.products.length, icon: Package },
          { label: l('Produk terbit', 'Published products'), value: visible.length, icon: CircleCheck },
          { label: l('Produk draf', 'Draft products'), value: catalog.products.length - visible.length, icon: FileText },
        ]} />
        <section className="aw-card" aria-labelledby="creator-activity">
          <header className="aw-card-header"><div><h2 id="creator-activity">{l('Aktivitas produk terbaru', 'Recent product activity')}</h2>
            <p>{l('Produk yang terakhir ditambahkan ke katalog.', 'Products most recently added to your catalog.')}</p></div>
            <button type="button" onClick={() => section.open('products')}>{t('Manage products')}</button>
          </header>
          {catalog.products.length ? <ul className="aw-activity">{catalog.products.slice(0, 5).map(item => <li key={item.id}>
            <WorkspaceThumbnail name={item.title} image={item.image} />
            <div><strong>{item.title}</strong><p className="aw-muted">{l('Ditambahkan ke katalog', 'Added to catalog')}</p></div>
            <span className="aw-badge" data-live={item.published}>{t(item.published ? 'Published' : 'Draft')}</span>
            {item.createdAt && <time dateTime={item.createdAt}>{date(item.createdAt)}</time>}
          </li>)}</ul> : <WorkspaceEmpty icon={Clock3} title={l('Belum ada aktivitas produk', 'No product activity yet')}
            description={l('Produk yang kamu tambahkan akan muncul di sini.', 'Products you add will appear here.')} />}
        </section>
        <section className="aw-card"><header className="aw-card-header">
          <div><h2>{catalog.name}</h2><p>{l('Etalase kreator', 'Creator storefront')}</p></div>
          <div className="aw-actions"><span className="aw-badge" data-live={isLive}>{t(isLive ? 'Storefront live' : 'Storefront private')}</span>
            <button type="button" onClick={() => section.open('storefront')}>{l('Kelola etalase', 'Manage storefront')}</button></div>
        </header></section>
      </>}
      <div hidden={active !== 'products'}>
        <CreatorProducts catalog={catalog} load={load} openPublishing={() => section.open('storefront')} startDraft={startDraft} />
      </div>
      {openedAppearance && <div hidden={active !== 'appearance'}>
        <WorkspaceHeading title={labels.appearance} description={l('Atur desain dan urutan konten etalase.', 'Customize your storefront design and section order.')} />
        <CreatorDesignStudio ownerId={ownerId} draft={draft} catalog={{ name: catalog.name, products: visible }} onSaved={setSavedDesign} />
      </div>}
      {active === 'preview' && <>
        <WorkspaceHeading title={labels.preview}
          description={t(isLive && !hasDesignUpdate ? 'This is what visitors see now.' : 'Private preview with your saved design and published products.')}
          action={<button type="button" onClick={() => section.open('storefront')}>{l('Kembali ke etalase', 'Back to storefront settings')}</button>} />
        <CreatorStorefront preview design={savedDesign} catalog={{ name: catalog.name, products: visible }} />
      </>}
      {active === 'storefront' && <>
        <WorkspaceHeading title={labels.storefront} description={l('Kelola nama dan publikasi etalasemu.', 'Manage your storefront name and publication.')}
          action={<button type="button" onClick={() => section.open('preview')}><Eye size={17} aria-hidden="true" />{t('Preview storefront')}</button>} />
        <div className="aw-section-stack">
          <section className="aw-card" aria-labelledby="storefront-publication">
            <header className="aw-card-header"><h2 id="storefront-publication">{t('Storefront visibility')}</h2>
              <span className="aw-badge" data-live={isLive}>{t(isLive ? 'Storefront live' : 'Storefront private')}</span></header>
            <div className="aw-card-body aw-section-stack">
              <p>{t('{published} of {total} products are published.', { published: visible.length, total: catalog.products.length })}</p>
              {hasDesignUpdate && <p>{t('Publish your saved appearance to show the changes to visitors.')}</p>}
              {!visible.length && <p>{t(catalog.products.length ? 'Publish a product from your catalog to show it here.' : 'Add your first product to get started.')}</p>}
              {notice && <p className="aw-notice" role="status">{notice}</p>}
              {isLive && <p className="aw-public-link"><a href={store} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={16} aria-hidden="true" />{t('View live storefront')}</a></p>}
              <div className="aw-actions">
                {!isLive && visible.length > 0 && <button className="aw-primary" type="button" disabled={busy} onClick={() => void publish(true)}>{t('Publish storefront')}</button>}
                {!visible.length && <button type="button" onClick={() => section.open('products')}>{t('Manage products')}</button>}
                {hasDesignUpdate && <button className="aw-primary" type="button" disabled={busy} onClick={() => void publish(true)}>{t('Publish saved design')}</button>}
                {isLive && <button type="button" disabled={busy} onClick={() => { setFailure(''); unpublish.current?.showModal(); }}>{t('Unpublish storefront')}</button>}
              </div>
            </div>
          </section>
          <form className="aw-card" key={catalog.name} onSubmit={event => void saveSettings(event)}>
            <header className="aw-card-header"><h2>{t('Storefront settings')}</h2></header>
            <div className="aw-card-body aw-section-stack">
              <label className="aw-field">{t('Storefront name')}
                <input name="name" defaultValue={catalog.name} required maxLength={100} disabled={busy}
                  aria-describedby="storefront-name-hint" />
                <small id="storefront-name-hint">{t('Visitors see this name on your storefront. Your storefront link stays the same.')}</small>
              </label>
              <div><button type="submit" disabled={busy}>{t('Save name')}</button></div>
            </div>
          </form>
        </div>
        <dialog ref={unpublish} className="aw-dialog" aria-labelledby="unpublish-storefront-title"
          onCancel={event => { if (busy) event.preventDefault(); }}>
          <h2 id="unpublish-storefront-title">{t('Unpublish storefront')}</h2>
          <p>{l('Pengunjung tidak bisa membuka etalase sampai kamu menerbitkannya lagi.', 'Visitors cannot open your storefront until you publish it again.')}</p>
          {failure && <p className="aw-error" role="alert">{error(failure)}</p>}
          <div className="aw-actions">
            <button type="button" autoFocus disabled={busy} onClick={() => unpublish.current?.close()}>{t('Cancel')}</button>
            <button type="button" className="aw-danger" disabled={busy} onClick={() => void publish(false)}>{t('Unpublish storefront')}</button>
          </div>
        </dialog>
      </>}
      {active === 'settings' && <>
        <WorkspaceHeading title={labels.settings} description={l('Kelola profil kreator dan akun Nanti.', 'Manage your creator profile and Nanti account.')} />
        <div className="aw-section-stack">
          <section className="aw-card"><header className="aw-card-header"><h2>{l('Profil kreator', 'Creator profile')}</h2></header>
            <div className="aw-card-body aw-actions"><strong>{catalog.name}</strong>
              <button type="button" onClick={() => section.open('storefront')}>{l('Ubah nama etalase', 'Change storefront name')}</button></div>
          </section>
          <section className="aw-card"><header className="aw-card-header"><h2>{l('Akun Nanti', 'Nanti account')}</h2></header>
            <div className="aw-card-body aw-section-stack"><p>{l('Kelola nama akun, metode masuk, dan kata sandi dari pengaturan akun.', 'Manage your account name, sign-in methods, and password in account settings.')}</p>
              <div><a href="/account" className="aw-button">{l('Buka pengaturan akun', 'Open account settings')}</a></div>
            </div>
          </section>
        </div>
      </>}
    </>}
    {active === 'analytics' && <WorkspaceAnalytics language={language} />}
  </AdminWorkspace>;
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
