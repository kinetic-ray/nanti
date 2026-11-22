import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { Prisma } from './generated/prisma/client.js';
import type { AccountTokenKind, PrismaClient, UserSession } from './generated/prisma/client.js';

const pattern = /^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{64})$/u;
const dummy = 'scrypt-v1:' + '0'.repeat(32) + ':' + '0'.repeat(64);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, options, (error, hash) => error ? reject(error) : resolve(hash));
  });
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt-v1:${salt.toString('hex')}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string | null) {
  const [, salt, expected] = pattern.exec(stored ?? '') ?? pattern.exec(dummy)!;
  const hash = await derive(password, Buffer.from(salt!, 'hex'));
  return timingSafeEqual(hash, Buffer.from(expected!, 'hex')) && Boolean(stored && pattern.test(stored));
}

type Transaction = Prisma.TransactionClient;
export function passwordAccounts(db: PrismaClient, session: (tx: Transaction, id: string, guest: string | null) => Promise<string>,
  randomToken: () => string, hashToken: (raw: string) => string) {
  async function locked(tx: Transaction, userId: string) {
    await tx.$queryRaw`SELECT userId FROM PasswordCredential WHERE userId = ${userId} FOR UPDATE`;
    return tx.passwordCredential.findUnique({ where: { userId } });
  }
  async function rotate(tx: Transaction, userId: string, passwordHash: string, verifiedAt?: Date) {
    await tx.passwordCredential.update({ where: { userId }, data: { passwordHash, verifiedAt } });
    await tx.accountToken.deleteMany({ where: { userId } });
    await tx.userSession.deleteMany({ where: { userId } });
  }
  return {
    async register(email: string, password: string) {
      const passwordHash = await hashPassword(password);
      try {
        const id = randomUUID();
        await db.user.create({ data: { id, dataOwners: { create: { id } },
          password: { create: { email, passwordHash } } } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    },
    async login(email: string, password: string, guest: string | null) {
      const credential = await db.passwordCredential.findUnique({ where: { email } });
      if (!await verifyPassword(password, credential?.passwordHash ?? null) || !credential?.verifiedAt) return null;
      return db.$transaction(async tx => {
        const current = await locked(tx, credential.userId);
        if (current?.passwordHash !== credential.passwordHash || current.email !== email || !current.verifiedAt) return null;
        return session(tx, credential.userId, guest);
      });
    },
    async issue(email: string, kind: Exclude<AccountTokenKind, 'changeEmail'>) {
      const credential = await db.passwordCredential.findUnique({ where: { email }, select: { userId: true } });
      if (!credential) return null;
      return db.$transaction(async tx => {
        const current = await locked(tx, credential.userId);
        if (!current || current.email !== email || (kind === 'verify' && current.verifiedAt)) return null;
        const key = { userId: credential.userId, kind };
        const prior = await tx.accountToken.findUnique({ where: { userId_kind: key } });
        const duration = kind === 'verify' ? 30 * 60_000 : 15 * 60_000;
        if (prior && prior.expiresAt.getTime() - Date.now() > duration - 60_000) return null;
        const raw = randomToken();
        const data = { tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + duration) };
        await tx.accountToken.upsert({ where: { userId_kind: key }, create: { ...key, ...data }, update: data });
        return raw;
      });
    },
    async consume(raw: string, kind: Exclude<AccountTokenKind, 'changeEmail'>, password: string) {
      const key = { tokenHash: hashToken(raw), kind };
      const candidate = await db.accountToken.findFirst({ where: { ...key, expiresAt: { gt: new Date() } } });
      if (!candidate) return false;
      const previous = kind === 'verify' ? await db.passwordCredential.findUnique({ where: { userId: candidate.userId } }) : null;
      if (kind === 'verify' && !await verifyPassword(password, previous?.passwordHash ?? null)) return false;
      const passwordHash = kind === 'reset' ? await hashPassword(password) : null;
      return db.$transaction(async tx => {
        const credential = await locked(tx, candidate.userId);
        if (!credential || (kind === 'verify' && credential.passwordHash !== previous?.passwordHash)) return false;
        const used = await tx.accountToken.deleteMany({ where: { ...key, expiresAt: { gt: new Date() } } });
        if (!used.count) return false;
        if (passwordHash) await rotate(tx, candidate.userId, passwordHash, credential.verifiedAt ?? new Date());
        else await tx.passwordCredential.update({ where: { userId: candidate.userId }, data: { verifiedAt: new Date() } });
        return { email: credential.email };
      });
    },
    async requestEmailChange(session: UserSession, email: string, password: string) {
      const previous = await db.passwordCredential.findUnique({ where: { userId: session.userId } });
      if (!await verifyPassword(password, previous?.passwordHash ?? null) || !previous?.verifiedAt) return null;
      return db.$transaction(async tx => {
        const current = await locked(tx, session.userId);
        if (!current?.verifiedAt || current.passwordHash !== previous.passwordHash || !await tx.userSession.findFirst({
          where: { tokenHash: session.tokenHash, userId: session.userId, expiresAt: { gt: new Date() } },
        })) return null;
        const key = { userId: session.userId, kind: 'changeEmail' as const };
        const prior = await tx.accountToken.findUnique({ where: { userId_kind: key } });
        if (email === current.email || prior && prior.expiresAt.getTime() > Date.now() + 29 * 60_000) return { raw: null };
        const raw = randomToken();
        const data = { tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 30 * 60_000), pendingEmail: email };
        await tx.accountToken.upsert({ where: { userId_kind: key }, create: { ...key, ...data }, update: data });
        return { raw };
      });
    },
    async confirmEmailChange(raw: string) {
      const key = { tokenHash: hashToken(raw), kind: 'changeEmail' as const };
      const candidate = await db.accountToken.findFirst({ where: { ...key, expiresAt: { gt: new Date() } } });
      if (!candidate?.pendingEmail) return null;
      const email = candidate.pendingEmail;
      try {
        return await db.$transaction(async tx => {
          const credential = await locked(tx, candidate.userId);
          if (!credential?.verifiedAt) return null;
          const used = await tx.accountToken.deleteMany({ where: { ...key, expiresAt: { gt: new Date() } } });
          if (!used.count) return null;
          await tx.passwordCredential.update({ where: { userId: candidate.userId }, data: { email, verifiedAt: new Date() } });
          await tx.accountToken.deleteMany({ where: { userId: candidate.userId } });
          await tx.userSession.deleteMany({ where: { userId: candidate.userId } });
          return credential.email;
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
        throw error;
      }
    },
    async change(current: UserSession, password: string, replacement: string) {
      const credential = await db.passwordCredential.findUnique({ where: { userId: current.userId } });
      if (!await verifyPassword(password, credential?.passwordHash ?? null) || !credential?.verifiedAt) return false;
      const next = await hashPassword(replacement);
      return db.$transaction(async tx => {
        const active = await locked(tx, current.userId);
        if (active?.passwordHash !== credential.passwordHash || !await tx.userSession.findFirst({
          where: { tokenHash: current.tokenHash, userId: current.userId, expiresAt: { gt: new Date() } },
        })) return false;
        await rotate(tx, current.userId, next);
        return { email: active.email };
      });
    },
  };
}
