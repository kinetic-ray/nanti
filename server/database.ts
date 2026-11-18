import { isIP } from 'node:net';
import { createSecureContext } from 'node:tls';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { attachDatabasePool } from '@vercel/functions';
import { createPool } from 'mariadb';
import { PrismaClient } from './generated/prisma/client.js';

type DatabaseOptions = { caBase64?: string; serverlessPoolLimit?: number };
const idleSeconds = 5;

export function connectDatabase(url: string, options: DatabaseOptions = {}) {
  const parsed = new URL(url);
  const { caBase64, serverlessPoolLimit } = options;
  const strictTls = serverlessPoolLimit !== undefined || Boolean(caBase64) || parsed.searchParams.get('sslaccept') === 'strict';
  if (!strictTls) return new PrismaClient({ adapter: new PrismaMariaDb(url) });

  const tlsMode = parsed.searchParams.get('sslaccept');
  const ssl = parsed.searchParams.get('ssl');
  if ((tlsMode && tlsMode !== 'strict') || (ssl && ssl !== 'true')) {
    throw new Error('Set DATABASE_URL to use certificate-verified TLS.');
  }
  const host = parsed.hostname.replace(/^\[|\]$/gu, '');
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (!host || !database || !parsed.username) {
    throw new Error('DATABASE_URL must specify a database hostname, schema, and username.');
  }
  const ca = caBase64 ? Buffer.from(caBase64, 'base64').toString('utf8') : undefined;
  if (ca) {
    if (!ca.includes('-----BEGIN CERTIFICATE-----')) {
      throw new Error('DATABASE_CA_CERT_BASE64 must encode a PEM CA certificate.');
    }
    createSecureContext({ ca });
  } else if (caBase64) {
    throw new Error('DATABASE_CA_CERT_BASE64 must encode a PEM CA certificate.');
  }
  const config = {
    host, port: Number(parsed.port || 3306), database,
    user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password),
    ssl: { rejectUnauthorized: true, minVersion: 'TLSv1.2' as const, ...(isIP(host) === 0 && { servername: host }), ca },
  };
  if (serverlessPoolLimit === undefined) return new PrismaClient({ adapter: new PrismaMariaDb(config, { database }) });

  const pool = createPool({
    ...config, prepareCacheLength: 0, connectionLimit: serverlessPoolLimit, minimumIdle: 0,
    idleTimeout: idleSeconds, connectTimeout: 5_000, acquireTimeout: 10_000,
  });
  // MariaDB's promise pool exposes the release event but keeps its config private.
  // Its idle timeout is in seconds and the connector checks it every 500ms.
  attachDatabasePool({ config: { idleTimeout: idleSeconds * 1000 + 500 }, on: pool.on.bind(pool) });
  return new PrismaClient({ adapter: new PrismaMariaDb(pool, { database }) });
}
