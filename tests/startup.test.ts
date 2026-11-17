import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createServer as createVite } from 'vite';
import { expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';

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
    .expect({ code: 'database_unavailable', error: 'The database is unavailable. Try again shortly.' });
});
