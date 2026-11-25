import { testDatabaseUrl } from './test-database-url.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { exportJWK, exportPKCS8, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { hashAdminPassword } from '../server/admin-credentials.js';
import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/database.js';
import { configureOAuth } from '../server/oauth-providers.js';
import { prismaAccounts, tokenHash } from '../server/prisma-accounts.js';
import { prismaAffiliate } from '../server/prisma-affiliate.js';
import { prismaIntelligence } from '../server/prisma-intelligence.js';
import { prismaWishlists } from '../server/prisma-wishlists.js';
import type { LoginProvider } from '../shared/account.js';

const mutation = { 'X-Nanti-Request': '1', 'Content-Type': 'application/json' };
const path = '/api/account';
const origin = 'https://nanti.example.test';
const google = 'fixture-google';
const apple = 'fixture-apple';
const config = {
  AUTH_PUBLIC_ORIGIN: origin,
  AUTH_GOOGLE_CLIENT_ID: google, AUTH_GOOGLE_CLIENT_SECRET: 'fixture-secret',
  AUTH_APPLE_CLIENT_ID: apple, AUTH_APPLE_TEAM_ID: 'fixture-team',
  AUTH_APPLE_KEY_ID: 'fixture-key',
};
const databaseUrl = testDatabaseUrl;
type Proof = { subject: string; nonce?: string; issuer?: string; audience?: string; expired?: boolean; invalidSignature?: boolean };

