import express from 'express';
import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { adminWorkspaceRoutes } from '../server/admin-workspace-routes.js';
import type { PrismaClient } from '../server/generated/prisma/client.js';

afterEach(() => vi.unstubAllEnvs());

it('returns only non-secret platform configuration status', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DATABASE_URL', 'mysql://private-user:private-password@example.test/private-db');
  vi.stubEnv('NANTI_ADMIN_USERNAME', 'private-admin');
  vi.stubEnv('NANTI_ADMIN_PASSWORD_HASH', 'private-password-hash');
  vi.stubEnv('NANTI_RECOMMENDATION_SUPERADMIN_USERNAME', 'private-admin');
  vi.stubEnv('AUTH_PUBLIC_ORIGIN', 'https://nanti.test');
  vi.stubEnv('AUTH_GOOGLE_CLIENT_ID', 'private-google-client');
  vi.stubEnv('AUTH_GOOGLE_CLIENT_SECRET', 'private-google-secret');
  vi.stubEnv('NANTI_ACCOUNT_MAIL_API_KEY', 'private-mail-key');
  vi.stubEnv('NANTI_ACCOUNT_MAIL_FROM', 'private-sender@example.test');

  const app = express();
  app.use('/api/admin/workspace', adminWorkspaceRoutes({} as PrismaClient, 'admin'));
  const response = await request(app).get('/api/admin/workspace/settings/status').expect(200);

  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toEqual({
    environment: 'production',
    checks: {
      databaseConfigured: true,
      administratorLoginConfigured: true,
      googleSignInConfigured: true,
      appleSignInConfigured: false,
      accountRecoveryConfigured: true,
      imageStorageConfigured: true,
      recommendationManagementEnabled: true,
    },
  });
  for (const secret of ['private-password', 'private-google-secret', 'private-mail-key', 'private-user']) {
    expect(JSON.stringify(response.body)).not.toContain(secret);
  }
});
