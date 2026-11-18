import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createRuntime } from './runtime.js';

const listener = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
}).safeParse(process.env);

if (!listener.success) {
  console.error('Invalid listener configuration:', listener.error.issues.map(({ path }) => path.join('.')).join(', '));
  process.exit(1);
}

const { HOST, PORT } = listener.data;
const { app, db, checkDatabase, prune } = await createRuntime(process.env, {
  webRoot: fileURLToPath(new URL('../web/', import.meta.url)),
}).catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});

try {
  await db.$connect();
  await checkDatabase();
} catch {
  console.error('The Nanti database is not ready. Check DATABASE_URL and the database schema.');
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
}

const cleanup = () => { void prune().catch(() => undefined); };
cleanup();
const retentionTimer = setInterval(cleanup, 86_400_000);
retentionTimer.unref();

const server = app.listen(PORT, HOST, () => {
  console.log(`Nanti listening on ${HOST}:${PORT}`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? `API port ${PORT} is already in use. Stop the other API or set PORT.` :
    'Could not start the HTTP server. Check HOST and PORT.');
  void db.$disconnect().finally(() => process.exit(1));
});

server.requestTimeout = 15_000;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(retentionTimer);
    server.close(() => void db.$disconnect());
  });
}
