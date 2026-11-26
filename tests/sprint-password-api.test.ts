import { testDatabaseUrl } from './test-database-url.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/database.js';
import { prismaAccounts, tokenHash } from '../server/prisma-accounts.js';
import { prismaIntelligence } from '../server/prisma-intelligence.js';
import { prismaWishlists } from '../server/prisma-wishlists.js';

const outbox = vi.hoisted(() => new Map<string, string>());
vi.mock('../server/account-mail.js', () => ({
  developmentAccountMail: () => async (_email: string, kind: string, code: string) => { outbox.set(kind, code); },
}));

it.skipIf(!testDatabaseUrl)('verifies password accounts, revokes sessions and isolates Creator ownership', async () => {
  const db = connectDatabase(testDatabaseUrl!);
  const accounts = prismaAccounts(db);
  const email = `fixture-${randomUUID()}@example.test`;
  const password = '12345678';
  const replacement = 'abcdefgh';
  const newEmail = `changed-${randomUUID()}@example.test`;
  const app = createApp({ repository: prismaWishlists(db), intelligence: prismaIntelligence(db), consumer: { accounts, providers: {} },
    preview: async () => null, secureCookies: false, trustedProxy: 'loopback', secret: randomBytes(32).toString('hex') });
  const http = request.agent(app);
  const other = request(app);
  let address = 10;
  const post = (route: string, data: object) => http.post('/api/account' + route).set('X-Nanti-Request', '1')
    .set('X-Forwarded-For', '192.0.2.' + address++).send(data);
  const subject = randomUUID();
  try {
    await http.post('/api/account/password/register').send({ email, password }).expect(403);
    await post('/password/register', { email, password, role: 'admin' }).expect(400);
    await post('/password/register', { email, password: '1234567' }).expect(400);
    await post('/password/register', { email, password }).expect(202);
    const duplicateRegistration = await post('/password/register', { email: email.toUpperCase(), password: replacement }).expect(202);
    expect(duplicateRegistration.status).toBe(202);
    expect(await db.passwordCredential.count({ where: { email } })).toBe(1);
    const registered = await db.passwordCredential.findUniqueOrThrow({ where: { email }, select: { userId: true } });
    expect(await db.adminNotification.count({ where: { eventKey: `user:${registered.userId}`, kind: 'new_user' } })).toBe(1);
    const pending = await post('/password/login', { email, password }).expect(401);
    expect(pending.body).toEqual({ error: 'Verify your email before signing in.' });
    expect(pending.headers['set-cookie']).toBeUndefined();
    const wrong = await post('/password/login', { email, password: replacement }).expect(401);
    const unknown = await post('/password/login', { email: newEmail, password }).expect(401);
    expect(wrong.body).toEqual({ error: 'Check your email, password, and email verification.' });
    expect(unknown.body).toEqual(wrong.body);
    await db.accountToken.updateMany({ where: { kind: 'verify', user: { password: { email } } }, data: { expiresAt: new Date(0) } });
    await post('/password/verify', { code: outbox.get('verify'), password }).expect(400);
    const expired = outbox.get('verify');
    await post('/password/resend', { email }).expect(202);
    const verify = outbox.get('verify')!;
    expect(verify).toBeTruthy();
    expect(verify).not.toBe(expired);
    await post('/password/verify', { code: 'A'.repeat(43), password }).expect(400);
    await post('/password/verify', { code: verify, password: replacement }).expect(400);
    await post('/password/verify', { code: verify, password }).expect(204);
    await post('/password/verify', { code: verify, password }).expect(400);
    await http.post('/api/session').set('X-Nanti-Request', '1').send({}).expect(200);
    const { body: guestList } = await http.post('/api/wishlists').set('X-Nanti-Request', '1')
      .send({ name: 'Password guest fixture', currency: 'IDR' }).expect(201);
    const guestFinanceContext = {
      cashMinor: '750000', essentialExpensesMinor: '300000', setAsideMinor: '100000',
      nextIncomeDate: '2026-12-01', nextIncomeMinor: '5000000', canWait: true,
    };
    await http.put('/api/intelligence/financial-context/IDR').set('X-Nanti-Request', '1')
      .send(guestFinanceContext).expect(204);
    await post('/password/login', { email, password }).expect(204);
    await http.get('/api/account').expect(200).expect(response => {
      expect(response.body.account).toMatchObject({ email, emailVerified: true, hasPassword: true });
      expect(response.body.account.import).toMatchObject({ guestLists: 1, accountLists: 0 });
    });
    const wishlist = '/api/wishlists/' + guestList.id;
    await http.get(wishlist).expect(404);
    await post('/import', { confirm: true }).expect(204);
    await http.get(wishlist).expect(200).expect(({ body }) => {
      expect(body).toMatchObject({ id: guestList.id, name: 'Password guest fixture' });
    });
    await http.get('/api/intelligence/financial-context/IDR').expect(200).expect(({ body }) => {
      expect(body.context).toEqual(guestFinanceContext);
    });
    await http.get('/api/account/admin').expect(403);
    await other.get('/api/account/creator').expect(401);
    await http.get('/api/account/creator').expect(200, { profile: null, continued: false });
    await post('/creator/setup', { name: 'Fixture Studio' }).expect(409);
    await post('/creator/continue', {}).expect(204);
    await post('/creator/setup', { name: 'Fixture Studio', userId: randomUUID() }).expect(400);
    const { body: profile } = await post('/creator/setup', { name: 'Fixture Studio' }).expect(201);
    await post('/creator/setup', { name: 'Cannot replace the profile' }).expect(201, profile);
    const user = await db.passwordCredential.findUniqueOrThrow({ where: { email } });
    const oauthSession = await accounts.signin('google', subject, 'Other account', null, email);
    const oauth = await accounts.session(tokenHash(oauthSession));
    expect(oauth?.userId).not.toBe(user.userId);
    const oauthHeader = 'nanti-user=' + oauthSession;
    await other.get('/api/account/creator/design').set('Cookie', oauthHeader).expect(403);
    await other.get('/api/account/creator/design').expect(401);
    await http.put('/api/account/creator/design').set('X-Nanti-Request', '1').send({ design: { theme: 'gallery' } }).expect(204);
    await http.get('/api/account/creator/design').expect(200).expect(response => {
      expect(response.body.design.theme).toBe('gallery');
    });
    const knownAddressRecovery = await post('/password/forgot', { email }).expect(202);
    const unknownAddressRecovery = await post('/password/forgot', { email: `missing-${randomUUID()}@example.test` }).expect(202);
    expect(unknownAddressRecovery.status).toBe(knownAddressRecovery.status);
    expect(unknownAddressRecovery.body).toEqual(knownAddressRecovery.body);
    await db.accountToken.updateMany({ where: { userId: user.userId, kind: 'reset' }, data: { expiresAt: new Date(0) } });
    await post('/password/reset', { code: outbox.get('reset'), password: replacement }).expect(400);
    await post('/password/forgot', { email }).expect(202);
    const reset = outbox.get('reset');
    const concurrent = await other.post('/api/account/password/login').set('X-Nanti-Request', '1')
      .send({ email, password }).expect(204);
    const otherCookie = concurrent.get('set-cookie')![0]!.split(';')[0]!;
    await post('/password/reset', { code: reset, password: '1234567' }).expect(400);
    await other.post('/api/account/password/reset').set('X-Nanti-Request', '1').set('Cookie', oauthHeader)
      .send({ code: reset, password: replacement }).expect(204).expect(({ headers }) => {
        expect(headers['set-cookie']).toBeUndefined();
      });
    await other.get('/api/account/creator').set('Cookie', oauthHeader).expect(200);
    await post('/password/reset', { code: reset, password: replacement }).expect(400);
    await other.get('/api/account/creator').set('Cookie', otherCookie).expect(401);
    await post('/password/login', { email, password }).expect(401);
    await post('/password/login', { email, password: replacement }).expect(204);
    await http.get('/api/account/creator').expect(200, { profile, continued: true });
    await post('/password/change', { currentPassword: replacement, password: '1234567' }).expect(400);
    await post('/password/change', { currentPassword: password, password }).expect(403);
    await post('/password/change', { currentPassword: replacement, password }).expect(204);
    await http.get('/api/account/creator').expect(401);
    await post('/password/login', { email, password }).expect(204);
    const remote = await other.post('/api/account/password/login').set('X-Nanti-Request', '1')
      .send({ email, password }).expect(204);
    const remoteCookie = remote.get('set-cookie')![0]!.split(';')[0]!;
    const sessions = await http.get('/api/account/sessions').expect(200);
    const current = sessions.body.sessions.find((item: { current: boolean }) => item.current);
    const otherSession = sessions.body.sessions.find((item: { current: boolean }) => !item.current);
    expect(sessions.body.sessions).toHaveLength(2);
    expect(current.id).not.toBe(otherSession.id);
    expect(otherSession.id).not.toBe(tokenHash(remoteCookie.split('=')[1]!));
    await http.delete('/api/account/sessions/' + otherSession.id).set('X-Nanti-Request', '1').send({}).expect(204);
    await other.get('/api/account/creator').set('Cookie', remoteCookie).expect(401);
    await http.get('/api/account/creator').expect(200);
    for (let attempt = 0; attempt < 12; attempt++) {
      await http.post('/api/account/password/forgot').set('X-Nanti-Request', '1')
        .set('X-Forwarded-For', '198.51.100.10').send({ email: `limited-${randomUUID()}@example.test` }).expect(202);
    }
    await http.post('/api/account/password/forgot').set('X-Nanti-Request', '1')
      .set('X-Forwarded-For', '198.51.100.10').send({ email }).expect(429);
    const third = await other.post('/api/account/password/login').set('X-Nanti-Request', '1')
      .send({ email, password }).expect(204);
    const thirdCookie = third.get('set-cookie')![0]!.split(';')[0]!;
    await other.post('/api/account/sessions/revoke-all').set('X-Nanti-Request', '1').send({ confirm: true }).expect(401);
    await http.post('/api/account/sessions/revoke-all').send({ confirm: true }).expect(403);
    await post('/sessions/revoke-all', { confirm: true }).expect(204);
    await http.get('/api/account/creator').expect(401);
    await other.get('/api/account/creator').set('Cookie', thirdCookie).expect(401);
    await post('/password/login', { email, password }).expect(204);
    await post('/password/email', { email: newEmail, currentPassword: replacement }).expect(403);
    await post('/password/email', { email: newEmail, currentPassword: password }).expect(202);
    await db.accountToken.updateMany({ where: { userId: user.userId, kind: 'changeEmail' }, data: { expiresAt: new Date(0) } });
    await post('/password/email/verify', { code: outbox.get('changeEmail') }).expect(400);
    await post('/password/email', { email: newEmail, currentPassword: password }).expect(202);
    const emailCode = outbox.get('changeEmail');
    expect(emailCode).toBeTruthy();
    await other.post('/api/account/password/email/verify').set('X-Nanti-Request', '1').set('Cookie', oauthHeader)
      .send({ code: emailCode }).expect(204).expect(({ headers }) => {
        expect(headers['set-cookie']).toBeUndefined();
      });
    await other.get('/api/account/creator').set('Cookie', oauthHeader).expect(200);
    await post('/password/email/verify', { code: emailCode }).expect(400);
    await http.get('/api/account/creator').expect(401);
    await post('/password/login', { email, password }).expect(401);
    await post('/password/login', { email: newEmail, password }).expect(204);
    await http.get(wishlist).expect(200);
    await db.user.delete({ where: { id: user.userId } });
  } finally {
    const ownedUsers = await db.user.findMany({ where: { OR: [{ password: { email: { in: [email, newEmail] } } },
      { identities: { some: { subjectHash: tokenHash(subject) } } }] }, select: { id: true } });
    await db.adminNotification.deleteMany({ where: { eventKey: { in: ownedUsers.map(({ id }) => `user:${id}`) } } });
    await db.user.deleteMany({ where: { id: { in: ownedUsers.map(({ id }) => id) } } });
    await db.$disconnect();
  }
}, 25_000);
