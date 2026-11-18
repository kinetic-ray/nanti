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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState<Message | null>(null);
  const [deletion, setDeletion] = useState(false);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
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
    } finally { setBusy(false); }
  }

  async function start(provider: LoginProvider, purpose: AuthPurpose) {
    const next = await api<{ url: string }>(`/account/${provider}/start`, { method: 'POST', data: { purpose } });
    const url = new URL(next.url);
    if (url.origin !== providerOrigins[provider] || url.username || url.password) {
      throw new Error('This sign-in option is unavailable.');
    }
    location.assign(url.href);
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
    <button key={provider} type="button" disabled={busy} className={`account-provider provider-${provider}`}
      onClick={() => void run(() => start(provider, purpose))}>
      <span className="account-provider-mark" aria-hidden="true">{provider === 'google' ? 'G' : '●'}</span>
      <span className="account-provider-label">{t(purpose === 'signin' ? 'Continue with {provider}' : purpose === 'link' ?
        'Connect {provider}' : 'Verify with {provider}', { provider: providerNames[provider] })}</span>
      <Icon name="arrow" />
    </button>);
  const signInShell = loginProviders.map(provider => {
    const enabled = status?.available.includes(provider) ?? false;
    return enabled ? providerButtons([provider], 'signin') : <button key={provider} type="button"
      className={`account-provider provider-${provider} account-provider-pending`} disabled
      aria-label={`${providerNames[provider]} sign-in is not configured`}>
      <span className="account-provider-mark" aria-hidden="true">{provider === 'google' ? 'G' : '●'}</span>
      <span className="account-provider-label">{t('Continue with {provider}', { provider: providerNames[provider] })}</span>
      <span className="account-provider-status">Coming soon</span>
    </button>;
  });

  return <Dialog className={account ? 'account-dialog account-settings' : 'account-dialog account-signin'}
    title={t(account ? 'Your account' : 'Sign in to Nanti')} busy={busy} close={close} focusHeading>
    {notice && <p className={notice === 'failed' ? 'error' : undefined}
      role={notice === 'failed' ? 'alert' : 'status'}>{t(authNotices[notice])}</p>}
    {error && <p role="alert" className="error">{translateError(error)}</p>}
    {busy && <p role="status">{t('Working…')}</p>}
    {message && <p role="status">{t(message)}</p>}
    {!status ? <>
      <p>{t('Could not load your account. Try again.')}</p>
      <button disabled={busy} onClick={() => void run(async () => {
        const current = await api<AccountStatus>('/account');
        setDisplayName(current.account?.displayName ?? '');
        update(current);
      })}>{t('Try again')}</button>
    </> :
      !account ? <section className="account-signin-shell">
        <div className="account-signin-emblem" aria-hidden="true">N</div>
        <h3>Your wishlist, wherever you go.</h3>
        <p>{t('Keep your wishlists and purchase decisions with you across devices.')}</p>
        <div className="account-providers">{signInShell}</div>
        {!status.available.length && <p className="account-signin-note" role="status">
          Google and Apple sign-in are being prepared. You can still use Nanti as a guest.
        </p>}
        <p className="account-signin-note">Your existing guest wishlists stay available on this device.</p>
      </section> : <>
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
    <div className="account-footer"><button onClick={close} disabled={busy}>
      {t(account ? 'Close' : 'Continue as guest')}
    </button></div>
  </Dialog>;
}
