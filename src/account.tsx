import { PasswordForm } from './password-form.js';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { loginProviders } from '../shared/account.js';
import { financialProfileReturnKey } from '../shared/account.js';
import type { AccountStatus, AuthPurpose, LoginProvider } from '../shared/account.js';
import { api, errorMessage } from './api.js';
import { Dialog } from './forms.js';
import { useLocale } from './locale.js';
import type { Message } from './messages.js';
import { Icon } from './visual.js';

export const authNotices = {
  'signed-in': 'You are signed in.',
  linked: 'Sign-in method connected.',
  verified: 'Your sign-in is verified.',
  cancelled: 'Sign-in was cancelled.',
  failed: 'Could not finish signing in. Try again.',
  imported: 'Guest data imported.',
  'signed-out': 'You signed out.',
  deleted: 'Your account was deleted.',
} as const satisfies Record<string, Message>;
export type AuthNotice = keyof typeof authNotices;
export const authChangeKey = 'nanti:account-changed';
export const accountWorkspaceReturnKey = 'nanti:account-workspace-return-until';

export function hasAccountRecovery() {
  const link = new URLSearchParams(location.hash.slice(1));
  return Boolean(link.get('token')) && ['verify', 'reset', 'changeEmail'].includes(link.get('mode') ?? '');
}
const providerNames = { apple: 'Apple', google: 'Google' } as const;
const providerOrigins = { apple: 'https://appleid.apple.com', google: 'https://accounts.google.com' } as const;
type ActiveSession = { id: string; expiresAt: string; current: boolean };
const providerMarks = {
  google: <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#4285f4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5h6.6c3.9-3.6 6.1-8.8 6.1-14.9Z" />
    <path fill="#34a853" d="M24 44c5.5 0 10.2-1.8 13.5-4.6l-6.6-5c-1.8 1.2-4.2 1.9-6.9 1.9-5.3 0-9.9-3.6-11.5-8.4H5.7v5.2A20 20 0 0 0 24 44Z" />
    <path fill="#fbbc05" d="M12.5 27.9a12 12 0 0 1 0-7.8v-5.2H5.7a20 20 0 0 0 0 18.2l6.8-5.2Z" />
    <path fill="#ea4335" d="M24 11.7c3 0 5.7 1 7.8 3l5.9-5.8A19.6 19.6 0 0 0 24 4 20 20 0 0 0 5.7 14.9l6.8 5.2c1.6-4.8 6.2-8.4 11.5-8.4Z" />
  </svg>,
  apple: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M17.1 12.3c0-2 1.6-3 1.7-3.1-1-1.5-2.6-1.7-3.1-1.7-1.4-.2-2.7.8-3.4.8s-1.8-.8-2.9-.7c-1.5 0-2.9.9-3.7 2.2-1.6 2.7-.4 6.8 1.1 9 .7 1 1.6 2.2 2.8 2.2 1.1 0 1.6-.7 3-.7 1.3 0 1.7.7 2.9.7s2-1.1 2.7-2.1c.9-1.2 1.2-2.4 1.2-2.5-.1 0-2.3-.9-2.3-4.1ZM14.8 6c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6 1 .1 1.9-.5 2.5-1.2Z" />
  </svg>,
};

export function announceAuthChange() {
  try { localStorage.setItem(authChangeKey, String(Date.now())); } catch { /* Storage can be blocked. */ }
}

type AccountContentProps = {
  status: AccountStatus | null;
  update: (status: AccountStatus) => void;
} & (
  | { close: () => void; notice: AuthNotice | null; page?: true; section?: never; signOut?: never }
  | { section: 'information' | 'security'; signOut: () => Promise<void>; close?: never; notice?: never; page?: never }
);

export function AccountDialog(props: Omit<Extract<AccountContentProps, { close: () => void }>, 'page'>) {
  return <AccountContent {...props} />;
}

export function AccountSignInPage(props: Parameters<typeof AccountDialog>[0]) {
  return <AccountContent {...props} page />;
}

