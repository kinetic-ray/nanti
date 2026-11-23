import { useEffect, useState } from 'react';
import { ClipboardList, LayoutDashboard, LogOut, ShieldCheck, Users } from 'lucide-react';
import { api, errorMessage } from './api.js';
import { announceAuthChange } from './account.js';
import type { AccountStatus } from '../shared/account.js';
import { AdminWorkspace, WorkspaceEmpty, WorkspaceHeading, useWorkspaceSection } from './admin-workspace.js';

type Role = 'member' | 'admin';
type Provider = 'google' | 'apple';
type Dashboard = {
  profile: { id: string; displayName: string | null; role: Role; identities: { provider: Provider }[] };
  users: { id: string; displayName: string | null; role: Role; createdAt: string }[];
  activity: { id: string; userId: string | null; kind: 'signed_in' | 'signed_out'; provider: Provider | null; createdAt: string }[];
};
type View = { kind: 'loading' | 'forbidden' } | { kind: 'signin'; google: boolean }
  | { kind: 'error'; message: string } | { kind: 'ready'; data: Dashboard };

const date = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
const providerLabel = { google: 'Google', apple: 'Apple' };
const roleLabel = { admin: 'Administrator', member: 'Anggota' };

const sections = ['overview', 'users', 'activity'] as const;

