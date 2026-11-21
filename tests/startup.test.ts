import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createServer as createVite } from 'vite';
import { expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/database.js';

it('fails before opening Vite when the required local configuration is missing', () => {
  const result = spawnSync(process.execPath, ['scripts/dev.mjs'], {
    env: { ...process.env, DATABASE_URL: '', SESSION_SECRET: '' }, encoding: 'utf8', timeout: 5000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('DATABASE_URL and SESSION_SECRET');
  expect(result.stdout).not.toContain('VITE');
});

it('reports an API outage as JSON through the actual Vite session proxy', async () => {
  const closed = createServer().listen(0, '127.0.0.1');
  await once(closed, 'listening');
  const port = (closed.address() as AddressInfo).port;
  await new Promise<void>(resolve => closed.close(() => resolve()));
  vi.stubEnv('NANTI_DEV_API_ORIGIN', `http://127.0.0.1:${port}`);
  const vite = await createVite({ logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  try {
    await request(createServer(vite.middlewares)).post('/api/session')
      .set('X-Nanti-Request', '1').send({}).expect(503)
      .expect('Cache-Control', 'no-store')
      .expect({ code: 'api_unavailable', error: 'Start the local Nanti API, then try again.' });
  } finally {
    await vite.close();
    vi.unstubAllEnvs();
  }
});

it('reports database failure for readiness and guest requests without exposing connection details', async () => {
  const offline = Object.assign(new Error('Example database credentials'), { code: 'P1001' });
  const checkDatabase = vi.fn().mockRejectedValueOnce(offline).mockResolvedValue(undefined);
  const list = vi.fn().mockRejectedValue(offline);
  const app = createApp({
    checkDatabase, repository: { list, find: vi.fn(), create: vi.fn(), rename: vi.fn(),
      remove: vi.fn(), addItem: vi.fn(), updateItem: vi.fn(), removeItem: vi.fn() },
    preview: async () => null, secret: 'startup-test-fixture', secureCookies: false,
  });
  const response = await request(app).get('/api/health').expect(503);
  expect(response.body.code).toBe('database_unavailable');
  expect(response.text).not.toContain(offline.message);
  await request(app).get('/api/health').expect(200, { service: 'nanti', status: 'ready' });
  await request(app).post('/api/session').set('X-Nanti-Request', '1').send({}).expect(503)
    .expect({ code: 'database_unavailable', error: 'Could not reach Nanti. Try again.' });
});

it('loads the Vercel entrypoint without a database handshake and preserves the API mutation check', async () => {
  const environment = {
    DATABASE_URL: 'mysql://fixture:unused@unreachable.invalid:4000/nanti?sslaccept=strict',
    DATABASE_CA_CERT_BASE64: '', DATABASE_POOL_LIMIT: '', SESSION_SECRET: 'local-serverless-test-secret-at-least-32-characters',
    AUTH_PUBLIC_ORIGIN: '', AUTH_GOOGLE_CLIENT_ID: '', AUTH_GOOGLE_CLIENT_SECRET: '',
    AUTH_APPLE_CLIENT_ID: '', AUTH_APPLE_TEAM_ID: '', AUTH_APPLE_KEY_ID: '', AUTH_APPLE_PRIVATE_KEY_BASE64: '',
    NANTI_ADMIN_USERNAME: '', NANTI_ADMIN_PASSWORD_HASH: '', NANTI_TRUST_PROXY: '', CRON_SECRET: '',
  };
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  try {
    const { default: app } = await import('../api/index.js');
    expect(app.get('trust proxy')).toBe(1);
    await request(app).get('/api/account').set('X-Forwarded-For', '203.0.113.1')
      .expect(200, { available: [], account: null });
    await request(app).post('/api/session').type('json').send({}).expect(403);
    await request(app).post('/api/session').set('X-Nanti-Request', '1').type('form').send({}).expect(403);
  } finally {
    vi.unstubAllEnvs();
  }
});

it('rejects insecure TLS flags for the Vercel pool before making a connection', () => {
  const url = 'mysql://fixture:unused@unreachable.invalid:4000/nanti';
  for (const query of ['ssl=false', 'sslaccept=accept_invalid_certs']) {
    expect(() => connectDatabase(`${url}?${query}`, { serverlessPoolLimit: 3 })).toThrow('certificate-verified TLS');
  }
  expect(() => connectDatabase(url, { serverlessPoolLimit: 3, caBase64: 'not-a-cert' }))
    .toThrow('DATABASE_CA_CERT_BASE64');
});

it('requires the scheduler credential before triggering retention and keeps guest cookies secure', async () => {
  const prune = vi.fn().mockResolvedValue(undefined);
  const secret = 'fixture-scheduler-secret';
  const app = createApp({
    repository: { list: vi.fn().mockResolvedValue([]), find: vi.fn(), create: vi.fn(), rename: vi.fn(),
      remove: vi.fn(), addItem: vi.fn(), updateItem: vi.fn(), removeItem: vi.fn() },
    preview: async () => null, secret: 'startup-test-fixture', secureCookies: true,
    retention: { secret, prune },
  });
  await request(app).head('/api/maintenance/retention').set('Authorization', `Bearer ${secret}`).expect(405);
  await request(app).get('/api/maintenance/retention').expect(401);
  expect(prune).not.toHaveBeenCalled();
  await request(app).get('/api/maintenance/retention').set('Authorization', `Bearer ${secret}`)
    .expect('Cache-Control', 'no-store').expect(204);
  expect(prune).toHaveBeenCalledOnce();
  await request(app).post('/api/session').set('X-Nanti-Request', '1').send({})
    .expect('Set-Cookie', /^__Host-nanti=.*; Path=\/; .*HttpOnly; Secure; SameSite=Strict/u).expect(200);
});

it('rejects an invalid credential-bearing database URL without exposing it', () => {
  const canary = 'fixture-password-canary';
  const url = 'mysql://fixture:' + canary + '@[invalid/nanti_test';
  let failure: unknown;
  try { connectDatabase(url); } catch (error) { failure = error; }
  expect(failure instanceof Error).toBe(true);
  expect((failure as Error).message.includes('DATABASE_URL')).toBe(true);
  expect(JSON.stringify(failure).includes(canary)).toBe(false);
  expect((failure as Error).stack?.includes(canary)).toBe(false);
  expect((failure as Error).cause).toBeUndefined();
});
