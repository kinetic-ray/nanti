import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { accountRoutes } from '../server/account-routes.js';
import { authToken, tokenHash } from '../server/prisma-accounts.js';
import type { Accounts } from '../server/prisma-accounts.js';

const mail = vi.hoisted(() => ({ send: vi.fn(), notice: vi.fn() }));
vi.mock('../server/account-mail.js', () => ({ developmentAccountMail: () => null }));
vi.mock('../server/transactional-account-mail.js', () => ({
  transactionalAccountMail: () => Object.assign(mail.send, { notice: mail.notice }),
}));

it('requires a valid session and an administrator role before reading the dashboard', async () => {
  const token = authToken();
  const sessionHash = tokenHash(token);
  const dashboard = { profile: { id: 'user', role: 'admin' }, users: [], activity: [] };
  const adminProfile = vi.fn().mockResolvedValue(null);
  const adminDashboard = vi.fn().mockResolvedValue(dashboard);
  const accounts = { session: vi.fn().mockResolvedValue({ tokenHash: sessionHash, userId: 'user' }),
    adminProfile, adminDashboard } as unknown as Accounts;
  const app = express().use(cookieParser(), accountRoutes(accounts, {}, true, '__Host-nanti').api);
  await request(app).get('/admin').expect(401);
  const cookie = `__Host-nanti-user=${token}`;
  await request(app).get('/admin').set('Cookie', cookie).expect(403);
  expect(adminDashboard).not.toHaveBeenCalled();
  adminProfile.mockResolvedValue(dashboard.profile);
  await request(app).get('/admin').set('Cookie', cookie).expect(200, dashboard);
  expect(adminProfile).toHaveBeenCalledWith(sessionHash);
  expect(adminDashboard).toHaveBeenCalledWith(dashboard.profile);
});

it('accepts only named return destinations at sign-in start', async () => {
  const attempt = vi.fn();
  const app = express().use(cookieParser(), express.json(), accountRoutes({ attempt } as unknown as Accounts, {
    google: { authorization: async () => new URL('https://accounts.google.com/'), verify: vi.fn() },
  }, true, '__Host-nanti').api);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ invalid: Boolean(error) });
  });
  await request(app).post('/google/start').send({ purpose: 'signin', destination: '//example.test' }).expect(400);
  expect(attempt).not.toHaveBeenCalled();
  await request(app).post('/google/start').send({ purpose: 'signin', destination: 'admin' }).expect(200);
  expect(attempt).toHaveBeenCalledWith(expect.objectContaining({ destination: 'admin' }));
});

it('accepts eight-character new passwords and rejects shorter ones', async () => {
  mail.send.mockReset().mockResolvedValue(undefined);
  mail.notice.mockReset().mockResolvedValue(undefined);
  const sessionToken = authToken();
  const current = { userId: 'owner', tokenHash: tokenHash(sessionToken) };
  const session = vi.fn(async (hash: string) => hash === current.tokenHash ? current : null);
  const passwords = {
    register: vi.fn().mockResolvedValue(undefined),
    issue: vi.fn().mockResolvedValue(null),
    consume: vi.fn().mockResolvedValue({ email: 'owner@example.test' }),
    change: vi.fn().mockResolvedValue({ email: 'owner@example.test' }),
  };
  const accounts = { session, passwords } as unknown as Accounts;
  const app = express().use(cookieParser(), express.json(), accountRoutes(accounts, {}, false, 'nanti').api);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ invalid: Boolean(error) });
  });
  const http = request(app);
  const code = authToken();
  const sessionCookie = `nanti-user=${sessionToken}`;

  await http.post('/password/register').send({ email: 'owner@example.test', password: '1234567' }).expect(400);
  expect(passwords.register).not.toHaveBeenCalled();
  await http.post('/password/register').send({ email: 'owner@example.test', password: '12345678' }).expect(202);
  expect(passwords.register).toHaveBeenCalledWith('owner@example.test', '12345678');

  await http.post('/password/reset').send({ code, password: '1234567' }).expect(400);
  expect(passwords.consume).not.toHaveBeenCalled();
  await http.post('/password/reset').send({ code, password: '12345678' }).expect(204);
  expect(passwords.consume).toHaveBeenCalledWith(code, 'reset', '12345678');

  await http.post('/password/change').set('Cookie', sessionCookie)
    .send({ currentPassword: 'current-password', password: '1234567' }).expect(400);
  expect(passwords.change).not.toHaveBeenCalled();
  await http.post('/password/change').set('Cookie', sessionCookie)
    .send({ currentPassword: 'current-password', password: '12345678' }).expect(204);
  expect(passwords.change).toHaveBeenCalledWith(current, 'current-password', '12345678');
});
