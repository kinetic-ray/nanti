import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const directory = new URL('../', import.meta.url);
const apiPort = Number(process.env.PORT ?? 3000);
const webPort = Number(process.env.NANTI_DEV_WEB_PORT ?? 5173);
const host = process.env.HOST || '127.0.0.1';
if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  console.error('Set DATABASE_URL and SESSION_SECRET in .env. Start MySQL and run npm run db:migrate before starting Nanti.');
  process.exit(1);
}
if ([apiPort, webPort].some(port => !Number.isInteger(port) || port < 1 || port > 65535) || apiPort === webPort) {
  console.error('Set PORT and NANTI_DEV_WEB_PORT to two different valid ports.');
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '0.0.0.0'].includes(host)) {
  console.error('Use HOST=127.0.0.1 for local development.');
  process.exit(1);
}

const children = new Set();
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}

function start(name, args, extraEnv = {}) {
  const child = spawn(process.execPath, args, {
    cwd: directory, env: { ...process.env, ...extraEnv }, stdio: 'inherit',
  });
  children.add(child);
  child.on('error', () => {
    console.error(`Could not launch ${name}.`);
    stop(1);
  });
  child.on('exit', code => {
    children.delete(child);
    if (!stopping) {
      console.error(`${name} stopped. Check the preceding message before restarting development.`);
      stop(code || 1);
    }
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
const apiOrigin = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${apiPort}`;
start('Nanti API', ['--import', 'tsx', 'server/index.ts']);
const deadline = Date.now() + 20_000;
while (!stopping && Date.now() < deadline) {
  const response = await fetch(apiOrigin + '/api/health', { signal: AbortSignal.timeout(600) }).catch(() => null);
  if (response?.ok && (await response.json().catch(() => null))?.service === 'nanti') {
    if (!stopping) start('Vite', ['node_modules/vite/bin/vite.js', '--port', String(webPort), '--strictPort'], {
      NANTI_DEV_API_ORIGIN: apiOrigin,
    });
    break;
  }
  await delay(200);
}
if (!stopping && Date.now() >= deadline && children.size === 1) {
  console.error('The API did not become ready. Check MySQL, DATABASE_URL, migrations and the configured port.');
  stop(1);
}
