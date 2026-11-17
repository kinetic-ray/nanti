import { randomUUID } from 'node:crypto';
import { Router, urlencoded } from 'express';
import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { loginProviders } from '../shared/account.js';
import type { AccountStatus } from '../shared/account.js';
import type { AuthProvider, UserSession } from './generated/prisma/client.js';
import type { OAuthProviders } from './oauth-providers.js';
import { authToken, recentSession, sessionDuration, tokenHash } from './prisma-accounts.js';
import type { Accounts } from './prisma-accounts.js';

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const uuid = z.uuid();
const confirm = z.strictObject({ confirm: z.literal(true) });
const startInput = z.strictObject({
  purpose: z.enum(['signin', 'link', 'verify']),
});
const callbackInput = z.object({ state: token, code: z.string().min(1).max(4096).optional(), error: z.string().optional() });
const attemptDuration = 600_000;

export function accountRoutes(accounts: Accounts, providers: OAuthProviders, secure: boolean, guestCookie: string) {
  const api = Router();
  const callbacks = Router();
  const sessionCookie = secure ? '__Host-nanti-user' : 'nanti-user';
  const sessionOptions = { secure, httpOnly: true, sameSite: 'lax', path: '/' } as const;
  const attemptCookie = (provider: AuthProvider) => provider === 'apple'
    ? '__Host-nanti-oauth-apple' : secure ? '__Host-nanti-oauth-google' : 'nanti-oauth-google';
  const attemptOptions = (provider: AuthProvider) => provider === 'apple'
    ? { ...sessionOptions, secure: true, sameSite: 'none' as const } : sessionOptions;
  const limit = rateLimit({
    windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many account requests. Try again in a minute.' },
  });

  function guest(req: Request) {
    const parsed = uuid.safeParse(req.signedCookies[guestCookie]);
    return parsed.success ? parsed.data : null;
  }
  function clearSession(res: Response) { res.clearCookie(sessionCookie, sessionOptions); }
  function clearAttempts(res: Response) {
    for (const provider of loginProviders) res.clearCookie(attemptCookie(provider), attemptOptions(provider));
  }
  function sessionKey(req: Request) {
    const parsed = token.safeParse(req.cookies[sessionCookie]);
    return parsed.success ? tokenHash(parsed.data) : null;
  }
  async function session(req: Request) {
    const hash = sessionKey(req);
    return hash ? accounts.session(hash) : null;
  }
  async function resolveOwner(req: Request, res: Response, bootstrap: boolean) {
    const current = await session(req);
    if (current) return { id: current.userId, guest: false };
    if (req.cookies[sessionCookie] !== undefined) {
      if (!bootstrap) return null;
      clearSession(res);
    }
    const anonymous = guest(req);
    if (anonymous && await accounts.guest(anonymous)) return { id: anonymous, guest: true };
    return bootstrap ? { id: randomUUID(), guest: true } : null;
  }
  function eligibleGuest(req: Request, current: UserSession) {
    const id = guest(req);
    return id && current.pendingGuestOwnerId === id ? id : null;
  }
  function unauthorized(res: Response) {
    res.status(401).json({ error: 'Sign in to continue.' });
  }
  function verifyFirst(res: Response) {
    res.status(403).json({ error: 'Verify your sign-in to continue.' });
  }

  async function callback(provider: AuthProvider, req: Request, res: Response) {
    const configured = providers[provider];
    const incoming = callbackInput.safeParse(provider === 'apple' ? req.body : req.query);
    const browser = token.safeParse(req.cookies[attemptCookie(provider)]);
    const finish = (status: string) => res.redirect(303, `/?auth=${status}`);
    if (!configured || !incoming.success || !browser.success) { finish('failed'); return; }

    try {
      const { state, code, error } = incoming.data;
      const attempt = await accounts.consumeAttempt(state, browser.data, provider);
      if (!attempt) { finish('failed'); return; }
      res.clearCookie(attemptCookie(provider), attemptOptions(provider));
      if (error || !code) { finish(error === 'access_denied' || error === 'user_cancelled_authorize' ? 'cancelled' : 'failed'); return; }
      const { subject, displayName } = await configured.verify(new URLSearchParams({ state, code }), {
        state, nonce: attempt.nonce, verifier: attempt.verifier,
      });
      if (attempt.purpose === 'signin') {
        const raw = await accounts.signin(provider, subject, displayName, attempt.guestOwnerId);
        res.cookie(sessionCookie, raw, { ...sessionOptions, maxAge: sessionDuration });
        finish('signed-in');
      } else {
        const accepted = await accounts.confirmIdentity(attempt, subject);
        finish(accepted ? attempt.purpose === 'link' ? 'linked' : 'verified' : 'failed');
      }
    } catch {
      // Provider messages may contain credentials or personally identifying information.
      finish('failed');
    }
  }
  callbacks.get('/google/callback', limit, (req, res) => callback('google', req, res));
  callbacks.post('/apple/callback', limit, urlencoded({ extended: false, limit: '8kb', parameterLimit: 10 }),
    (req, res) => callback('apple', req, res));

  api.get('/', async (req, res) => {
    const available = loginProviders.filter(provider => providers[provider]);
    const current = await session(req);
    const account = current && await accounts.account(current.userId);
    const pending = current && eligibleGuest(req, current);
    const response: AccountStatus = { available, account: account && current ? {
      displayName: account.displayName, providers: account.identities.map(entry => entry.provider),
      recentlyVerified: recentSession(current), import: pending ? await accounts.importSummary(current.userId, pending) : null,
    } : null };
    res.json(response);
  });
  api.post('/:provider/start', limit, async (req, res) => {
    const provider = z.enum(loginProviders).parse(req.params.provider);
    const configured = providers[provider];
    if (!configured) {
      res.status(404).json({ error: 'This sign-in option is unavailable.' });
      return;
    }
    const { purpose } = startInput.parse(req.body);
    const current = await session(req);
    if (purpose === 'signin' && current) {
      res.status(409).json({ error: 'Sign out before switching accounts.' });
      return;
    }
    if (purpose !== 'signin') {
      if (!current) return unauthorized(res);
      if (purpose === 'link' && !recentSession(current)) return verifyFirst(res);
      const account = await accounts.account(current.userId);
      const connected = account?.identities.some(entry => entry.provider === provider);
      if (!account || (purpose === 'verify' ? !connected : connected)) {
        res.status(409).json({ error: 'This sign-in option is unavailable.' });
        return;
      }
    }
    const state = authToken();
    const browser = authToken();
    const nonce = authToken();
    const verifier = provider === 'google' ? authToken() : null;
    const url = await configured.authorization({ state, nonce, verifier });
    const anonymous = purpose === 'signin' ? guest(req) : null;
    await accounts.attempt({ stateHash: tokenHash(state), browserHash: tokenHash(browser), nonce, provider, purpose,
      verifier, guestOwnerId: anonymous && await accounts.guest(anonymous) ? anonymous : null,
      sessionHash: current?.tokenHash, expiresAt: new Date(Date.now() + attemptDuration) });
    res.cookie(attemptCookie(provider), browser, { ...attemptOptions(provider), maxAge: attemptDuration });
    res.json({ url: url.href });
  });
  api.post('/logout', limit, async (req, res) => {
    const hash = sessionKey(req);
    if (hash) await accounts.logout(hash);
    clearSession(res);
    clearAttempts(res);
    res.sendStatus(204);
  });
  api.patch('/', limit, async (req, res) => {
    const current = await session(req);
    if (!current) return unauthorized(res);
    const { displayName } = z.strictObject({
      displayName: z.string().trim().max(100).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
    }).parse(req.body);
    await accounts.rename(current.userId, displayName || null);
    res.sendStatus(204);
  });
  api.post('/import', limit, async (req, res) => {
    const current = await session(req);
    if (!current) return unauthorized(res);
    confirm.parse(req.body);
    const pending = eligibleGuest(req, current);
    if (!pending || !await accounts.importGuest(current, pending)) {
      res.status(409).json({ error: 'This browser has no guest data available to import.' });
      return;
    }
    res.sendStatus(204);
  });
  api.delete('/', limit, async (req, res) => {
    const current = await session(req);
    if (!current) return unauthorized(res);
    confirm.parse(req.body);
    if (!recentSession(current) || !await accounts.deleteAccount(current)) return verifyFirst(res);
    clearSession(res);
    clearAttempts(res);
    res.sendStatus(204);
  });
  return { api, callbacks, resolveOwner };
}
