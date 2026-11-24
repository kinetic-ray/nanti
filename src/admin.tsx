import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import type {
  AdminNotice, AdminPage, NoticeKind,
} from '../shared/affiliate.js';
import { api, errorMessage } from './api.js';
import { AdminProducts } from './admin-products.js';
import { RecommendationAdminPanel } from './RecommendationAdminPanel.js';

import { BarChart3, Bell, ClipboardList, ContactRound, Home, LayoutDashboard, ListChecks, LogOut, Package, Settings, Store, Users } from 'lucide-react';
import { AdminWorkspace, WorkspaceAnalytics, WorkspaceHeading, useWorkspaceSection } from './admin-workspace.js';
import { PlatformActivity, PlatformDirectory, PlatformOverview, PlatformSettings } from './platform-workspace.js';

const admin = '/admin';
type Session = { username: string };
type Inbox = AdminPage<AdminNotice> & { unread: number };
const notices: Record<NoticeKind, string> = {
  new_opportunity: 'Produk baru disimpan', candidate_review: 'Kandidat menunggu ditinjau',
  mapping_revoked: 'Pemetaan dicabut', mapping_invalid: 'Pemetaan ditandai tidak valid',
  new_user: 'Pengguna baru terdaftar', system_failure: 'Gangguan sistem perlu ditinjau',
};
function recordedAt(value: string | null) {
  return value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

function nextPath(path: string, after: string) { return `${path}?after=${encodeURIComponent(after)}`; }

const superadminSections = ['overview', 'products', 'users', 'storefronts', 'creator-products', 'notifications',
  'recommendations', 'audit', 'analytics', 'settings'] as const;

function NotificationBell({ href, open }: { href: string; open: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => api<Inbox>(`${admin}/notifications`).then(value => {
      if (active) setUnread(value.unread);
    }, () => undefined);
    const refresh = () => void load();
    void load();
    const timer = window.setInterval(() => void load(), 45_000);
    window.addEventListener('nanti-admin-notifications-change', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('nanti-admin-notifications-change', refresh); };
  }, []);
  const label = unread ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi';
  return <a className="aw-icon-button aw-notification-link" href={href} onClick={open} aria-label={label} title={label}>
    <Bell size={19} aria-hidden="true" />{unread > 0 && <span className="aw-notification-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
  </a>;
}

export function AdminCenter() {
  const section = useWorkspaceSection(superadminSections, 'overview', url => {
    if (url.hash.startsWith('#opportunity-') || url.searchParams.get('section') === 'links') return 'products';
    if (url.searchParams.get('section') === 'creators') return 'users';
    return undefined;
  });
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  const onExpired = useCallback(() => {
    setSession(null);
    setError('Sesi Superadmin berakhir. Masuk lagi untuk melanjutkan.');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api<Session>(admin + '/session', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setSession(data);
    }, (failure: unknown) => {
      if (controller.signal.aborted) return;
      const message = errorMessage(failure);
      setError(message === 'Administrator sign-in is required.' ? '' : message);
      setSession(null);
    });
    return () => controller.abort();
  }, [attempt]);

  async function signOut() {
    setBusy(true);
    try {
      await api(admin + '/logout', { method: 'POST' });
      setSession(null);
      setError('');
    } catch (failure) {
      const message = errorMessage(failure);
      if (message === 'Administrator sign-in is required.') onExpired();
      else setError(message);
    } finally { setBusy(false); }
  }

  if (!session) return <div className="aw-gate">
    <main className="aw-card">
      <a className="aw-brand" href="/" aria-label="Beranda Nanti"><span className="brand-symbol" aria-hidden="true" />
        <span className="aw-brand-copy"><strong>nanti<span>.</span></strong></span></a>
      {session === undefined ? <p role="status">Memeriksa sesi Superadmin…</p> :
        <SignIn error={error} onRetry={() => { setSession(undefined); setError(''); setAttempt(value => value + 1); }}
          onSignIn={async (username, password) => {
            setSession(await api<Session>(admin + '/login', { method: 'POST', data: { username, password } }));
            setError('');
          }} />}
      <a href="/admin?view=accounts">Administrasi akun Google</a>
    </main>
  </div>;

  const active = section.active;
  return <AdminWorkspace name="Superadmin" section={section} account={session.username} items={[
    { id: 'overview', label: 'Ringkasan', icon: LayoutDashboard },
    { id: 'products', label: 'Produk', icon: Package },
    { id: 'users', label: 'Pengguna', icon: Users },
    { id: 'storefronts', label: 'Etalase', icon: Store },
    { id: 'creator-products', label: 'Produk kreator', icon: Package, hidden: true },
    { id: 'notifications', label: 'Notifikasi', icon: Bell },
    { id: 'recommendations', label: 'Rekomendasi', icon: ListChecks },
    { id: 'audit', label: 'Aktivitas audit', icon: ClipboardList },
    { id: 'analytics', label: 'Analitik', icon: BarChart3 },
    { id: 'settings', label: 'Pengaturan', icon: Settings },
  ]} secondaryActions={<NotificationBell href={section.href('notifications')} open={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); section.open('notifications');
  }} />} accountActions={<>
    <a href="/"><Home size={16} aria-hidden="true" />Beranda Nanti</a>
    <button type="button" disabled={busy} onClick={() => void signOut()}><LogOut size={16} aria-hidden="true" />Keluar</button>
  </>}>
    {error && <p role="alert" className="aw-error">{adminError(error)}</p>}
    {active === 'overview' && <PlatformOverview open={section.open} onExpired={onExpired} />}
    {active === 'products' && <AdminProducts onExpired={onExpired} />}
    {active === 'users' && <PlatformDirectory key={active} directory="users" onExpired={onExpired} />}
    {active === 'storefronts' && <>
      <button type="button" onClick={() => section.open('creator-products')}>Kelola produk kreator</button>
      <PlatformDirectory key={active} directory="storefronts" onExpired={onExpired} />
    </>}
    {active === 'creator-products' && <>
      <button type="button" onClick={() => section.open('storefronts')}>Kembali ke etalase</button>
      <PlatformDirectory key={active} directory="products" onExpired={onExpired} />
    </>}
    {active === 'notifications' && <div className="aw-affiliate">
      <WorkspaceHeading title="Pusat notifikasi" description="Periksa kiriman produk, akun baru, dan gangguan yang perlu ditangani." />
      <NotificationInbox onExpired={onExpired} />
    </div>}
    {active === 'recommendations' && <RecommendationAdminPanel onExpired={onExpired} />}
    {active === 'audit' && <PlatformActivity onExpired={onExpired} />}
    {active === 'analytics' && <WorkspaceAnalytics />}
    {active === 'settings' && <PlatformSettings onExpired={onExpired} />}
  </AdminWorkspace>;
}