export function AccountAdmin() {
  const section = useWorkspaceSection(sections, 'overview');
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState<'starting' | 'redirecting' | 'logout' | null>(null);
  const [error, setError] = useState('');
  const [notice] = useState(() => new URLSearchParams(location.search).get('auth'));

  useEffect(() => {
    if (!notice) return;
    const url = new URL(location.href);
    url.searchParams.delete('auth');
    history.replaceState(null, '', url);
    if (notice === 'signed-in') announceAuthChange();
  }, [notice]);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    async function load() {
      try {
        const data = await api<Dashboard>('/account/admin', options);
        if (!controller.signal.aborted) setView({ kind: 'ready', data });
      } catch (failure) {
        if (controller.signal.aborted) return;
        const message = errorMessage(failure);
        if (message === 'Administrator access is required.') {
          setView({ kind: 'forbidden' });
        } else if (message === 'Sign in to continue.') {
          try {
            const status = await api<AccountStatus>('/account', options);
            if (!controller.signal.aborted) setView({ kind: 'signin', google: status.available.includes('google') });
          } catch (statusFailure) {
            if (!controller.signal.aborted) setView({ kind: 'error', message: errorMessage(statusFailure) });
          }
        } else setView({ kind: 'error', message });
      }
    }
    void load();
    return () => controller.abort();
  }, [version]);

  function reload() {
    setView({ kind: 'loading' });
    setError('');
    setVersion(value => value + 1);
  }

  async function signIn() {
    setPending('starting');
    setError('');
    try {
      const next = await api<{ url: string }>('/account/google/start', {
        method: 'POST', data: { purpose: 'signin', destination: 'admin' },
      });
      const url = new URL(next.url);
      if (url.origin !== 'https://accounts.google.com' || url.username || url.password) {
        throw new Error('Google sign-in is unavailable. Try again.');
      }
      setPending('redirecting');
      location.assign(url.href);
    } catch (failure) {
      setError(errorMessage(failure));
      setPending(null);
    }
  }

  async function signOut() {
    setPending('logout');
    setError('');
    try {
      await api('/account/logout', { method: 'POST' });
      announceAuthChange();
      location.replace('/admin?view=accounts&auth=signed-out');
    } catch (failure) {
      setError(errorMessage(failure));
      setPending(null);
    }
  }

  if (view.kind !== 'ready') return <div className="aw-gate">
    <main className="aw-card">
      <a className="aw-brand" href="/" aria-label="Beranda Nanti"><span className="brand-symbol" aria-hidden="true" />
        <span className="aw-brand-copy"><strong>nanti<span>.</span></strong></span></a>
      <h1>Administrasi akun</h1>
      {error && <p className="aw-error" role="alert">Sesi akun belum dapat diproses. Coba lagi.</p>}
      {view.kind === 'loading' && <p role="status">Memeriksa sesi…</p>}
      {view.kind === 'error' && <><p role="alert">Data akun belum dapat dimuat.</p><button type="button" onClick={reload}>Coba lagi</button></>}
      {view.kind === 'forbidden' && <>
        <p role="alert">Akun ini memerlukan peran administrator.</p>
        <button type="button" disabled={pending !== null} onClick={() => void signOut()}>Keluar</button>
      </>}
      {view.kind === 'signin' && <>
        <p>Masuk dengan akun Google administrator.</p>
        {notice === 'failed' && <p role="alert">Proses masuk belum selesai. Coba lagi.</p>}
        {notice === 'cancelled' && <p role="status">Proses masuk dibatalkan.</p>}
        {notice === 'signed-out' && <p role="status">Kamu sudah keluar.</p>}
        {view.google ? <button type="button" className="aw-primary" disabled={pending !== null}
          onClick={() => void signIn()}>Lanjutkan dengan Google</button> : <p role="status">Masuk dengan Google belum tersedia.</p>}
        {pending && <p role="status">{pending === 'starting' ? 'Memulai masuk dengan Google…' : 'Membuka Google…'}</p>}
      </>}
      <p><a href="/admin">Masuk sebagai Superadmin</a></p>
    </main>
  </div>;

  return <AdminWorkspace name="Administrasi akun" section={section} items={[
    { id: 'overview', label: 'Ringkasan', icon: LayoutDashboard },
    { id: 'users', label: 'Pengguna', icon: Users },
    { id: 'activity', label: 'Aktivitas masuk', icon: ClipboardList },
  ]} account={view.data.profile.displayName || 'Administrator'} accountActions={<>
    <a href="/admin"><ShieldCheck size={16} aria-hidden="true" />Superadmin</a>
    <button type="button" disabled={pending !== null} onClick={() => void signOut()}><LogOut size={16} aria-hidden="true" />Keluar</button>
  </>}>
    {error && <p className="aw-error" role="alert">Sesi akun belum dapat diproses. Coba lagi.</p>}
    {section.active === 'overview' && <>
      <WorkspaceHeading title="Ringkasan" description="Lihat profil administrator dan tinjau aktivitas masuk akun Nanti."
        action={<button type="button" onClick={reload}>Muat ulang</button>} />
      <section className="aw-card">
        <header className="aw-card-header"><h2>Profil administrator</h2></header>
        <div className="aw-card-body"><dl className="admin-facts">
          <div><dt>Nama</dt><dd>{view.data.profile.displayName || 'Akun tanpa nama'}</dd></div>
          <div><dt>Peran</dt><dd>{roleLabel[view.data.profile.role]}</dd></div>
          <div><dt>Metode masuk</dt><dd>{view.data.profile.identities.map(({ provider }) => providerLabel[provider]).join(', ') || '—'}</dd></div>
          <div><dt>ID akun</dt><dd><code>{view.data.profile.id}</code></dd></div>
        </dl></div>
      </section>
    </>}
    {section.active === 'users' && <>
      <WorkspaceHeading title="Pengguna" description="Akun yang terakhir terdaftar." action={<button type="button" onClick={reload}>Muat ulang</button>} />
      <section className="aw-card">
        {view.data.users.length ? <ul className="aw-activity">
          {view.data.users.map(user => <li key={user.id}>
            <div><strong>{user.displayName || 'Akun tanpa nama'}</strong><p><code>{user.id}</code></p></div>
            <span className="aw-badge">{roleLabel[user.role]}</span>
            <time dateTime={user.createdAt}>{date.format(new Date(user.createdAt))}</time>
          </li>)}
        </ul> : <WorkspaceEmpty title="Belum ada pengguna" />}
      </section>
    </>}
    {section.active === 'activity' && <>
      <WorkspaceHeading title="Aktivitas masuk" description="Peristiwa autentikasi akun terbaru." action={<button type="button" onClick={reload}>Muat ulang</button>} />
      <section className="aw-card">
        {view.data.activity.length ? <ul className="aw-activity">
          {view.data.activity.map(event => <li key={event.id}>
            <div><strong>{event.kind === 'signed_in' ? 'Masuk' : 'Keluar'}</strong>
              <p>{event.userId ? <code>{event.userId}</code> : 'Akun dihapus'}</p></div>
            {event.provider && <span>{providerLabel[event.provider]}</span>}
            <time dateTime={event.createdAt}>{date.format(new Date(event.createdAt))}</time>
          </li>)}
        </ul> : <WorkspaceEmpty title="Belum ada aktivitas masuk" />}
      </section>
    </>}
  </AdminWorkspace>;
}
