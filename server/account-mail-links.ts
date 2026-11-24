const productionOrigin = 'https://nanti-liart.vercel.app';
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

export type AccountMailKind = 'verify' | 'reset' | 'changeEmail';

export function resolveAccountMailOrigin(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.AUTH_PUBLIC_ORIGIN?.trim();
  if (env.NODE_ENV === 'production') {
    const origin = configured && URL.parse(configured);
    if (!origin || origin.origin !== productionOrigin || origin.href !== `${productionOrigin}/` ||
      origin.username || origin.password) {
      throw new Error('Account email requires AUTH_PUBLIC_ORIGIN to match the canonical production origin.');
    }
    return origin;
  }

  const raw = configured || `http://127.0.0.1:${env.NANTI_DEV_WEB_PORT || '5173'}`;
  const origin = URL.parse(raw);
  const loopback = origin && loopbackHosts.has(origin.hostname);
  if (!origin || origin.href !== `${origin.origin}/` || origin.username || origin.password ||
    (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))) {
    throw new Error('Account email requires a valid HTTPS origin, or a loopback HTTP origin in development.');
  }
  return origin;
}

export function accountMailUrl(kind: AccountMailKind, token: string, creator: boolean, env: NodeJS.ProcessEnv = process.env) {
  const link = new URL('/account', resolveAccountMailOrigin(env));
  link.searchParams.set('recovery', kind);
  if (creator) link.searchParams.set('next', 'creator');
  link.hash = new URLSearchParams({ mode: kind, token }).toString();
  return link.href;
}
