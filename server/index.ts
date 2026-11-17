import { fileURLToPath } from 'node:url';
import { connectDatabase } from './database.js';
import { z } from 'zod';
import { createApp } from './app.js';
import { prismaWishlists } from './prisma-wishlists.js';
import { prismaIntelligence } from './prisma-intelligence.js';
import { assessmentRetentionDays } from './intelligence.js';
import { previewProduct } from './product-preview.js';
import { adminHashPattern, adminUsernamePattern } from './admin-credentials.js';
import { prismaAffiliate } from './prisma-affiliate.js';

const config = z.object({
  DATABASE_URL: z.string().startsWith('mysql://'),
  SESSION_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NANTI_ADMIN_USERNAME: z.string().regex(adminUsernamePattern).or(z.literal('')).default(''),
  NANTI_ADMIN_PASSWORD_HASH: z.string().regex(adminHashPattern).or(z.literal('')).default(''),
}).refine((value) => Boolean(value.NANTI_ADMIN_USERNAME) === Boolean(value.NANTI_ADMIN_PASSWORD_HASH), {
  path: ['NANTI_ADMIN_PASSWORD_HASH'], message: 'Set both administrator variables or leave both empty.',
}).safeParse(process.env);

if (!config.success) {
  console.error('Invalid configuration:', config.error.issues.map((issue) => issue.path.join('.')).join(', '));
  process.exit(1);
}

const env = config.data;
const db = connectDatabase(env.DATABASE_URL);
try {
  await db.$connect();
} catch {
  console.error('Could not connect to the configured database.');
  process.exit(1);
}

const intelligence = prismaIntelligence(db);
const prune = () => intelligence.prune(new Date(Date.now() - assessmentRetentionDays * 86_400_000))
  .catch(() => console.error('Could not clear expired assessment data.'));
void prune();
const retentionTimer = setInterval(() => void prune(), 86_400_000);
retentionTimer.unref();

const server = createApp({
  repository: prismaWishlists(db),
  intelligence,
  affiliate: prismaAffiliate(db),
  admin: env.NANTI_ADMIN_USERNAME && env.NANTI_ADMIN_PASSWORD_HASH ? {
    username: env.NANTI_ADMIN_USERNAME, passwordHash: env.NANTI_ADMIN_PASSWORD_HASH,
  } : undefined,
  preview: previewProduct,
  secret: env.SESSION_SECRET,
  secureCookies: env.NODE_ENV === 'production',
  webRoot: fileURLToPath(new URL('../web/', import.meta.url)),
}).listen(env.PORT, env.HOST, () => {
  console.log(`Nanti listening on ${env.HOST}:${env.PORT}`);
});

server.on('error', () => {
  console.error('Could not start the HTTP server.');
  void db.$disconnect().finally(() => process.exit(1));
});

server.requestTimeout = 15_000;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(retentionTimer);
    server.close(() => void db.$disconnect());
  });
}
