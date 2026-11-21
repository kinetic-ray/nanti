import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { accountRoutes } from '../server/account-routes.js';
import { authToken, tokenHash } from '../server/prisma-accounts.js';
import type { Accounts } from '../server/prisma-accounts.js';

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