function adminError(message: string) {
  const translations: Record<string, string> = {
    'Administrator sign-in is not configured.': 'Akses Superadmin belum dikonfigurasi.',
    'The username or password is incorrect.': 'Nama pengguna atau kata sandi salah.',
    'Too many sign-in attempts. Try again in 15 minutes.': 'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.',
    'Database temporarily unavailable. Try again shortly.': 'Database sementara tidak tersedia. Coba lagi.',
    'This product identity could not be found.': 'Produk tidak ditemukan.',
  };
  return translations[message] ?? (message.startsWith('Sesi Superadmin') ? message : 'Permintaan belum berhasil. Coba lagi.');
}

function SignIn({ error, onRetry, onSignIn }: {
  error: string; onRetry: () => void; onSignIn: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const isDisabled = error === 'Administrator sign-in is not configured.';
  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(''); setBusy(true);
    try { await onSignIn(username, password); }
    catch (failure) { setFailed(errorMessage(failure)); }
    finally { setBusy(false); setPassword(''); }
  }

  return <section className="aw-section-stack">
    <h1>Masuk sebagai Superadmin</h1>
    {(failed || error) && <p className="aw-error" role="alert">{adminError(failed || error)}</p>}
    {isDisabled ? <button type="button" onClick={onRetry}>Periksa lagi</button> :
      <form onSubmit={submit}>
        <label>Nama pengguna<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)}
          required maxLength={64} disabled={busy} /></label>
        <label>Kata sandi<input type="password" autoComplete="current-password" value={password}
          onChange={(event) => setPassword(event.target.value)} required maxLength={256} disabled={busy} /></label>
        <div className="aw-actions">
          <button className="aw-primary" disabled={busy}>{busy ? 'Sedang masuk…' : 'Masuk'}</button>
          {error && <button type="button" disabled={busy} onClick={onRetry}>Periksa sesi lagi</button>}
        </div>
      </form>}
  </section>;
}


