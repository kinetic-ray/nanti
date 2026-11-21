import { validateDesign } from '../shared/creator-design.js';
import { creatorCatalogRoutes, type CreatorMedia } from './creator-catalog-routes.js';
import { developmentAccountMail } from './account-mail.js';
import { randomUUID } from 'node:crypto';
import { Router, urlencoded } from 'express';
import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ResponseBodyError } from 'openid-client';
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
  destination: z.enum(['account', 'admin', 'creator']).optional(),
});
const callbackInput = z.object({ state: token, code: z.string().min(1).max(4096).optional(), error: z.string().optional() });
const emailInput = z.email().max(254).transform(value => value.toLowerCase());
const passwordInput = z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= 256);
const newPassword = passwordInput.refine(value => Array.from(value).length >= 15);
const attemptDuration = 600_000;
const authDestinations = { account: '/account', admin: '/admin?view=accounts', creator: '/creator?onboard=1' } as const;
const tokenErrorCodes = new Set(['invalid_client', 'invalid_grant', 'invalid_request', 'unauthorized_client']);

function oauthDiagnostic(req: Request, provider: AuthProvider, phase: string,
  details?: { callbackOrigin?: string; providerError?: string }) {
  if (req.app.get('env') === 'development') {
    console.warn('OAuth sign-in failed', { provider, phase, ...details });
  }
}

