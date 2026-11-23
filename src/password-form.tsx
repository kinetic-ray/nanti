import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api } from './api.js';
import { useLocale } from './locale.js';
import type { Message } from './messages.js';

type Mode = 'login' | 'register' | 'forgot' | 'resend' | 'verify' | 'reset' | 'change' | 'email' | 'changeEmail';
const labels: Record<Mode, Message> = {
  login: 'Sign in with email', register: 'Create an account', forgot: 'Reset password', resend: 'Resend verification',
  verify: 'Verify email', reset: 'Save new password', change: 'Change password',
  email: 'Change email address', changeEmail: 'Verify new email address',
};
const success = 'If the email address is eligible, we’ll send a link.';
export function PasswordForm({ delivery, signedIn, creator, busy, setPasswordBusy, alternatives, emailChange }: {
  delivery: boolean; signedIn: boolean; creator: boolean; busy: boolean; setPasswordBusy: (busy: boolean) => void;
  alternatives?: ReactNode; emailChange?: boolean;
}) {
  const { t } = useLocale();
  const [link] = useState(() => new URLSearchParams(location.hash.slice(1)));
  const [mode, setMode] = useState<Mode>(emailChange ? 'email' : link.get('mode') === 'changeEmail' ? 'changeEmail' :
    signedIn ? 'change' : link.get('mode') === 'reset' ? 'reset' : link.get('mode') === 'verify' ? 'verify' : 'login');
  const [expanded, setExpanded] = useState(!signedIn);
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState<Message | null>(null);
  const [failed, setFailed] = useState(false);
  const entryMode = mode === 'login' || mode === 'register';
  const passwordHintId = useId();
  const passwordHint = mode === 'verify' ? 'Enter the password you chose when you created your account.'
    : mode === 'login' || mode === 'email' || mode === 'changeEmail' ? null : 'Use at least 8 characters.';
  const canResend = delivery && (mode === 'forgot' || (failed && notice && (mode === 'login' || mode === 'verify')));
  const formRef = useRef<HTMLFormElement>(null);
  const focusAfterChange = useRef(false);
  useLayoutEffect(() => {
    if (focusAfterChange.current && !busy) {
      focusAfterChange.current = false;
      formRef.current?.querySelector('input')?.focus();
    }
  }, [busy, expanded, mode]);
  const code = link.get('token');
  useEffect(() => {
    if (!code) return;
    const url = new URL(location.href);
    url.hash = '';
    history.replaceState(history.state, '', url);
  }, [code]);

  function switchMode(next: Mode) {
    focusAfterChange.current = true;
    setMode(next);
    setShow(false);
    setNotice(null);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data: Record<string, string | boolean | null> = {};
    for (const key of ['email', 'password', 'currentPassword']) {
      if (key === 'email' && form.has(key)) data[key] = String(form.get(key)).trim();
      if (key !== 'email' && form.has(key)) data[key] = String(form.get(key));
    }
    if (mode === 'verify' || mode === 'reset' || mode === 'changeEmail') data.code = code;
    if (creator && ['register', 'forgot', 'resend'].includes(mode)) data.creator = true;
    if (mode === 'reset' && form.get('confirmation') !== form.get('password')) {
      setFailed(true);
      setNotice('Passwords must match.');
      formRef.current?.querySelector<HTMLInputElement>('[name="confirmation"]')?.focus();
      return;
    }
    setPasswordBusy(true);
    setNotice(null);
    setFailed(false);
    try {
      await api(`/account/password/${mode === 'changeEmail' ? 'email/verify' : mode}`, { method: 'POST', data });
      if (mode === 'login') {
        location.replace(creator ? '/creator?onboard=1&auth=signed-in' : '/?auth=signed-in');
        return;
      }
      if (mode === 'change' || mode === 'changeEmail') {
        location.replace('/account');
        return;
      }
      if (mode === 'verify' || mode === 'reset') {
        switchMode('login');
        setNotice(mode === 'verify' ? 'Email verified. You can sign in now.' : 'Password updated. Please sign in again.');
      } else setNotice(mode === 'email' ? 'Check your new email address for a verification link.' : success);
    } catch {
      setFailed(true);
      setNotice(mode === 'verify' ? 'Check your password and verification link, then try again.' :
        mode === 'reset' || mode === 'changeEmail' ? 'This link is invalid or has expired.' :
        mode === 'login' ? 'Check your email, password, and whether your email is verified.' : 'Check your details and try again.');
    } finally { setPasswordBusy(false); }
  }

  return <div className="account-password">
    {!expanded ? <button type="button" disabled={busy} onClick={() => {
      focusAfterChange.current = true;
      setExpanded(true);
    }}>{t(labels[mode])}</button> :
      <>
        {delivery && !signedIn && entryMode && <div className="account-auth-modes" role="group" aria-label={t('Email authentication')}>
          <button type="button" aria-pressed={mode === 'login'} disabled={busy}
            onClick={() => mode !== 'login' && switchMode('login')}>{t('Sign in')}</button>
          <button type="button" aria-pressed={mode === 'register'} disabled={busy}
            onClick={() => mode !== 'register' && switchMode('register')}>{t(labels.register)}</button>
        </div>}
        <form key={mode} ref={formRef} className="account-section" onSubmit={event => void submit(event)}>
          {!entryMode && <h3>{t(labels[mode])}</h3>}
          {['login', 'register', 'forgot', 'resend', 'email'].includes(mode) && <label>{t(mode === 'email' ? 'New email address' : 'Email')}
            <input type="email" name="email" autoComplete="email" required maxLength={254} disabled={busy} />
          </label>}
          {(mode === 'change' || mode === 'email') && <label>{t('Current password')}
            <input type={show ? 'text' : 'password'} name="currentPassword" autoComplete="current-password" required disabled={busy} maxLength={256} />
          </label>}
          {['login', 'register', 'verify', 'reset', 'change'].includes(mode) && <>
            <div className="account-password-field">
              <label>{t(mode === 'reset' || mode === 'change' ? 'New password' : 'Password')}
                <input name="password" type={show ? 'text' : 'password'} autoComplete={(mode === 'login' || mode === 'verify') ? 'current-password' : 'new-password'}
                  aria-describedby={passwordHint ? passwordHintId : undefined}
                  required minLength={mode === 'login' || mode === 'verify' ? undefined : 8} maxLength={256} disabled={busy} />
              </label>
              <button type="button" aria-label={t(show ? 'Hide password' : 'Show password')} disabled={busy}
                onClick={() => setShow(value => !value)}>{t(show ? 'Hide' : 'Show')}</button>
            </div>
            {passwordHint && <p id={passwordHintId} className="hint">{t(passwordHint)}</p>}
          </>}
          {mode === 'reset' && <label>{t('Confirm new password')}
            <input name="confirmation" type={show ? 'text' : 'password'} autoComplete="new-password"
              required minLength={8} maxLength={256} disabled={busy} />
          </label>}
          <button type="submit" className="primary" disabled={busy}>{t(labels[mode])}</button>
        </form>
        {notice && <p className={failed ? 'error' : undefined} role={failed ? 'alert' : 'status'}>{t(notice)}</p>}
        {!signedIn && (!entryMode || (delivery && mode === 'login')) && <div className="actions">
          {!entryMode && <button type="button" disabled={busy} onClick={() => switchMode('login')}>{t('Back to sign in')}</button>}
          {delivery && mode === 'login' && <button type="button" disabled={busy}
            onClick={() => switchMode('forgot')}>{t(labels.forgot)}</button>}
          {canResend && <button type="button" disabled={busy}
            onClick={() => switchMode('resend')}>{t(labels.resend)}</button>}
        </div>}
        {entryMode && alternatives}
      </>}
  </div>;
}
