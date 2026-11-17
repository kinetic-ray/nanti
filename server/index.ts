import { fileURLToPath } from 'node:url';
import { connectDatabase } from './database.js';
import { z } from 'zod';
import { createApp } from './app.js';
import { prismaWishlists } from './prisma-wishlists.js';
import { prismaIntelligence } from './prisma-intelligence.js';
import { previewProduct } from './product-preview.js';

const config = z.object({
  DATABASE_URL: z.string().startsWith('mysql://'),
  SESSION_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
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

const server = createApp({
  repository: prismaWishlists(db),
  intelligence: prismaIntelligence(db),
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
    server.close(() => void db.$disconnect());
  });
}