export function accountRoutes(accounts: Accounts, providers: OAuthProviders, secure: boolean, guestCookie: string, creatorMedia?: CreatorMedia) {
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


  const sendMail = developmentAccountMail(secure);
  const passwordLimit = rateLimit({
    windowMs: 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many account requests. Try again in a minute.' },
  });

  async function deliver(email: string, kind: 'verify' | 'reset', creator: boolean) {
    const raw = await accounts.passwords.issue(email, kind);
    if (raw && sendMail) await sendMail(email, kind, raw, creator).catch(() => console.error('Account mail delivery failed.'));
  }
  function unavailable(res: Response) {
    res.status(503).json({ error: 'Email delivery is currently unavailable.' });
  }
  function invalidCode(res: Response) {
    res.status(400).json({ error: 'This link is invalid or has expired.' });
  }

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
    let destination: string = '/';
    const finish = (status: string) => {
      const query = new URLSearchParams({ auth: status });
      res.redirect(303, `${destination}${destination.includes('?') ? '&' : '?'}${query}`);
    };
    const fail = (phase: string, error?: unknown) => {
      const providerError = error instanceof ResponseBodyError && tokenErrorCodes.has(error.error) ? error.error : undefined;
      oauthDiagnostic(req, provider, phase, providerError ? { providerError } : undefined);
      finish('failed');
    };
    if (!configured) return fail('provider_not_configured');
    if (!incoming.success) return fail('invalid_callback_parameters');
    if (!browser.success) return fail('missing_or_invalid_attempt_cookie');

    let phase = 'consume_attempt';
    try {
      const { state, code, error } = incoming.data;
      const attempt = await accounts.consumeAttempt(state, browser.data, provider);
      if (!attempt) return fail('attempt_expired_or_unmatched');
      if (attempt.destination) destination = authDestinations[attempt.destination];
      res.clearCookie(attemptCookie(provider), attemptOptions(provider));
      if (error === 'access_denied' || error === 'user_cancelled_authorize') return finish('cancelled');
      if (error || !code) return fail('authorization_code_unavailable');
      phase = 'token_exchange_or_validation';
      const { subject, displayName, verifiedEmail, avatarUrl } = await configured.verify(new URLSearchParams({ state, code }), {
        state, nonce: attempt.nonce, verifier: attempt.verifier,
      });
      if (attempt.purpose === 'signin') {
        phase = 'create_session';
        if (await session(req)) return fail('already_signed_in');
        const raw = await accounts.signin(provider, subject, displayName, attempt.guestOwnerId, verifiedEmail, avatarUrl);
        res.cookie(sessionCookie, raw, { ...sessionOptions, maxAge: sessionDuration });
        finish('signed-in');
      } else {
        phase = 'confirm_identity';
        const accepted = await accounts.confirmIdentity(attempt, subject, avatarUrl);
        if (!accepted) return fail('identity_not_confirmed');
        finish(attempt.purpose === 'link' ? 'linked' : 'verified');
      }
    } catch (error) {
      // Provider messages may contain credentials or personally identifying information.
      fail(phase, error);
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
    const providerEmail = account?.identities.find(identity => identity.verifiedEmail)?.verifiedEmail;
    const avatarUrl = account?.identities.find(identity => identity.provider === 'google')?.avatarUrl;
    const response: AccountStatus = { available, ...(sendMail && { emailDelivery: true }), account: account && current ? {
      ...(account.password ? { email: account.password.email, emailVerified: Boolean(account.password.verifiedAt), hasPassword: true }
        : providerEmail ? { email: providerEmail, emailVerified: true } : {}),
      displayName: account.displayName, providers: account.identities.map(entry => entry.provider),
      ...(avatarUrl && { avatarUrl }),
      canAccessCreatorStudio: Boolean(account.creatorProfile),
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
    const { purpose, destination } = startInput.parse(req.body);
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
    const requestOrigin = req.get('Origin');
    const callbackOrigin = URL.parse(url.searchParams.get('redirect_uri') ?? '')?.origin;
    if (requestOrigin && callbackOrigin && requestOrigin !== callbackOrigin) {
      oauthDiagnostic(req, provider, 'origin_mismatch', { callbackOrigin });
      res.status(409).json({ error: 'Open Nanti at its main address and try signing in again.' });
      return;
    }
    const anonymous = purpose === 'signin' ? guest(req) : null;
    await accounts.attempt({ stateHash: tokenHash(state), browserHash: tokenHash(browser), nonce, provider, purpose,
      verifier, destination: purpose === 'signin' ? destination : undefined, guestOwnerId: anonymous && await accounts.guest(anonymous) ? anonymous : null,
      sessionHash: current?.tokenHash, expiresAt: new Date(Date.now() + attemptDuration) });
    res.cookie(attemptCookie(provider), browser, { ...attemptOptions(provider), maxAge: attemptDuration });
    res.json({ url: url.href });
  });

  api.post('/password/register', passwordLimit, async (req, res) => {
    if (!sendMail) return unavailable(res);
    const { email, password, creator } = z.strictObject({ email: emailInput, password: newPassword, creator: z.boolean().default(false) }).parse(req.body);
    await accounts.passwords.register(email, password);
    await deliver(email, 'verify', creator);
    res.sendStatus(202);
  });
  for (const [path, kind] of [['resend', 'verify'], ['forgot', 'reset']] as const) {
    api.post(`/password/${path}`, passwordLimit, async (req, res) => {
      if (!sendMail) return unavailable(res);
      const { email, creator } = z.strictObject({ email: emailInput, creator: z.boolean().default(false) }).parse(req.body);
      await deliver(email, kind, creator);
      res.sendStatus(202);
    });
  }
  api.post('/password/verify', passwordLimit, async (req, res) => {
    const { code, password } = z.strictObject({ code: token, password: passwordInput }).parse(req.body);
    if (!await accounts.passwords.consume(code, 'verify', password)) return invalidCode(res);
    res.sendStatus(204);
  });
  api.post('/password/reset', passwordLimit, async (req, res) => {
    const { code, password } = z.strictObject({ code: token, password: newPassword }).parse(req.body);
    if (!await accounts.passwords.consume(code, 'reset', password)) return invalidCode(res);
    clearSession(res);
    clearAttempts(res);
    res.sendStatus(204);
  });
  api.post('/password/login', passwordLimit, async (req, res) => {
    const { email, password } = z.strictObject({ email: emailInput, password: passwordInput }).parse(req.body);
    if (await session(req)) {
      res.status(409).json({ error: 'Sign out before switching accounts.' });
      return;
    }
    const anonymous = guest(req);
    const raw = await accounts.passwords.login(email, password, anonymous && await accounts.guest(anonymous) ? anonymous : null);
    if (!raw) {
      res.status(401).json({ error: 'Check your email, password, and email verification.' });
      return;
    }
    res.cookie(sessionCookie, raw, { ...sessionOptions, maxAge: sessionDuration });
    clearAttempts(res);
    res.sendStatus(204);
  });
  api.post('/password/change', passwordLimit, async (req, res) => {
    const current = await session(req);
    if (!current) return unauthorized(res);
    const { currentPassword, password } = z.strictObject({ currentPassword: passwordInput, password: newPassword }).parse(req.body);
    if (!await accounts.passwords.change(current, currentPassword, password)) {
      res.status(403).json({ error: 'Check your current password and try again.' });
      return;
    }
    clearSession(res);
    clearAttempts(res);
    res.sendStatus(204);
  });

  api.get('/creator', async (req, res) => {
    const current = await session(req);
    if (!current) return unauthorized(res);
    const state = await accounts.creator(current.userId);
    res.json({ profile: state?.creatorProfile ?? null, continued: Boolean(state?.creatorOnboarding) });
  });
  api.get('/creator/design', async (req, res) => {
    const current = await session(req);
    if (!current) return unauthorized(res);
    const profile = await accounts.creatorDesign(current.userId);
    if (!profile) { res.status(403).json({ error: 'Create a Creator profile first.' }); return; }
    res.json({ design: profile.page?.design ?? null });
  });
  api.put('/creator/design', limit, async (req, res) => {
    const current = await session(req);
    if (!current) return unauthorized(res);
    const { design } = z.strictObject({ design: z.record(z.string(), z.unknown()) }).parse(req.body);
    if (!await accounts.saveCreatorDesign(current.userId, validateDesign(design))) {
      res.status(403).json({ error: 'Create a Creator profile first.' });
      return;
    }
    res.sendStatus(204);
  });

  api.post('/creator/continue', limit, async (req, res) => {
    const current = await session(req);
    if (!current) return unauthorized(res);
    z.strictObject({}).parse(req.body);
    await accounts.continueCreator(current.userId);
    res.sendStatus(204);
  });
  api.post('/creator/setup', limit, async (req, res) => {
    const current = await session(req);
    if (!current) return unauthorized(res);
    const { name } = z.strictObject({ name: z.string().trim().min(1).max(100)
      .refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)) }).parse(req.body);
    const profile = await accounts.setupCreator(current.userId, name);
    if (!profile) {
      res.status(409).json({ error: 'Continue through Creator onboarding first.' });
      return;
    }
    res.status(201).json(profile);
  });

  api.get('/admin', limit, async (req, res) => {
    const current = await session(req);
    if (!current) return unauthorized(res);
    const profile = await accounts.adminProfile(current.tokenHash);
    if (!profile) {
      res.status(403).json({ error: 'Administrator access is required.' });
      return;
    }
    res.json(await accounts.adminDashboard(profile));
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
  api.use(creatorCatalogRoutes(accounts.creatorCatalog, session, creatorMedia));
  return { api, callbacks, resolveOwner };
}
