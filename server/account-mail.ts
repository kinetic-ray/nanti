import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { accountMailUrl, resolveAccountMailOrigin } from './account-mail-links.js';

export function developmentAccountMail(secure: boolean) {
  if (secure || process.env.NODE_ENV !== 'development' || process.env.NANTI_DEV_ACCOUNT_MAIL !== 'file') return null;
  const localOnly = ['http://127.0.0.1', 'http://localhost', 'http://[::1]'];
  let origin: URL;
  try { origin = resolveAccountMailOrigin(); } catch { return null; }
  if (!localOnly.includes(`${origin.protocol}//${origin.hostname}`)) return null;
  return async (email: string, kind: 'verify' | 'reset' | 'changeEmail', token: string, creator: boolean) => {
    const link = accountMailUrl(kind, token, creator);
    await appendFile(join(process.cwd(), '.env.account-outbox'), JSON.stringify({ email, kind, link }) + '\n',
      { encoding: 'utf8', mode: 0o600 });
  };
}
