import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

export function developmentAccountMail(secure: boolean) {
  if (secure || process.env.NODE_ENV !== 'development' || process.env.NANTI_DEV_ACCOUNT_MAIL !== 'file') return null;
  const localOnly = ['http://127.0.0.1', 'http://localhost', 'http://[::1]'];
  const origin = new URL(process.env.AUTH_PUBLIC_ORIGIN || `http://127.0.0.1:${process.env.NANTI_DEV_WEB_PORT || '5173'}`);
  if (!localOnly.includes(`${origin.protocol}//${origin.hostname}`) || origin.href !== origin.origin + '/') return null;
  return async (email: string, kind: 'verify' | 'reset', token: string, creator: boolean) => {
    const link = new URL('/account', origin);
    link.searchParams.set('recovery', kind);
    if (creator) link.searchParams.set('next', 'creator');
    link.hash = new URLSearchParams({ mode: kind, token }).toString();
    await appendFile(join(process.cwd(), '.env.account-outbox'), JSON.stringify({ email, kind, link: link.href }) + '\n',
      { encoding: 'utf8', mode: 0o600 });
  };
}
