import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
const work = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export const adminHashPattern = /^scrypt-v1:[0-9a-f]{32}:[0-9a-f]{64}$/u;
export const adminUsernamePattern = /^[a-zA-Z0-9._-]{3,64}$/u;
export const adminSessionMs = 8 * 60 * 60 * 1000;

export type AdminCredentials = { username: string; passwordHash: string };

function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, work, (error, hash) => error ? reject(error) : resolve(hash));
  });
}

export async function hashAdminPassword(password: string) {
  if (Array.from(password).length < 16 || Buffer.byteLength(password, 'utf8') > 256) {
    throw new RangeError('Use at least 16 characters and at most 256 UTF-8 bytes.');
  }
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt-v1:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyAdminPassword(credentials: AdminCredentials, username: string, password: string) {
  if (!adminHashPattern.test(credentials.passwordHash) || Buffer.byteLength(password, 'utf8') > 256) return false;
  const [, salt, expected] = credentials.passwordHash.split(':');
  const hash = await derive(password, Buffer.from(salt!, 'hex'));
  const userOk = timingSafeEqual(Buffer.from(digest(username), 'hex'), Buffer.from(digest(credentials.username), 'hex'));
  const passwordOk = timingSafeEqual(hash, Buffer.from(expected!, 'hex'));
  return userOk && passwordOk;
}

export function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function adminCredentialScope(credentials: AdminCredentials, secret: string) {
  return createHmac('sha256', secret).update(JSON.stringify(['nanti-admin-v1', credentials])).digest('hex');
}

export function newAdminSession() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: digest(token), expiresAt: new Date(Date.now() + adminSessionMs) };
}

export function adminTokenHash(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value) ? digest(value) : null;
}