it('validates provider configuration without disclosing secrets', async () => {
  await expect(configureOAuth({}, true)).resolves.toEqual({});
  await expect(configureOAuth({ AUTH_GOOGLE_CLIENT_ID: google }, false)).rejects.toThrow('every credential');
  await expect(configureOAuth({ ...config, AUTH_APPLE_CLIENT_ID: '', AUTH_APPLE_TEAM_ID: '', AUTH_APPLE_KEY_ID: '',
    AUTH_PUBLIC_ORIGIN: 'https://nanti.example.test/path' }, false)).rejects.toThrow('origin');
  await expect(configureOAuth({ ...config, AUTH_APPLE_CLIENT_ID: '', AUTH_APPLE_TEAM_ID: '', AUTH_APPLE_KEY_ID: '',
    AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:5173' }, false)).resolves.toHaveProperty('google');
});

describe.skipIf(!databaseUrl)('Consumer accounts over HTTP and MySQL', () => {
  const db = connectDatabase(databaseUrl ?? 'mysql://127.0.0.1/nanti_test');
  const subjects = new Set<string>();
  const owners = new Set<string>();

  async function fixture() {
    const providerKey = await generateKeyPair('RS256');
    const wrongKey = await generateKeyPair('RS256');
    const appKey = await generateKeyPair('ES256', { extractable: true });
    const jwk = { ...await exportJWK(providerKey.publicKey), kid: 'fixture-jwk', alg: 'RS256', use: 'sig' };
    const proofs = new Map<string, { authorization: URL; proof: Proof; provider: LoginProvider }>();
    const providers = await configureOAuth({
      ...config, AUTH_APPLE_PRIVATE_KEY_BASE64: Buffer.from(await exportPKCS8(appKey.privateKey)).toString('base64'),
    }, true, async (url, options) => {
      const provider = new URL(url).hostname === 'appleid.apple.com' ? 'apple' : 'google';
      const issuer = provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com';
      if (options.method === 'GET') return Response.json({ keys: [jwk] });
      const form = new URLSearchParams(options.body as URLSearchParams);
      const entry = proofs.get(form.get('code') ?? '');
      if (!entry || entry.provider !== provider) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      proofs.delete(form.get('code')!);
      expect(form.get('redirect_uri')).toBe(`${origin}${path}/${provider}/callback`);
      if (provider === 'google') {
        const verifier = form.get('code_verifier')!;
        expect(Buffer.from(tokenHash(verifier), 'hex').toString('base64url')).toBe(entry.authorization.searchParams.get('code_challenge'));
        expect(form.get('client_secret')).toBe('fixture-secret');
      } else {
        expect(form.has('code_verifier')).toBe(false);
        const { payload, protectedHeader } = await jwtVerify(form.get('client_secret')!, appKey.publicKey, {
          issuer: 'fixture-team', audience: issuer, subject: apple, algorithms: ['ES256'],
        });
        expect(protectedHeader.kid).toBe('fixture-key');
        expect(payload.exp).toBeGreaterThan(payload.iat!);
      }
      const { proof, authorization } = entry;
      const idToken = await new SignJWT({ nonce: proof.nonce ?? authorization.searchParams.get('nonce'),
        ...(provider === 'google' && { name: 'Verified profile', picture: 'https://lh3.googleusercontent.com/profile' }), email: 'same-email@example.test' })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setSubject(proof.subject).setIssuer(proof.issuer ?? issuer)
        .setAudience(proof.audience ?? (provider === 'google' ? google : apple))
        .setIssuedAt().setExpirationTime(proof.expired ? Math.floor(Date.now() / 1000) - 600 : '5m')
        .sign(proof.invalidSignature ? wrongKey.privateKey : providerKey.privateKey);
      return Response.json({ access_token: 'discard-this', token_type: 'Bearer', id_token: idToken });
    });
    const admin = { username: 'fixture-admin', passwordHash: await hashAdminPassword('local account fixture administrator') };
    const app = createApp({ repository: prismaWishlists(db), intelligence: prismaIntelligence(db), affiliate: prismaAffiliate(db),
      consumer: { accounts: prismaAccounts(db), providers }, admin, secret: randomBytes(32).toString('hex'),
      secureCookies: true, preview: async () => null });
    const http = request(app);
    const cookie = (res: { headers: Record<string, unknown> }, name: string) =>
      (res.headers['set-cookie'] as string[] | undefined)?.find(value => value.startsWith(`${name}=`))?.split(';')[0];

    async function anonymous() {
      const res = await http.post('/api/session').set(mutation).send({}).expect(200);
      const guest = cookie(res, '__Host-nanti')!;
      owners.add(decodeURIComponent(guest.split('=')[1]!).slice(2).split('.')[0]!);
      return guest;
    }
    async function start(provider: LoginProvider, browser = '', purpose = 'signin') {
      const res = await http.post(`${path}/${provider}/start`).set(mutation).set('Cookie', browser).send({ purpose }).expect(200);
      const url = new URL(res.body.url);
      const redirect = `${origin}${path}/${provider}/callback`;
      expect(url.searchParams.get('redirect_uri')).toBe(redirect);
      expect(url.searchParams.get('response_type')).toBe('code');
      const cookieHeader = String(res.headers['set-cookie']);
      expect(cookieHeader).toMatch(/Secure; HttpOnly|HttpOnly; Secure/);
      if (provider === 'google') expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      else {
        expect(url.searchParams.get('response_mode')).toBe('form_post');
        expect(cookieHeader).toContain('SameSite=None');
      }
      return { provider, url, attempt: cookie(res, `__Host-nanti-oauth-${provider}`)! };
    }
    async function callback(entry: Awaited<ReturnType<typeof start>>, proof: Proof, options: {
      status?: string; state?: string; browser?: string;
    } = {}) {
      const code = randomUUID();
      subjects.add(proof.subject);
      proofs.set(code, { authorization: entry.url, proof, provider: entry.provider });
      const values = { code, state: options.state ?? entry.url.searchParams.get('state')! };
      const result = entry.provider === 'google'
        ? http.get(`${path}/google/callback`).query({ ...values, redirect: 'https://other.example/' })
        : http.post(`${path}/apple/callback`).type('form').send({ ...values,
          user: JSON.stringify({ email: 'unsafe@example.test', name: { firstName: 'Do not trust' } }) });
      return result.set('Cookie', options.browser ?? entry.attempt)
        .expect(303).expect('Cache-Control', 'no-store').expect('Location', `/?auth=${options.status ?? 'signed-in'}`);
    }
    async function signIn(provider: LoginProvider, subject: string, guest = '') {
      const response = await callback(await start(provider, guest), { subject });
      const session = cookie(response, '__Host-nanti-user')!;
      expect(session).toBeTruthy();
      return session;
    }
    return { http, cookie, anonymous, start, callback, signIn, admin };
  }

  afterEach(async () => {
    const identities = await db.authIdentity.findMany({
      where: { subjectHash: { in: [...subjects].map(tokenHash) } }, select: { userId: true },
    });
    await db.user.deleteMany({ where: { id: { in: identities.map(identity => identity.userId) } } });
    await db.dataOwner.deleteMany({ where: { id: { in: [...owners] } } });
    subjects.clear();
    owners.clear();
  });
  afterAll(() => db.$disconnect());

  it('rejects a Google sign-in started on an origin that cannot receive the callback cookie', async () => {
    const { http } = await fixture();
    const mismatch = await http.post(`${path}/google/start`).set(mutation)
      .set('Origin', 'https://alias.nanti.example.test').send({ purpose: 'signin' }).expect(409);
    expect(mismatch.body).toEqual({ error: 'Open Nanti at its main address and try signing in again.' });
    expect(mismatch.headers['set-cookie']).toBeUndefined();

    const canonical = await http.post(`${path}/google/start`).set(mutation)
      .set('Origin', origin).send({ purpose: 'signin' }).expect(200);
    expect(new URL(canonical.body.url).searchParams.get('redirect_uri')).toBe(`${origin}${path}/google/callback`);
    expect(String(canonical.headers['set-cookie'])).toContain('__Host-nanti-oauth-google=');
  });

  it('verifies signed Google and Apple responses and never merges on email', async () => {
    const { http, signIn } = await fixture();
    const subject = randomUUID();
    const first = await signIn('google', subject);
    const second = await signIn('apple', subject);
    const list = await http.post('/api/wishlists').set(mutation).set('Cookie', first)
      .send({ name: 'Google wishlist', currency: 'IDR' }).expect(201);
    await http.get(`/api/wishlists/${list.body.id}`).set('Cookie', second).expect(404);
    await http.get(path).set('Cookie', first).expect(200, {
      available: ['google', 'apple'], account: { displayName: 'Verified profile', providers: ['google'],
        avatarUrl: 'https://lh3.googleusercontent.com/profile', canAccessCreatorStudio: false,
        recentlyVerified: true, import: null },
    });
    await http.get(path).set('Cookie', second).expect(200, {
      available: ['google', 'apple'], account: { displayName: null, providers: ['apple'], canAccessCreatorStudio: false, recentlyVerified: true, import: null },
    });
    const returning = await signIn('google', subject);
    expect(returning).not.toBe(first);
    await http.get(`/api/wishlists/${list.body.id}`).set('Cookie', returning).expect(200);
  });

  it('rejects invalid state, browser, issuer, audience, nonce, expiration, signatures and callback replay', async () => {
    const { http, start, callback, anonymous } = await fixture();
    const guest = await anonymous();
    const subject = randomUUID();
    const entry = await start('google', guest);
    await callback(entry, { subject }, { state: randomBytes(32).toString('base64url'), status: 'failed' });
    await callback(entry, { subject }, { browser: guest, status: 'failed' });
    await callback(entry, { subject });
    await callback(entry, { subject }, { status: 'failed' });
    for (const bad of [{ issuer: origin }, { audience: apple }, { nonce: 'wrong' }, { expired: true }, { invalidSignature: true }]) {
      const result = await callback(await start('google'), { subject, ...bad }, { status: 'failed' });
      expect(result.headers['set-cookie']).toHaveLength(1);
    }
    await callback(await start('apple'), { subject, nonce: 'wrong' }, { status: 'failed' });
    const cancelled = await start('google');
    await http.get(`${path}/google/callback`).set('Cookie', cancelled.attempt)
      .query({ state: cancelled.url.searchParams.get('state'), error: 'access_denied' })
      .expect(303).expect('Location', '/?auth=cancelled');
    await http.post(`${path}/google/start?redirect=https://other.example/`).set(mutation)
      .send({ purpose: 'signin', returnTo: 'https://other.example/' }).expect(400);
    await http.post(`${path}/google/start`).send({ purpose: 'signin' }).expect(403);
    await http.post(`${path}/logout`).type('form').send({ confirm: 'true' }).expect(403);
  });

  it('keeps unimported guest data after sign-out and can import a standalone preference later', async () => {
    const { http, anonymous, signIn } = await fixture();
    const guest = await anonymous();
    const subject = randomUUID();
    const prefs = '/api/intelligence/preferences';
    await http.put(prefs).set('Cookie', guest).set(mutation).send({ coolingOffDays: 6 }).expect(204);
    const current = await signIn('apple', subject, guest);
    await http.get(prefs).set('Cookie', `${current}; ${guest}`).expect(200, { coolingOffDays: null });
    await http.post(`${path}/logout`).set('Cookie', `${current}; ${guest}`).set(mutation).send({}).expect(204);
    await http.get(prefs).set('Cookie', guest).expect(200, { coolingOffDays: 6 });
    const next = await signIn('apple', subject, guest);
    await http.get(path).set('Cookie', `${next}; ${guest}`).expect(200).expect(({ body }) =>
      expect(body.account.import).toEqual({ guestLists: 0, accountLists: 0, guestPreference: true }));
    await http.post(`${path}/import`).set('Cookie', `${next}; ${guest}`).set(mutation).send({ confirm: true }).expect(204);
    await http.get(prefs).set('Cookie', next).expect(200, { coolingOffDays: 6 });
    await http.get(prefs).set('Cookie', guest).expect(401);
  });

  it('links only through a recently verified session and rejects a provider identity owned by another account', async () => {
    const { http, start, signIn, callback } = await fixture();
    const googleSubject = randomUUID();
    const appleSubject = randomUUID();
    const session = await signIn('google', googleSubject);
    const hash = tokenHash(session.split('=')[1]!);
    await http.post(`${path}/apple/start`).set(mutation).send({ purpose: 'link' }).expect(401);
    await db.userSession.update({ where: { tokenHash: hash }, data: { verifiedAt: new Date(0) } });
    await http.post(`${path}/apple/start`).set(mutation).set('Cookie', session).send({ purpose: 'link' }).expect(403);
    await callback(await start('google', session, 'verify'), { subject: randomUUID() }, { status: 'failed' });
    await callback(await start('google', session, 'verify'), { subject: googleSubject }, { status: 'verified' });
    await signIn('apple', appleSubject);
    await callback(await start('apple', session, 'link'), { subject: appleSubject }, { status: 'failed' });
    const link = randomUUID();
    await callback(await start('apple', session, 'link'), { subject: link }, { status: 'linked' });
    const returning = await signIn('apple', link);
    await http.get(path).set('Cookie', returning).expect(200).expect(({ body }) =>
      expect(body.account.providers).toEqual(['google', 'apple']));
  });

  it('imports guest data once, preserves timing fingerprints and existing settings, and enforces owner boundaries across devices', async () => {
    const { http, anonymous, signIn } = await fixture();
    const guest = await anonymous();
    const otherGuest = await anonymous();
    const googleSubject = randomUUID();
    const existing = await signIn('google', googleSubject);
    const create = (browser: string, name: string) =>
      http.post('/api/wishlists').set('Cookie', browser).set(mutation).send({ name, currency: 'IDR' }).expect(201);
    const own = (await create(existing, 'Existing account list')).body.id;
    const source = (await create(guest, 'Guest list')).body.id;
    const unknown = (await create(otherGuest, 'Other guest list')).body.id;
    const prefs = '/api/intelligence/preferences';
    await http.put(prefs).set('Cookie', existing).set(mutation).send({ coolingOffDays: 9 }).expect(204);
    await http.put(prefs).set('Cookie', guest).set(mutation).send({ coolingOffDays: 5 }).expect(204);
    const listPath = `/api/wishlists/${source}`;
    await http.post(`${listPath}/items`).set('Cookie', guest).set(mutation)
      .send({ name: 'Guest product', priceMinor: 9, quantity: 2, url: null }).expect(201);
    const item = (await http.get(listPath).set('Cookie', guest).expect(200)).body.items[0].id;
    const timing = `/api/intelligence/wishlists/${source}/items/${item}/timing`;
    const finances = { liquidMinor: '100', obligationsMinor: '1', reserveMinor: '4' };
    const record = (await http.post(`${timing}/history`).set('Cookie', guest).set(mutation).send(finances).expect(201)).body;
    const login = await signIn('google', googleSubject, guest);
    const both = `${login}; ${guest}`;
    await http.get(path).set('Cookie', both).expect(200).expect(({ body }) =>
      expect(body.account.import).toEqual({ guestLists: 1, accountLists: 1, guestPreference: true }));
    await http.get(listPath).set('Cookie', both).expect(404);
    await http.get(listPath).set('Cookie', guest).expect(200);
    await http.post(`${path}/import`).set('Cookie', `${login}; ${otherGuest}`).set(mutation).send({ confirm: true }).expect(409);
    await http.post(`${path}/import`).set('Cookie', both).set(mutation).send({ confirm: false }).expect(400);
    const importData = () => http.post(`${path}/import`).set('Cookie', both).set(mutation).send({ confirm: true }).expect(204);
    await Promise.all([importData(), importData()]);
    await http.get('/api/wishlists').set('Cookie', existing).expect(200).expect(({ body }) =>
      expect(body.map((entry: { id: string }) => entry.id)).toEqual([own, source]));
    await http.get(listPath).set('Cookie', existing).expect(200).expect(({ body }) => expect(body.scopeId).toBeUndefined());
    await http.patch(listPath).set('Cookie', existing).set(mutation).send({ name: 'Imported' }).expect(204);
    await http.get(prefs).set('Cookie', existing).expect(200, { coolingOffDays: 9 });
    await http.get(`${timing}/history`).set('Cookie', existing).expect(200).expect(({ body }) =>
      expect(body.records[0]).toEqual(record));
    await http.post(timing).set('Cookie', existing).set(mutation)
      .send({ ...finances, reviewId: record.id, confirmedCurrent: true }).expect(200).expect(({ body }) => expect(body.review).toEqual([]));
    await http.get(listPath).set('Cookie', guest).expect(401);
    await http.get(listPath).set('Cookie', otherGuest).expect(404);
    const stranger = await signIn('google', randomUUID(), guest);
    await http.get(`${timing}/history`).set('Cookie', stranger).expect(404);
    await http.get(`${listPath}/items/${item}/purchase`).set('Cookie', stranger).expect(404);
    await http.patch(listPath).set(mutation).set('Cookie', stranger).send({ name: 'Changed' }).expect(404);
    await http.delete(listPath).set(mutation).set('Cookie', stranger).send({}).expect(404);
    await http.get(`/api/wishlists/${unknown}`).set('Cookie', existing).expect(404);
    await http.post(`${path}/import`).set('Cookie', `${stranger}; ${guest}`).set(mutation).send({ confirm: true }).expect(409);
  });

  it('invalidates sessions on logout, expiration and deletion while keeping admin permissions separate', async () => {
    const { http, cookie, anonymous, signIn, admin } = await fixture();
    const guest = await anonymous();
    const subject = randomUUID();
    const session = await signIn('google', subject, guest);
    const otherDevice = await signIn('google', subject);
    const expired = await signIn('google', subject);
    await db.userSession.update({ where: { tokenHash: tokenHash(expired.split('=')[1]!) }, data: { expiresAt: new Date(0) } });
    await http.get('/api/wishlists').set('Cookie', `${expired}; ${guest}`).expect(401);
    await http.post(`${path}/logout`).set(mutation).set('Cookie', otherDevice).send({}).expect(204);
    await http.get('/api/wishlists').set('Cookie', otherDevice).expect(401);
    await http.get('/api/admin/opportunities').set('Cookie', session).expect(401);
    const adminResponse = await http.post('/api/admin/login').set(mutation)
      .send({ username: admin.username, password: 'local account fixture administrator' }).expect(200);
    const adminCookie = cookie(adminResponse, '__Host-nanti-admin')!;
    await http.patch(path).set(mutation).set('Cookie', adminCookie).send({ displayName: 'Admin' }).expect(401);
    await http.patch(path).set(mutation).set('Cookie', session).send({ displayName: 'Edited name' }).expect(204);
    await http.get(path).set('Cookie', session).expect(200).expect(({ body }) => expect(body.account.displayName).toBe('Edited name'));
    const list = (await http.post('/api/wishlists').set(mutation).set('Cookie', session)
      .send({ name: 'Delete this list', currency: 'IDR' }).expect(201)).body;
    const original = `https://www.ikea.com/us/en/p/fixture-${Math.floor(10_000_000 + Math.random() * 90_000_000)}/`;
    await http.post(`/api/wishlists/${list.id}/items`).set(mutation).set('Cookie', session)
      .send({ name: 'Fixture product', priceMinor: 120, quantity: 1, url: original }).expect(201);
    const catalog = await db.productIdentity.findFirstOrThrow({ where: { canonicalUrl: original } });
    await http.post(`/api/intelligence/wishlists/${list.id}/timing/history`).set(mutation).set('Cookie', session)
      .send({ liquidMinor: '200', obligationsMinor: '0', reserveMinor: '0' }).expect(201);
    const second = await signIn('google', subject);
    const identity = await db.authIdentity.findUniqueOrThrow({ where: {
      provider_subjectHash: { provider: 'google', subjectHash: tokenHash(subject) },
    } });
    await http.put('/api/intelligence/preferences').set(mutation).set('Cookie', session).send({ coolingOffDays: 8 }).expect(204);
    await http.delete(path).set(mutation).set('Cookie', session).send({ confirm: false }).expect(400);
    await http.delete(path).set(mutation).set('Cookie', session).send({ confirm: true }).expect(204);
    await http.get('/api/wishlists').set('Cookie', second).expect(401);
    await http.get('/api/admin/opportunities').set('Cookie', adminCookie).expect(200);
    expect(await db.wishlist.findUnique({ where: { id: list.id } })).toBeNull();
    expect(await db.assessment.findMany({ where: { wishlistId: list.id } })).toEqual([]);
    expect(await db.dataOwner.findMany({ where: { userId: identity.userId } })).toEqual([]);
    expect(await db.intelligencePreference.findUnique({ where: { ownerId: identity.userId } })).toBeNull();
    expect(await db.userSession.findMany({ where: { userId: identity.userId } })).toEqual([]);
    expect(await db.productIdentity.findUnique({ where: { id: catalog.id } })).not.toBeNull();
    await db.adminNotification.deleteMany({ where: { identityId: catalog.id } });
    await db.productIdentity.delete({ where: { id: catalog.id } });
    await db.adminSession.deleteMany({ where: { tokenHash: tokenHash(adminCookie.split('=')[1]!) } });
  });
});
