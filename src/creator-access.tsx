import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { announceAuthChange, authChangeKey } from './account.js';
import { api, errorMessage } from './api.js';
import { LanguagePicker, useLocale } from './locale.js';
import type { Message } from './messages.js';

type State = { profile: { id: string; name: string } | null; continued: boolean };

export function CreatorAccess({ studio }: { studio: (id: string, draft: unknown) => ReactNode }) {
  const { t } = useLocale();
  const [draft, setDraft] = useState<unknown>(null);
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Message | ''>('');
  const [signedOut, setSignedOut] = useState(false);
  const [revision, setRevision] = useState(0);
  const [slow, setSlow] = useState(false);
  const inStudio = /^\/creator\/studio\/?$/u.test(location.pathname);
  const outcome = new URLSearchParams(location.search).get('auth');

  useEffect(() => {
    if (outcome === 'signed-in') {
      announceAuthChange();
      const url = new URL(location.href);
      url.searchParams.delete('auth');
      history.replaceState(history.state, '', url);
    }
  }, [outcome]);

  useEffect(() => {
    const controller = new AbortController();
    setSlow(false);
    const slowTimer = window.setTimeout(() => setSlow(true), 7000);
    const timeout = window.setTimeout(() => {
      if (!controller.signal.aborted) {
        setError('Could not open your creator account. Try again.');
        controller.abort();
      }
    }, 20000);
    api<State>('/account/creator', { signal: controller.signal }).then(async data => {
      try {
        if (controller.signal.aborted) return;
        if (data.profile && !inStudio) location.replace('/creator/studio');
        else {
          if (inStudio && data.profile) {
            try {
              const result = await api<{ design: unknown }>('/account/creator/design', { signal: controller.signal });
              if (!controller.signal.aborted) setDraft(result.design);
            } catch (failure) {
              if (controller.signal.aborted) return;
              if (errorMessage(failure) === 'Sign in to continue.') setSignedOut(true);
              else setError('Could not open your creator draft. Try again.');
              return;
            }
          }
          if (!controller.signal.aborted) setState(data);
        }
      } finally {
        window.clearTimeout(slowTimer);
        window.clearTimeout(timeout);
      }
    }, failure => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeout);
      if (controller.signal.aborted) return;
      if (errorMessage(failure) === 'Sign in to continue.') {
        if (!inStudio && !outcome) location.replace('/account?next=creator');
        else setSignedOut(true);
      }
      else setError('Could not open your creator account. Try again.');
    });
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [inStudio, outcome, revision]);

  useEffect(() => {
    function refresh() {
      setState(null);
      setSignedOut(false);
      setError('');
      setRevision(value => value + 1);
    }
    function storage(event: StorageEvent) { if (event.key === authChangeKey) refresh(); }
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('storage', storage);
    };
  }, []);

  async function setup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (!name) {
      setError('Enter a creator name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!state?.continued) await api('/account/creator/continue', { method: 'POST' });
      await api('/account/creator/setup', { method: 'POST', data: { name } });
      location.replace('/creator/studio');
    } catch (failure) {
      if (errorMessage(failure) === 'Sign in to continue.') setSignedOut(true);
      else setError('Could not save your creator profile. Try again.');
    }
    finally { setBusy(false); }
  }

  if (inStudio && state?.profile) return studio(state.profile.id, draft);
  const checking = state === null && !signedOut && !error;
  return <div className="consumer"><main className="site creator-access">
    <nav className="creator-access-nav" aria-label={t('Creator navigation')}><a href="/creator">{t('Back to Nanti Creator')}</a><LanguagePicker /></nav>
    {checking ? <section className="creator-access-state" aria-live="polite">
      <span className="creator-access-spinner" aria-hidden="true" />
      <h1>{t('Checking your creator account…')}</h1>
      {slow && <><p>{t('This is taking longer than expected. You can retry or keep waiting.')}</p><button type="button" onClick={() => { setError(''); setRevision(value => value + 1); }}>{t('Try again')}</button></>}
    </section> : <>
    {!signedOut && <h1>{t('Create a creator profile')}</h1>}
    {error && <p role="alert">{t(error)} <button type="button" onClick={() => { setError(''); setRevision(value => value + 1); }}>{t('Try again')}</button></p>}
    {signedOut ? <>
      {(outcome === 'failed' || outcome === 'cancelled') && <p role="alert">{t('Sign-in was interrupted. Try again.')}</p>}
      <p>{t('Sign in or create a Nanti account to continue.')}</p>
      <a href="/account?next=creator">{t('Sign in to Nanti')}</a>
    </> : state ? <form onSubmit={event => void setup(event)}>
      <p>{t('This name will appear on your storefront.')}</p>
      <label>{t('Creator name')}<input name="name" autoComplete="nickname" required maxLength={100} disabled={busy} /></label>
      <button className="primary" disabled={busy}>{t('Create creator profile')}</button>
    </form> : null}
    </>}
    {busy && <p role="status">{t('Working…')}</p>}
  </main></div>;
}
