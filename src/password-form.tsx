import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './api.js';

type Mode = 'login' | 'register' | 'forgot' | 'resend' | 'verify' | 'reset' | 'change';
const labels: Record<Mode, string> = {
  login: 'Masuk dengan email', register: 'Buat akun', forgot: 'Atur ulang kata sandi', resend: 'Kirim ulang verifikasi',
  verify: 'Verifikasi email', reset: 'Simpan kata sandi baru', change: 'Ubah kata sandi',
};
const success = 'Jika alamat email memenuhi syarat, tautan akan dikirim.';
export function PasswordForm({ delivery, signedIn, creator, busy, setPasswordBusy }: {
  delivery: boolean; signedIn: boolean; creator: boolean; busy: boolean; setPasswordBusy: (busy: boolean) => void;
}) {
  const [link] = useState(() => new URLSearchParams(location.hash.slice(1)));
  const [mode, setMode] = useState<Mode>(signedIn ? 'change' : link.get('mode') === 'reset' ? 'reset' :
    link.get('mode') === 'verify' ? 'verify' : 'login');
  const [expanded, setExpanded] = useState(mode === 'reset' || mode === 'verify');
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const code = link.get('token');
  useEffect(() => {
    if (!code) return;
    const url = new URL(location.href);
    url.hash = '';
    history.replaceState(history.state, '', url);
  }, [code]);

  function switchMode(next: Mode) {
    setMode(next);
    setShow(false);
    setNotice('');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data: Record<string, string | boolean | null> = {};
    for (const key of ['email', 'password', 'currentPassword']) {
      if (key === 'email' && form.has(key)) data[key] = String(form.get(key)).trim();
      if (key !== 'email' && form.has(key)) data[key] = String(form.get(key));
    }
    if (mode === 'verify' || mode === 'reset') data.code = code;
    if (creator && ['register', 'forgot', 'resend'].includes(mode)) data.creator = true;
    setPasswordBusy(true);
    setNotice('');
    setFailed(false);
    try {
      await api(`/account/password/${mode}`, { method: 'POST', data });
      if (mode === 'login') {
        location.replace(creator ? '/creator?onboard=1&auth=signed-in' : '/?auth=signed-in');
        return;
      }
      if (mode === 'change') {
        location.replace('/account');
        return;
      }
      if (mode === 'verify' || mode === 'reset') {
        switchMode('login');
        setNotice(mode === 'verify' ? 'Email sudah terverifikasi. Silakan masuk.' : 'Kata sandi diperbarui. Silakan masuk lagi.');
      } else setNotice(success);
    } catch {
      setFailed(true);
      setNotice(mode === 'verify' || mode === 'reset' ? 'Tautan tidak valid atau sudah kedaluwarsa.' :
        mode === 'login' ? 'Periksa email, kata sandi, dan status verifikasi email.' : 'Permintaan belum berhasil. Periksa data dan coba lagi.');
    } finally { setPasswordBusy(false); }
  }

  return <div className="account-password">
    {!expanded ? <button type="button" disabled={busy} onClick={() => setExpanded(true)}>{labels[mode]}</button> :
      <>
        <form key={mode} className="account-section" onSubmit={event => void submit(event)}>
          <h3>{labels[mode]}</h3>
          {['login', 'register', 'forgot', 'resend'].includes(mode) && <label>Email
            <input type="email" name="email" autoComplete="email" required maxLength={254} disabled={busy} />
          </label>}
          {mode === 'change' && <label>Kata sandi saat ini
            <input type={show ? 'text' : 'password'} name="currentPassword" autoComplete="current-password" required disabled={busy} maxLength={256} />
          </label>}
          {['login', 'register', 'verify', 'reset', 'change'].includes(mode) && <>
            <label>{mode === 'reset' || mode === 'change' ? 'Kata sandi baru' : 'Kata sandi'}
              <input name="password" type={show ? 'text' : 'password'} autoComplete={(mode === 'login' || mode === 'verify') ? 'current-password' : 'new-password'}
                required minLength={mode === 'login' || mode === 'verify' ? undefined : 15} maxLength={256} disabled={busy} />
            </label>
            <button type="button" aria-pressed={show} disabled={busy} onClick={() => setShow(value => !value)}>Tampilkan kata sandi</button>
            {mode === 'verify' ? <p>Masukkan kata sandi yang kamu pilih saat membuat akun.</p> : mode !== 'login' && <p>Gunakan sedikitnya 15 karakter.</p>}
          </>}
          <button className="primary" disabled={busy}>{labels[mode]}</button>
        </form>
        {notice && <p role={failed ? 'alert' : 'status'}>{notice}</p>}
        {!signedIn && <div className="actions">
          {mode !== 'login' && <button type="button" disabled={busy} onClick={() => switchMode('login')}>{labels.login}</button>}
          {delivery && mode === 'login' && (['register', 'forgot', 'resend'] as const).map(next =>
            <button key={next} type="button" disabled={busy} onClick={() => switchMode(next)}>{labels[next]}</button>)}
        </div>}
      </>}
  </div>;
}