export function AccountPanel(props: Extract<AccountContentProps, { section: string }>) {
  return <AccountContent {...props} />;
}

function AccountContent({ status, notice, close, update, section, signOut, page }: AccountContentProps) {
  const { t, error: translateError, number, language } = useLocale();
  const [resolvedStatus, setResolvedStatus] = useState<AccountStatus | null>(status);
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [statusLoading, setStatusLoading] = useState(!status);
  const [statusLoadError, setStatusLoadError] = useState(false);
  const currentStatus = status ?? resolvedStatus;
  const account = currentStatus?.account;
  const nextProvider = currentStatus?.available.filter(provider => !account?.providers.includes(provider)) ?? [];
  const verifyProvider = currentStatus?.available.filter(provider => account?.providers.includes(provider)) ?? [];
  const [displayName, setDisplayName] = useState(account?.displayName ?? '');
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileImageFailed, setProfileImageFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const [signingInWith, setSigningInWith] = useState<LoginProvider | null>(null);
  const busy = working || signingInWith !== null;
  const [error, setError] = useState('');
  const [message, setMessage] = useState<Message | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const nextDestination = new URLSearchParams(location.search).get('next');
  const creator = nextDestination === 'creator';
  const financialProfile = nextDestination === 'financial-profile';
  const accountWorkspace = !creator && !financialProfile && /^\/account\/?$/u.test(location.pathname);
  const [deletion, setDeletion] = useState(false);
  const [recovering] = useState(hasAccountRecovery);
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState(false);

  useEffect(() => {
    if (status) {
      setResolvedStatus(status);
      setStatusLoading(false);
      setStatusLoadError(false);
      return;
    }
    const controller = new AbortController();
    setStatusLoading(true);
    setStatusLoadError(false);
    api<AccountStatus>('/account', { signal: controller.signal }).then(current => {
      if (controller.signal.aborted) return;
      setResolvedStatus(current);
      update(current);
    }, () => {
      if (!controller.signal.aborted) setStatusLoadError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setStatusLoading(false);
    });
    return () => controller.abort();
  }, [status, statusAttempt, update]);

  useEffect(() => {
    setDisplayName(account?.displayName ?? '');
    setProfileImageFailed(false);
  }, [account?.displayName, account?.avatarUrl]);

  async function loadSessions() {
    setSessionsLoading(true);
    setSessionsError(false);
    try {
      const result = await api<{ sessions: ActiveSession[] }>('/account/sessions');
      setSessions(result.sessions);
    } catch (failure) {
      if (section && errorMessage(failure) === 'Sign in to continue.') location.reload();
      else setSessionsError(true);
    } finally {
      setSessionsLoading(false);
    }
  }

  async function run(operation: () => Promise<void>) {
    setWorking(true);
    setError('');
    setMessage(null);
    try { await operation(); }
    catch (failure) {
      const text = errorMessage(failure);
      setError(text);
      if (text === 'Sign in to continue.' && section) {
        location.reload();
      } else if (text === 'Verify your sign-in to continue.') {
        const current = await api<AccountStatus>('/account').catch(() => null);
        if (current) update(current);
      }
    } finally { setWorking(false); }
  }

  async function start(provider: LoginProvider, purpose: AuthPurpose) {
    setSigningInWith(provider);
    try {
      const next = await api<{ url: string }>(`/account/${provider}/start`, { method: 'POST', data: {
        purpose, ...(creator && purpose === 'signin' ? { destination: 'creator' } : {}),
      } });
      const url = new URL(next.url);
      if (url.origin !== providerOrigins[provider] || url.username || url.password) {
        throw new Error('This sign-in option is unavailable.');
      }
      if (purpose === 'signin' && (financialProfile || accountWorkspace)) {
        const key = financialProfile ? financialProfileReturnKey : accountWorkspaceReturnKey;
        try { sessionStorage.setItem(key, String(Date.now() + 600_000)); } catch { /* OAuth can continue without storage. */ }
      }
      location.assign(url.href);
    } catch (failure) {
      setSigningInWith(null);
      throw failure;
    }
  }
  async function transition(path: string, method: string, next: AuthNotice) {
    await api(path, { method, data: { confirm: true } });
    location.replace(`/?auth=${next}`);
  }
  function profile(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api('/account', { method: 'PATCH', data: { displayName } });
      const current = await api<AccountStatus>('/account');
      update(current);
      setDisplayName(current.account?.displayName ?? '');
      setEditingProfile(false);
      setMessage('Display name saved.');
    });
  }
  const providerButtons = (choices: LoginProvider[], purpose: AuthPurpose) => choices.map(provider =>
    <button key={provider} type="button" disabled={busy || passwordBusy} className={`account-provider provider-${provider}`}
      onClick={() => void run(() => start(provider, purpose))}>
      <span className="account-provider-mark" aria-hidden="true">{purpose === 'signin' ? providerMarks[provider] : provider === 'google' ? 'G' : '●'}</span>
      <span className="account-provider-label">{t(purpose === 'signin' ? 'Continue with {provider}' : purpose === 'link' ?
        'Connect {provider}' : 'Verify with {provider}', { provider: providerNames[provider] })}</span>
      <Icon name="arrow" />
    </button>);
  const signInProviders = loginProviders.filter(provider => currentStatus?.available.includes(provider));
  const title = account ? 'Your account' : currentStatus?.emailDelivery ? 'Welcome to Nanti' : 'Sign in to Nanti';

  const content = <>
    {!account && !page && <div className="account-editorial">
      <div className="account-editorial-brand"><span className="brand-symbol" aria-hidden="true" />Nanti</div>
      <div className="account-editorial-copy">
        <p className="account-editorial-tagline">{t('Save it now. Decide later.')}</p>
        <p>{t('Keep your wishlists and purchase decisions with you across devices.')}</p>
      </div>
    </div>}
    {notice && <p className={notice === 'failed' ? 'error' : undefined}
      role={notice === 'failed' ? 'alert' : 'status'}>{t(authNotices[notice])}</p>}
    {error && <p role="alert" className="error">{translateError(error)}</p>}
    {signingInWith ? <p role="status">{t('Opening {provider} sign-in…', { provider: providerNames[signingInWith] })}</p>
      : (working || passwordBusy) && <p role="status">{t('Working…')}</p>}
    {message && <p role="status">{t(message)}</p>}
    {!currentStatus ? statusLoading ? <div className="account-load-state" role="status" aria-busy="true">
      <span className="account-avatar-skeleton" aria-hidden="true" />
      <span>{t('Preparing your account…')}</span>
    </div> : statusLoadError ? <div className="account-load-state" role="alert">
      <p>{t('Could not load your account. Try again.')}</p>
      <button type="button" disabled={busy} onClick={() => setStatusAttempt(value => value + 1)}>{t('Try again')}</button>
    </div> : null :
      recovering && account ? <PasswordForm delivery={Boolean(currentStatus.emailDelivery)} signedIn={false} creator={creator}
        returnToAccount
        busy={busy || passwordBusy} setPasswordBusy={setPasswordBusy} /> :
      !account ? <div className="account-signin-shell">
        <PasswordForm delivery={Boolean(currentStatus.emailDelivery)} signedIn={false} creator={creator}
          returnToAccountAfterSignIn={accountWorkspace} busy={busy || passwordBusy} setPasswordBusy={setPasswordBusy}
          alternatives={signInProviders.length > 0 && <div className="account-signin-alternatives">
            <p className="account-signin-divider">{t('Or')}</p>
            <div className="account-providers">{providerButtons(signInProviders, 'signin')}</div>
          </div>} />
      </div> : <>
        {section === 'information' && <><section className="account-overview" aria-label={t('Account overview')}>
          <div className="account-avatar" aria-hidden="true">
            {account.avatarUrl && !profileImageFailed
              ? <img src={account.avatarUrl} alt="" loading="eager" decoding="async" referrerPolicy="no-referrer" onError={() => setProfileImageFailed(true)} />
              : <span>{account.displayName?.trim().charAt(0).toLocaleUpperCase() || account.email?.trim().charAt(0).toLocaleUpperCase() || 'N'}</span>}
          </div>
          <div className="account-overview-copy">
            <h3>{account.displayName || t('Your account')}</h3>
            {account.email && <p className="account-email">{account.email}{typeof account.emailVerified === 'boolean' && <span className="account-verification" data-verified={account.emailVerified}>
              {t(account.emailVerified ? 'Email verified' : 'Email unverified')}
            </span>}</p>}
            {account.canAccessCreatorStudio && <a className="account-creator-link" href="/creator/studio">{t('Open Creator Studio')}<Icon name="arrow" /></a>}
          </div>
        </section>

        <section className="account-section account-personal" aria-labelledby="account-personal-heading">
          <div className="account-section-heading"><h3 id="account-personal-heading">{t('Display name')}</h3>
            {!editingProfile && <button type="button" onClick={() => setEditingProfile(true)}>{t('Edit')}</button>}
          </div>
          {!editingProfile && <p className="account-value"><strong>{account.displayName || t('Not set')}</strong></p>}
          {editingProfile && <form onSubmit={profile}>
            <label>{t('Display name')}<input autoComplete="nickname" value={displayName} maxLength={100} disabled={busy}
              onChange={event => setDisplayName(event.target.value)} /></label>
            <div className="account-row-actions">
              <button type="button" disabled={busy} onClick={() => { setDisplayName(account.displayName ?? ''); setEditingProfile(false); }}>{t('Cancel')}</button>
              <button className="primary" disabled={busy || displayName.trim() === (account.displayName ?? '')}>{t(busy ? 'Saving…' : 'Save name')}</button>
            </div>
          </form>}
        </section>

        </>}
        {section === 'security' && <section className="account-section account-security" aria-label={t('Security and sign-in')}>
          {account.hasPassword && <details><summary>{t('Change password')}</summary>
            <PasswordForm delivery={false} signedIn creator={false} busy={busy || passwordBusy} setPasswordBusy={setPasswordBusy} />
          </details>}
          {account.hasPassword && currentStatus.emailDelivery && <details><summary>{t('Change email address')}</summary>
            <PasswordForm delivery signedIn emailChange creator={false} busy={busy || passwordBusy} setPasswordBusy={setPasswordBusy} />
          </details>}
          <div className="account-methods" aria-busy={statusLoading}>
            <h3>{t('Connected sign-in methods')}</h3>
            {account.providers.length > 0
              ? <ul className="account-connected">{account.providers.map(provider => <li key={provider}>{providerNames[provider]}</li>)}</ul>
              : <p>{t('No external sign-in methods are connected.')}</p>}
            {account.recentlyVerified ? providerButtons(nextProvider, 'link') : <>
              <p>{t('Verify a connected sign-in method to connect another provider or delete your account.')}</p>
              {providerButtons(verifyProvider, 'verify')}
              {!verifyProvider.length && account.providers.length > 0 && <p>{t('Your connected providers are currently unavailable.')}</p>}
              {!verifyProvider.length && account.providers.length === 0 && currentStatus.available.length === 0 && <p>{t('External sign-in is not available right now.')}</p>}
            </>}
          </div>
          <details onToggle={event => { if (event.currentTarget.open && sessions === null && !sessionsLoading) void loadSessions(); }}>
            <summary>{t('Active sessions')}</summary>
            <div aria-busy={sessionsLoading}>
              {sessionsLoading && <p role="status">{t('Loading sessions…')}</p>}
              {sessionsError && <p className="error" role="alert">{t('Could not load your sessions. Try again.')}
                <button type="button" disabled={sessionsLoading} onClick={() => void loadSessions()}>{t('Try again')}</button></p>}
              {sessions?.length === 0 && <p>{t('No active sessions to show.')}</p>}
              {sessions && sessions.length > 0 && <ul className="account-session-list">{sessions.map(item => <li key={item.id}>
                <div><strong>{t(item.current ? 'This session' : 'Other session')}</strong><p>{t('Expires {date}', {
                  date: new Date(item.expiresAt).toLocaleString(language === 'id' ? 'id-ID' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }),
                })}</p></div>
                {!item.current && <button type="button" disabled={busy || passwordBusy} onClick={() => void run(async () => {
                  await api(`/account/sessions/${item.id}`, { method: 'DELETE', data: {} });
                  await loadSessions();
                  setMessage('Session signed out.');
                })}>{t('Sign out this session')}</button>}
              </li>)}</ul>}
            </div>
          </details>
        </section>}

        {section === 'information' && account.import && <section className="account-import" aria-labelledby="account-import-heading">
          <div><h3 id="account-import-heading">{t('Bring your guest data')}</h3>
            <p>{t('{guest} guest wishlists · {account} in your account', {
              guest: number(account.import.guestLists), account: number(account.import.accountLists),
            })}</p></div>
          <details><summary>{t('What will be imported?')}</summary>
            <p>{t('Guest wishlists and saved assessments will be added. Existing account data stays in place.')}</p>
            {account.import.guestPreference && <p>{t('Your guest cooling-off setting is imported if your account has no setting yet.')}</p>}
            <p>{t('If you saved financial details, they will move with the guest data you choose to import.')}</p>
          </details>
          <button className="primary" disabled={busy} onClick={() => void run(() => transition('/account/import', 'POST', 'imported'))}>
            {t('Import guest data')}
          </button>
        </section>}

        {section === 'security' && <section className="account-section account-actions" aria-labelledby="account-actions-heading">
          <h3 id="account-actions-heading">{t('Account actions')}</h3>
          <div className="account-row-actions">
            <button type="button" disabled={busy} onClick={() => void run(signOut)}>
              {t('Sign out on this device')}
            </button>
            <button type="button" disabled={busy || passwordBusy} onClick={() => void run(() => transition('/account/sessions/revoke-all', 'POST', 'signed-out'))}>
              {t('Sign out on all devices')}
            </button>
          </div>
          <details className="account-delete" open={deletion} onToggle={event => setDeletion(event.currentTarget.open)}>
            <summary>{t('Delete account')}</summary>
            <p>{t('This permanently deletes your account, wishlists, saved assessments, and preferences. It also signs you out on every device.')}</p>
            {account.providers.includes('apple') && <p><a href="https://support.apple.com/en-us/102571" target="_blank" rel="noopener noreferrer">{t('Manage Nanti’s access in your Apple Account')}</a></p>}
            <form onSubmit={event => { event.preventDefault(); void run(() => transition('/account', 'DELETE', 'deleted')); }}>
              <label className="account-confirm"><input name="confirm" type="checkbox" required disabled={busy || !account.recentlyVerified} />
                {t('I want to permanently delete my account.')}
              </label>
              <button className="danger" disabled={busy || !account.recentlyVerified}>{t('Permanently delete account')}</button>
            </form>
          </details>
        </section>}
      </>}
    {!account && <div className="account-footer"><button type="button" onClick={close} disabled={busy || passwordBusy}>
      {t('Continue as guest')}
    </button></div>}
  </>;

  if (section) return <div className="account-panel">{content}</div>;
  if (page) return <main className="account-route-panel account-signin">
    <h1>{t(title)}</h1>
    {content}
  </main>;
  return <Dialog className={account ? 'account-dialog account-settings' : 'account-dialog account-signin'}
    title={t(title)} busy={busy || passwordBusy} close={close} focusHeading
    headerAction={<button type="button" className="account-signin-close" aria-label={t('Close')}
      disabled={busy || passwordBusy} onClick={close}><Icon name="close" /></button>}>
    {content}
  </Dialog>;
}
