import { PasswordForm } from './password-form.js';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { loginProviders } from '../shared/account.js';
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
const providerNames = { apple: 'Apple', google: 'Google' } as const;
const providerOrigins = { apple: 'https://appleid.apple.com', google: 'https://accounts.google.com' } as const;
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

export function AccountDialog({ status, notice, close, update }: {
  status: AccountStatus | null; notice: AuthNotice | null; close: () => void; update: (status: AccountStatus) => void;
}) {
  const { t, error: translateError, number } = useLocale();
  const account = status?.account;
  const nextProvider = status?.available.filter(provider => !account?.providers.includes(provider)) ?? [];
  const verifyProvider = status?.available.filter(provider => account?.providers.includes(provider)) ?? [];
  const [displayName, setDisplayName] = useState(account?.displayName ?? '');
  const [working, setWorking] = useState(false);
  const [signingInWith, setSigningInWith] = useState<LoginProvider | null>(null);
  const busy = working || signingInWith !== null;
  const [error, setError] = useState('');
  const [message, setMessage] = useState<Message | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const creator = new URLSearchParams(location.search).get('next') === 'creator';
  const [deletion, setDeletion] = useState(false);

  async function run(operation: () => Promise<void>) {
    setWorking(true);
    setError('');
    setMessage(null);
    try { await operation(); }
    catch (failure) {
      const text = errorMessage(failure);
      setError(text);
      if (text === 'Verify your sign-in to continue.') {
        const current = await api<AccountStatus>('/account').catch(() => null);
        if (current) update(current);
      }
    } finally { setWorking(false); }
  }

  async function start(provider: LoginProvider, purpose: AuthPurpose) {
    setSigningInWith(provider);
    try {
      const next = await api<{ url: string }>(`/account/${provider}/start`, { method: 'POST', data: { purpose, ...(creator && purpose === 'signin' ? { destination: 'creator' } : {}) } });
      const url = new URL(next.url);
      if (url.origin !== providerOrigins[provider] || url.username || url.password) {
        throw new Error('This sign-in option is unavailable.');
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
  const signInProviders = loginProviders.filter(provider => status?.available.includes(provider));
  const title = account
    ? new URLSearchParams(location.search).get('view') === 'settings' ? 'Account settings' : 'Your account'
    : status?.emailDelivery ? 'Welcome to Nanti' : 'Sign in to Nanti';

  return <Dialog className={account ? 'account-dialog account-settings' : 'account-dialog account-signin'}
    title={t(title)} busy={busy || passwordBusy} close={close} focusHeading
    headerAction={!account && <button type="button" className="account-signin-close" aria-label={t('Close')}
      disabled={busy || passwordBusy} onClick={close}><Icon name="close" /></button>}>
    {!account && <div className="account-editorial">
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
    {!status ? <>
      <p>{t('Could not load your account. Try again.')}</p>
      <button disabled={busy} onClick={() => void run(async () => {
        const current = await api<AccountStatus>('/account');
        setDisplayName(current.account?.displayName ?? '');
        update(current);
      })}>{t('Try again')}</button>
    </> :
      !account ? <div className="account-signin-shell">
        <PasswordForm delivery={Boolean(status.emailDelivery)} signedIn={false} creator={creator}
          busy={busy || passwordBusy} setPasswordBusy={setPasswordBusy}
          alternatives={signInProviders.length > 0 && <div className="account-signin-alternatives">
            <p className="account-signin-divider">{t('Or')}</p>
            <div className="account-providers">{providerButtons(signInProviders, 'signin')}</div>
          </div>} />
      </div> : <>
        <p><a href="/creator/studio">Creator Studio</a></p>
        {account.import && <section className="account-import" aria-labelledby="account-import-heading">
          <h3 id="account-import-heading">{t('Bring your guest data')}</h3>
          <p>{t('This browser has {guest} guest wishlists. Your account has {account} wishlists.', {
            guest: number(account.import.guestLists), account: number(account.import.accountLists),
          })}</p>
          <p>{t('Import adds guest wishlists and saved assessments to your account. Existing account data stays in place.')}</p>
          {account.import.guestPreference && <p>{t('Your guest cooling-off setting is imported if your account has no setting yet.')}</p>}
          <button className="primary" disabled={busy} onClick={() => void run(() => transition('/account/import', 'POST', 'imported'))}>
            {t('Import guest data')}
          </button>
        </section>}
        {account.email && <p>{account.email} · {account.emailVerified ? 'Email terverifikasi' : 'Email belum terverifikasi'}</p>}
        {account.hasPassword && <PasswordForm delivery={false} signedIn creator={false}
          busy={busy || passwordBusy} setPasswordBusy={setPasswordBusy} />}
        <form className="account-section" onSubmit={profile}>
          <label>{t('Display name')}<input autoComplete="nickname" value={displayName} maxLength={100} disabled={busy}
            onChange={event => setDisplayName(event.target.value)} /></label>
          <button disabled={busy || displayName.trim() === (account.displayName ?? '')}>{t('Save name')}</button>
        </form>
        <section className="account-section" aria-labelledby="account-providers-heading">
          <h3 id="account-providers-heading">{t('Connected sign-in methods')}</h3>
          <ul className="account-connected">{account.providers.map(provider => <li key={provider}>{providerNames[provider]}</li>)}</ul>
          {account.recentlyVerified ? providerButtons(nextProvider, 'link') : <>
            <p>{t('Verify a connected sign-in method to connect another provider or delete your account.')}</p>
            {providerButtons(verifyProvider, 'verify')}
            {!verifyProvider.length && <p>{t('Your connected providers are currently unavailable.')}</p>}
          </>}
        </section>
        <div className="account-section">
          <button disabled={busy} onClick={() => void run(() => transition('/account/logout', 'POST', 'signed-out'))}>
            {t('Sign out on this device')}
          </button>
          <details open={deletion} onToggle={event => setDeletion(event.currentTarget.open)}>
            <summary>{t('Delete account')}</summary>
            <p>{t('This permanently deletes your account, wishlists, saved assessments, and preferences. It also signs you out on every device.')}</p>
            {account.providers.includes('apple') && <p><a href="https://support.apple.com/en-us/102571"
              target="_blank" rel="noopener noreferrer">{t('Manage Nanti’s access in your Apple Account')}</a></p>}
            <form onSubmit={event => {
              event.preventDefault();
              void run(() => transition('/account', 'DELETE', 'deleted'));
            }}>
              <label className="account-confirm"><input name="confirm" type="checkbox" required disabled={busy || !account.recentlyVerified} />
                {t('I want to permanently delete my account.')}
              </label>
              <button className="danger" disabled={busy || !account.recentlyVerified}>{t('Permanently delete account')}</button>
            </form>
          </details>
        </div>
      </>}
    <div className="account-footer"><button type="button" onClick={close} disabled={busy || passwordBusy}>
      {t(account ? 'Close' : 'Continue as guest')}
    </button></div>
  </Dialog>;
}
