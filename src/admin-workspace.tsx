import { useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { BarChart3, ChevronDown, ChevronLeft, ChevronRight, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import './admin-workspace.css';

export type WorkspaceItem<Section extends string> = {
  id: Section;
  label: string;
  icon: LucideIcon;
  hidden?: boolean;
};

export function useWorkspaceSection<Section extends string>(
  sections: readonly Section[],
  fallback: Section,
  resolve?: (url: URL) => Section | undefined,
) {
  function fromLocation() {
    const url = new URL(location.href);
    const active = sections.find(section => section === url.searchParams.get('section'));
    return active ?? resolve?.(url) ?? fallback;
  }

  const [active, setActive] = useState(fromLocation);
  useEffect(() => {
    const sync = () => setActive(fromLocation());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  });

  function href(section: Section) {
    const url = new URL(location.href);
    if (section === fallback) url.searchParams.delete('section');
    else url.searchParams.set('section', section);
    url.hash = '';
    return url.pathname + url.search;
  }

  function open(section: Section) {
    if (section === active) return;
    history.pushState(null, '', href(section));
    setActive(section);
  }

  return { active, href, open };
}

export function AdminWorkspace<Section extends string>({
  name, items, section, account, accountActions, secondaryActions, children, language = 'id',
}: {
  name: string;
  items: readonly WorkspaceItem<Section>[];
  section: { active: Section; open: (section: Section) => void; href: (section: Section) => string };
  account: string;
  accountActions: ReactNode;
  secondaryActions?: ReactNode;
  children: ReactNode;
  language?: 'id' | 'en';
}) {
  const id = useId();
  const main = useRef<HTMLElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const movedFromDrawer = useRef(false);
  const previousSection = useRef(section.active);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('nanti.workspace.sidebar') === 'collapsed'; }
    catch { return false; }
  });
  const en = language === 'en';
  const item = items.find(entry => entry.id === section.active);
  const accountLabel = en ? 'Account menu' : 'Menu akun';
  const collapseLabel = collapsed ? (en ? 'Expand sidebar' : 'Perluas panel navigasi') : (en ? 'Collapse sidebar' : 'Ringkas panel navigasi');

  useEffect(() => {
    const desktop = matchMedia('(min-width: 48rem)');
    const close = () => { if (desktop.matches) drawer.current?.close(); };
    desktop.addEventListener('change', close);
    return () => desktop.removeEventListener('change', close);
  }, []);

  useEffect(() => {
    if (previousSection.current === section.active) return;
    previousSection.current = section.active;
    const frame = requestAnimationFrame(() => {
      if (main.current?.contains(document.activeElement)) return;
      (main.current?.querySelector<HTMLElement>('h1:not([hidden] h1)') ?? main.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [section.active]);

  function toggleSidebar() {
    setCollapsed(!collapsed);
    try { localStorage.setItem('nanti.workspace.sidebar', collapsed ? 'expanded' : 'collapsed'); }
    catch { /* The sidebar still works when local storage is blocked. */ }
  }

  function navigate(event: MouseEvent<HTMLAnchorElement>, target: Section) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    movedFromDrawer.current = Boolean(drawer.current?.open && target !== section.active);
    drawer.current?.close();
    section.open(target);
  }

  function navigation() {
    return <nav aria-label={en ? 'Workspace navigation' : 'Navigasi ruang kerja'} className="aw-nav">
      {items.filter(entry => !entry.hidden).map(({ id: key, icon: Icon, label }) =>
        <a key={key} href={section.href(key)} onClick={event => navigate(event, key)}
          aria-label={label} title={label} aria-current={key === section.active ? 'page' : undefined}>
          <Icon size={18} aria-hidden="true" /><span>{label}</span>
        </a>)}
    </nav>;
  }

  const brand = <a className="aw-brand" href={section.href(items[0]!.id)}
    onClick={event => navigate(event, items[0]!.id)} aria-label={name}>
    <span className="brand-symbol" aria-hidden="true" />
    <span className="aw-brand-copy"><strong>nanti<span>.</span></strong><small>{name}</small></span>
  </a>;

  return <div className="aw" data-collapsed={collapsed} lang={language}>
    <a className="aw-skip" href={'#' + id}>{en ? 'Skip to content' : 'Lewati ke konten'}</a>
    <aside className="aw-sidebar">{brand}{navigation()}</aside>
    <dialog ref={drawer} className="aw-drawer" aria-label={en ? 'Workspace navigation' : 'Navigasi ruang kerja'}
      onClick={event => { if (event.target === event.currentTarget) drawer.current?.close(); }}
      onClose={() => {
        setDrawerOpen(false);
        if (!movedFromDrawer.current) mobileToggle.current?.focus();
        movedFromDrawer.current = false;
      }}>
      <div className="aw-drawer-content">
        <div className="aw-drawer-header">{brand}
          <button type="button" className="aw-icon-button" aria-label={en ? 'Close navigation' : 'Tutup navigasi'}
            onClick={() => drawer.current?.close()}><X size={18} aria-hidden="true" /></button>
        </div>
        {navigation()}
      </div>
    </dialog>
    <div className="aw-body">
      <header className="aw-topbar">
        <button type="button" className="aw-icon-button aw-desktop-toggle" aria-label={collapseLabel} title={collapseLabel}
          onClick={toggleSidebar}>{collapsed ? <PanelLeftOpen size={19} aria-hidden="true" /> : <PanelLeftClose size={19} aria-hidden="true" />}</button>
        <button type="button" className="aw-icon-button aw-mobile-toggle" ref={mobileToggle}
          aria-label={en ? 'Open navigation' : 'Buka navigasi'} aria-expanded={drawerOpen} aria-haspopup="dialog"
          onClick={() => { drawer.current?.showModal(); setDrawerOpen(true); }}><Menu size={20} aria-hidden="true" /></button>
        <nav className="aw-breadcrumb" aria-label={en ? 'Breadcrumb' : 'Jejak navigasi'}>
          <a href={section.href(items[0]!.id)} onClick={event => navigate(event, items[0]!.id)}>{name}</a>
          <ChevronRight size={14} aria-hidden="true" />
          <span aria-current="page">{item?.label}</span>
        </nav>
        <div className="aw-top-actions">
          {secondaryActions}
          <details className="aw-account" ref={details} onToggle={event => setAccountOpen(event.currentTarget.open)}
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
            onKeyDown={event => {
              if (event.key !== 'Escape' || !details.current?.open) return;
              details.current.open = false;
              details.current.querySelector('summary')?.focus();
            }}>
            <summary role="button" aria-expanded={accountOpen} aria-label={accountLabel} title={accountLabel}>
              <span className="aw-avatar" aria-hidden="true">{account.trim().charAt(0).toUpperCase() || 'N'}</span>
              <span className="aw-account-name">{account}</span><ChevronDown size={14} aria-hidden="true" />
            </summary>
            <div className="aw-account-menu">
              <strong>{account}</strong>
              {accountActions}
            </div>
          </details>
        </div>
      </header>
      <main className="aw-main" id={id} tabIndex={-1} ref={main}>{children}</main>
    </div>
  </div>;
}

export function WorkspaceHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <header className="aw-heading">
    <div><h1 tabIndex={-1}>{title}</h1>{description && <p>{description}</p>}</div>
    {action}
  </header>;
}

export function WorkspaceStats({ items, locale = 'id-ID' }: { items: readonly { label: string; value: number; icon: LucideIcon }[]; locale?: string }) {
  return <dl className="aw-stats">
    {items.map(({ label, value, icon: Icon }) => <div className="aw-card aw-stat" key={label}>
      <dt>{label}<Icon size={17} aria-hidden="true" /></dt>
      <dd>{value.toLocaleString(locale)}</dd>
    </div>)}
  </dl>;
}

export function WorkspaceEmpty({ title, description, icon: Icon, action }: {
  title: string; description?: string; icon?: LucideIcon; action?: ReactNode;
}) {
  return <div className="aw-empty">
    {Icon && <span className="aw-empty-icon"><Icon size={21} aria-hidden="true" /></span>}
    <p><strong>{title}</strong></p>
    {description && <p>{description}</p>}
    {action}
  </div>;
}

export function WorkspaceAnalytics({ language = 'id' }: { language?: 'id' | 'en' }) {
  const en = language === 'en';
  return <>
    <WorkspaceHeading title={en ? 'Analytics' : 'Analitik'} />
    <section className="aw-card"><WorkspaceEmpty icon={BarChart3} title={en ? 'Coming soon' : 'Segera Hadir'} /></section>
  </>;
}

export function WorkspaceLoading({ label = 'Memuat data…' }: { label?: string }) {
  return <div className="aw-card aw-loading" role="status">
    <span>{label}</span>
    <div aria-hidden="true" /><div aria-hidden="true" /><div aria-hidden="true" />
  </div>;
}

export function WorkspacePagination({ page, pages, onPage, language = 'id' }: {
  page: number; pages: number; onPage: (page: number) => void; language?: 'id' | 'en';
}) {
  if (pages < 2) return null;
  const en = language === 'en';
  return <nav className="aw-pagination" aria-label={en ? 'Pagination' : 'Halaman hasil'}>
    <button type="button" className="aw-icon-button" aria-label={en ? 'Previous page' : 'Halaman sebelumnya'}
      disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
    <span aria-live="polite">{page} / {pages}</span>
    <button type="button" className="aw-icon-button" aria-label={en ? 'Next page' : 'Halaman berikutnya'}
      disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
  </nav>;
}

export function WorkspaceThumbnail({ image, name }: { image: string | null; name: string }) {
  return <span className="aw-thumb" aria-hidden="true">
    <span>{name.slice(0, 1).toUpperCase()}</span>
    {image && <img src={image} loading="lazy" decoding="async" alt=""
      onError={event => { event.currentTarget.hidden = true; }} />}
  </span>;
}
