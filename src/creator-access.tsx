import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { announceAuthChange, authChangeKey } from './account.js';
import { api, errorMessage } from './api.js';

type State = { profile: { id: string; name: string } | null; continued: boolean };

export function CreatorAccess({ studio }: { studio: (id: string, draft: unknown) => ReactNode }) {
  const [draft, setDraft] = useState<unknown>(null);
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [signedOut, setSignedOut] = useState(false);
  const [revision, setRevision] = useState(0);
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
    api<State>('/account/creator', { signal: controller.signal }).then(async data => {
      if (controller.signal.aborted) return;
      if (data.profile && !inStudio) location.replace('/creator/studio');
      else {
        if (inStudio && data.profile) {
          try {
            const result = await api<{ design: unknown }>('/account/creator/design', { signal: controller.signal });
            if (!controller.signal.aborted) setDraft(result.design);
          } catch {
            if (!controller.signal.aborted) setError('Draft kreator belum bisa dibuka. Coba lagi.');
            return;
          }
        }
        if (!controller.signal.aborted) setState(data);
      }
    }, failure => {
      if (controller.signal.aborted) return;
      if (errorMessage(failure) === 'Sign in to continue.') {
        if (!inStudio && !outcome) location.replace('/account?next=creator');
        else setSignedOut(true);
      }
      else setError('Akun kreator belum bisa dibuka. Coba lagi.');
    });
    return () => controller.abort();
  }, [inStudio, outcome, revision]);

  useEffect(() => {
    function refresh() {
      setState(null);
      setSignedOut(false);
      setError('');
      setRevision(value => value + 1);
    }
    function storage(event: StorageEvent) { if (event.key === authChangeKey) refresh(); }
    function restored(event: PageTransitionEvent) { if (event.persisted) refresh(); }
    window.addEventListener('storage', storage);
    window.addEventListener('pageshow', restored);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('pageshow', restored);
    };
  }, []);

  async function continueSetup() {
    setBusy(true);
    setError('');
    try {
      await api('/account/creator/continue', { method: 'POST' });
      setState({ profile: null, continued: true });
    } catch { setError('Belum bisa melanjutkan. Coba lagi.'); }
    finally { setBusy(false); }
  }
  async function setup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name');
    setBusy(true);
    setError('');
    try {
      await api('/account/creator/setup', { method: 'POST', data: { name } });
      location.replace('/creator/studio');
    } catch { setError('Profil kreator belum bisa disimpan. Coba lagi.'); }
    finally { setBusy(false); }
  }

  if (inStudio && state?.profile) return studio(state.profile.id, draft);
  return <div className="consumer"><main className="site creator-access">
    <a href="/creator">Kembali ke Nanti Creator</a>
    <h1>Buat Nanti Creator</h1>
    {error && <p role="alert">{error}</p>}
    {signedOut ? <>
      {(outcome === 'failed' || outcome === 'cancelled') && <p role="alert">Proses masuk belum selesai. Coba lagi.</p>}
      <p>Masuk atau buat akun Nanti untuk melanjutkan.</p><a href="/account?next=creator">Masuk ke Nanti</a>
    </> : state ? (state.continued ? <form onSubmit={event => void setup(event)}>
      <label>Nama kreator<input name="name" required maxLength={100} disabled={busy} /></label>
      <button className="primary" disabled={busy}>Buat profil kreator</button>
    </form> : <>
      <h2>Kontribusi sukarela</h2>
      <p>Kamu bisa membuat profil kreator secara gratis.</p>
      <button className="primary" type="button" disabled={busy} onClick={() => void continueSetup()}>Lanjutkan tanpa sumbangan</button>
    </>) : error ? <button type="button" onClick={() => { setError(''); setRevision(value => value + 1); }}>Coba lagi</button>
      : <p role="status">Memeriksa akun kreator…</p>}
    {busy && <p role="status">Sedang diproses…</p>}
  </main></div>;
}
