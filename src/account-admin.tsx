import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, errorMessage } from './api.js';
import { announceAuthChange } from './account.js';
import type { AccountStatus } from '../shared/account.js';
import './account-admin.css';

type Role = 'member' | 'admin';
type Provider = 'google' | 'apple';
type Dashboard = {
  profile: { id: string; displayName: string | null; role: Role; identities: { provider: Provider }[] };
  users: { id: string; displayName: string | null; role: Role; createdAt: string }[];
  activity: { id: string; userId: string | null; kind: 'signed_in' | 'signed_out'; provider: Provider | null; createdAt: string }[];
};
type View = { kind: 'loading' | 'forbidden' } | { kind: 'signin'; google: boolean }
  | { kind: 'error'; message: string } | { kind: 'ready'; data: Dashboard };

const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const providerLabel = { google: 'Google', apple: 'Apple' };
const roleLabel = { admin: 'Administrator', member: 'Member' };

function AdminSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="account-admin-panel" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>{title}</h2>
    {children}
  </section>;
}

export function AccountAdmin() {
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

  const ready = view.kind === 'ready';
  return <div className="site account-admin">
    <header className="masthead">
      <a href="/" className="brand-group account-admin-brand" aria-label="Nanti home">
        <span className="brand-symbol" aria-hidden="true" />
        <span className="brand">nanti<span>.</span></span>
      </a>
      <div className="actions">
        <a href="/admin">Affiliate Center</a>
        {(ready || view.kind === 'forbidden') &&
          <button type="button" disabled={pending !== null} onClick={() => void signOut()}>Sign out</button>}
      </div>
    </header>
    <main>
      {error && <p className="error" role="alert">{error}</p>}
      {ready ? <>
        <div className="account-admin-heading">
          <h1>Admin dashboard</h1>
          <p>Manage access and review recent account activity.</p>
        </div>
        <nav className="account-admin-nav" aria-label="Dashboard">
          <a href="#overview">Overview</a><a href="#users">Users</a><a href="#activity">Activity</a>
          <button type="button" onClick={reload}>Refresh</button>
        </nav>
        <AdminSection id="overview" title="Your administrator profile">
          <dl className="admin-facts">
            <div><dt>Name</dt><dd>{view.data.profile.displayName || 'Unnamed account'}</dd></div>
            <div><dt>Role</dt><dd>{roleLabel[view.data.profile.role]}</dd></div>
            <div><dt>Sign-in methods</dt><dd>{view.data.profile.identities.map(({ provider }) => providerLabel[provider]).join(', ') || 'None'}</dd></div>
            <div><dt>Account ID</dt><dd><code>{view.data.profile.id}</code></dd></div>
          </dl>
          <p>Administrators can view accounts and authentication activity. Members can manage their own Nanti account and wishlists.</p>
        </AdminSection>
        <AdminSection id="users" title="Recent users">
          {view.data.users.length ? <ul className="account-admin-records">
            {view.data.users.map(user => <li key={user.id}>
              <div><strong>{user.displayName || 'Unnamed account'}</strong><code>{user.id}</code></div>
              <span className="account-admin-role">{roleLabel[user.role]}</span>
              <time dateTime={user.createdAt}>{date.format(new Date(user.createdAt))}</time>
            </li>)}
          </ul> : <p>No users yet.</p>}
        </AdminSection>
        <AdminSection id="activity" title="Recent authentication activity">
          {view.data.activity.length ? <ul className="account-admin-records">
            {view.data.activity.map(event => <li key={event.id}>
              <div><strong>{event.kind === 'signed_in' ? 'Signed in' : 'Signed out'}</strong>
                {event.userId ? <code>{event.userId}</code> : <span>Deleted account</span>}
              </div>
              {event.provider && <span>{providerLabel[event.provider]}</span>}
              <time dateTime={event.createdAt}>{date.format(new Date(event.createdAt))}</time>
            </li>)}
          </ul> : <p>No authentication activity has been recorded yet.</p>}
        </AdminSection>
      </> : <section className="account-admin-panel account-admin-gate" aria-labelledby="admin-heading">
        <h1 id="admin-heading">Nanti administration</h1>
        {view.kind === 'loading' && <p role="status">Checking your session…</p>}
        {view.kind === 'error' && <><p role="alert">{view.message}</p><button type="button" onClick={reload}>Try again</button></>}
        {view.kind === 'forbidden' && <p role="alert">This account requires an administrator role. Sign out to switch accounts.</p>}
        {view.kind === 'signin' && <>
          <p>Sign in with your administrator account.</p>
          {notice === 'failed' && <p role="alert">Could not finish signing in. Try again.</p>}
          {notice === 'cancelled' && <p role="status">Sign-in was cancelled.</p>}
          {notice === 'signed-out' && <p role="status">You signed out.</p>}
          {!notice && <p>If your session expired, sign in again to continue.</p>}
          {view.google ? <button type="button" className="account-admin-primary" disabled={pending !== null}
            onClick={() => void signIn()}>Continue with Google</button> : <p role="status">Google sign-in is unavailable.</p>}
          {pending && <p role="status">{pending === 'starting' ? 'Starting Google sign-in…' : 'Redirecting to Google…'}</p>}
        </>}
      </section>}
    </main>
  </div>;
}