function NotificationInbox({ onExpired }: { onExpired: () => void }) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [revision, refresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<Inbox>(admin + '/notifications', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setInbox(data);
    }, failure => {
      if (controller.signal.aborted) return;
      const message = errorMessage(failure);
      if (message === 'Administrator sign-in is required.') onExpired();
      else setError(message);
    });
    return () => controller.abort();
  }, [onExpired, revision]);

  async function run(work: () => Promise<unknown>, message?: string) {
    setError(''); setBusy(true); setFeedback('');
    try {
      await work();
      if (message) { setFeedback(message); refresh(value => value + 1); }
    } catch (failure) {
      const message = errorMessage(failure);
      if (message === 'Administrator sign-in is required.') onExpired();
      else setError(message);
    } finally { setBusy(false); }
  }

  async function updateNotice(notice: AdminNotice, action: 'read' | 'unread' | 'dismiss') {
    await run(async () => {
      await api(`${admin}/notifications/${notice.id}`, { method: 'PATCH', data: { action } });
      window.dispatchEvent(new Event('nanti-admin-notifications-change'));
      setInbox((current) => current && ({
        ...current,
        unread: Math.max(0, current.unread + (action === 'unread' && notice.readAt ? 1 : !notice.readAt && action !== 'unread' ? -1 : 0)),
        records: action === 'dismiss' ? current.records.filter(({ id }) => id !== notice.id) :
          current.records.map((row) => row.id === notice.id ? { ...row, readAt: action === 'read' ? new Date().toISOString() : null } : row),
      }));
    });
  }

  async function markAllRead() {
    await run(async () => {
      await api(`${admin}/notifications/read-all`, { method: 'POST' });
      window.dispatchEvent(new Event('nanti-admin-notifications-change'));
      setInbox(current => current ? { ...current, unread: 0,
        records: current.records.map(row => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })) } : current);
    });
  }

  return <>
    {error && <p className="error" role="alert">{adminError(error)}</p>}
    <p className="decision-status" role="status">{feedback}</p>
    <section className="admin-panel">
      <header className="aw-card-header"><h2>Notifikasi</h2><div className="aw-actions">
        <button type="button" disabled={busy || !inbox?.unread} onClick={() => void markAllRead()}>Tandai semua dibaca</button>
      </div></header>
      {!inbox ? <p role="status">Memuat notifikasi…</p> : inbox.records.length === 0 ? <p>Belum ada notifikasi.</p> :
        <ul className="admin-records">{inbox.records.map((notice) => <li key={notice.id}>
          <div><strong>{notices[notice.kind] ?? 'Notifikasi sistem'}</strong>
            <p>{notice.title ?? notice.listingId ?? 'Ada aktivitas baru yang perlu diperiksa.'}</p>
            <small>{notice.readAt ? 'Sudah dibaca' : 'Belum dibaca'} · {recordedAt(notice.createdAt)}</small></div>
          <div className="actions">
            <a className="buy-original" href={notice.targetPath} onClick={event => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              event.stopPropagation();
              const target = new URL(notice.targetPath, window.location.origin);
              history.pushState(null, '', target.pathname + target.search + target.hash);
              window.dispatchEvent(new PopStateEvent('popstate'));
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            }}>Buka</a>
            <button type="button" disabled={busy} onClick={() => void updateNotice(notice, notice.readAt ? 'unread' : 'read')}>
              {notice.readAt ? 'Tandai belum dibaca' : 'Tandai sudah dibaca'}
            </button>
            <button type="button" disabled={busy} onClick={() => void updateNotice(notice, 'dismiss')}>Singkirkan</button>
          </div>
        </li>)}</ul>}
      {inbox?.next && <button type="button" disabled={busy} onClick={() => void run(async () => {
        const loaded = await api<Inbox>(nextPath(`${admin}/notifications`, inbox.next!));
        setInbox({ ...loaded, records: [...inbox.records, ...loaded.records] });
      })}>Muat notifikasi sebelumnya</button>}
    </section>
  </>;
}
