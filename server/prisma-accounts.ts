import { passwordAccounts } from './password-accounts.js';
import { prismaCreatorCatalog } from './prisma-creator-catalog.js';
import { notifyNewRegisteredUser } from './admin-notifications.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from './generated/prisma/client.js';
import type { AuthProvider, OAuthAttempt, PrismaClient, UserSession } from './generated/prisma/client.js';

export const sessionDuration = 30 * 86_400_000;
const verificationDuration = 10 * 60_000;

export const authToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const recentSession = (session: UserSession) => Date.now() - session.verifiedAt.getTime() < verificationDuration;

export function authorizedOwner(ownerId: string): Prisma.DataOwnerWhereInput {
  return { OR: [{ id: ownerId, userId: null }, { userId: ownerId }] };
}

export async function lockOwner(tx: Prisma.TransactionClient, id: string, actor: string) {
  const matches = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM DataOwner
    WHERE id = ${id} AND (userId = ${actor} OR (userId IS NULL AND id = ${actor}))
    FOR UPDATE
  `;
  return matches.length === 1;
}

export async function prepareOwner(tx: Prisma.TransactionClient, id: string, guest: boolean) {
  if (guest) await tx.dataOwner.createMany({ data: { id }, skipDuplicates: true });
  if (!await lockOwner(tx, id, id)) throw Object.assign(new Error('Session owner is unavailable'), { status: 401 });
}

function uniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function prismaAccounts(db: PrismaClient) {
  const identityKey = (provider: AuthProvider, subject: string) => ({ provider, subjectHash: tokenHash(subject) });

  async function newSession(tx: Prisma.TransactionClient, userId: string, guestOwnerId: string | null, provider?: AuthProvider) {
    const token = authToken();
    await tx.userSession.create({
      data: { tokenHash: tokenHash(token), userId, pendingGuestOwnerId: guestOwnerId,
        verifiedAt: new Date(), expiresAt: new Date(Date.now() + sessionDuration) },
    });
    await tx.authActivity.create({ data: { userId, kind: 'signed_in', provider } });
    return token;
  }

  return {
    creatorCatalog: prismaCreatorCatalog(db),
passwords: passwordAccounts(db, newSession, authToken, tokenHash),
    creator(userId: string) {
      return db.user.findUnique({ where: { id: userId }, select: {
        creatorProfile: { select: { id: true, name: true } }, creatorOnboarding: { select: { continuedAt: true } },
      } });
    },
    async creatorDesign(userId: string) {
      return db.creatorProfile.findUnique({ where: { userId }, select: { page: { select: { design: true } } } });
    },
    async saveCreatorDesign(userId: string, design: Prisma.InputJsonValue) {
      return db.$transaction(async tx => {
        const profile = await tx.creatorProfile.findUnique({ where: { userId }, select: { id: true } });
        if (!profile) return false;
        await tx.creatorPage.createMany({ data: { profileId: profile.id, design }, skipDuplicates: true });
        await tx.creatorPage.update({ where: { profileId: profile.id }, data: { design } });
        return true;
      });
    },
    async continueCreator(userId: string) {
      await db.creatorOnboarding.createMany({ data: { userId }, skipDuplicates: true });
    },
    async setupCreator(userId: string, name: string) {
      return db.$transaction(async tx => {
        if (!await tx.creatorOnboarding.findUnique({ where: { userId } })) return null;
        await tx.creatorProfile.createMany({ data: { userId, name }, skipDuplicates: true });
        return tx.creatorProfile.findUnique({ where: { userId }, select: { id: true, name: true } });
      });
    },
    async guest(id: string) {
      const owner = await db.dataOwner.findUnique({ where: { id }, select: { userId: true } });
      return !owner?.userId;
    },
    session(hash: string) {
      return db.userSession.findFirst({ where: { tokenHash: hash, expiresAt: { gt: new Date() } } });
    },
    attempt(data: Prisma.OAuthAttemptUncheckedCreateInput) {
      return db.oAuthAttempt.create({ data });
    },
    consumeAttempt(state: string, browser: string, provider: AuthProvider) {
      const where = { stateHash: tokenHash(state), browserHash: tokenHash(browser), provider, expiresAt: { gt: new Date() } };
      return db.$transaction(async (tx) => {
        const attempt = await tx.oAuthAttempt.findFirst({ where });
        if (!attempt || (await tx.oAuthAttempt.deleteMany({ where })).count !== 1) return null;
        return attempt;
      });
    },
    async signin(provider: AuthProvider, subject: string, displayName: string | null, guestOwnerId: string | null,
      verifiedEmail?: string | null, avatarUrl?: string | null) {
      const key = identityKey(provider, subject);
      try {
        return await db.$transaction(async (tx) => {
          const identity = await tx.authIdentity.findUnique({ where: { provider_subjectHash: key } });
          if (identity) {
            if ((verifiedEmail !== undefined && identity.verifiedEmail !== verifiedEmail) ||
                (avatarUrl !== undefined && identity.avatarUrl !== avatarUrl)) {
              await tx.authIdentity.update({ where: { provider_subjectHash: key }, data: { verifiedEmail, avatarUrl } });
            }
            return newSession(tx, identity.userId, guestOwnerId, provider);
          }
          const id = randomUUID();
          await tx.user.create({ data: { id, displayName, dataOwners: { create: { id } },
            identities: { create: { ...key, verifiedEmail, avatarUrl } } } });
          await notifyNewRegisteredUser(tx, id);
          return newSession(tx, id, guestOwnerId, provider);
        });
      } catch (error) {
        if (!uniqueConflict(error)) throw error;
        const identity = await db.authIdentity.findUnique({ where: { provider_subjectHash: key } });
        if (!identity) throw error;
        return db.$transaction(tx => newSession(tx, identity.userId, guestOwnerId, provider));
      }
    },
    async confirmIdentity(attempt: OAuthAttempt, subject: string, avatarUrl?: string | null) {
      if (!attempt.sessionHash) return false;
      const key = identityKey(attempt.provider, subject);
      try {
        return await db.$transaction(async (tx) => {
          // Serializes verification and linking with logout and deletion.
          const rows = await tx.$queryRaw<UserSession[]>`
            SELECT * FROM UserSession WHERE tokenHash = ${attempt.sessionHash} AND expiresAt > ${new Date()} FOR UPDATE
          `;
          const session = rows[0];
          if (!session) return false;
          if (attempt.purpose === 'verify') {
            const identity = await tx.authIdentity.findUnique({ where: { provider_subjectHash: key } });
            if (identity?.userId !== session.userId) return false;
            if (avatarUrl !== undefined && identity.avatarUrl !== avatarUrl) {
              await tx.authIdentity.update({ where: { provider_subjectHash: key }, data: { avatarUrl } });
            }
            await tx.userSession.update({ where: { tokenHash: session.tokenHash }, data: { verifiedAt: new Date() } });
          } else {
            if (!recentSession(session)) return false;
            await tx.authIdentity.create({ data: { ...key, userId: session.userId, avatarUrl } });
          }
          return true;
        });
      } catch (error) {
        if (uniqueConflict(error)) return false;
        throw error;
      }
    },
    async logout(hash: string) {
      await db.$transaction(async tx => {
        const current = await tx.userSession.findUnique({ where: { tokenHash: hash }, select: { userId: true } });
        if (current && (await tx.userSession.deleteMany({ where: { tokenHash: hash } })).count === 1) {
          await tx.authActivity.create({ data: { userId: current.userId, kind: 'signed_out' } });
        }
      });
    },
    async sessions(session: UserSession) {
      const records = await db.userSession.findMany({ where: { userId: session.userId, expiresAt: { gt: new Date() } },
        orderBy: [{ expiresAt: 'desc' }, { tokenHash: 'asc' }], take: 50,
        select: { tokenHash: true, expiresAt: true } });
      return records.map(record => ({ id: tokenHash(record.tokenHash), expiresAt: record.expiresAt.toISOString(),
        current: record.tokenHash === session.tokenHash }));
    },
    async revokeSession(session: UserSession, id: string) {
      return db.$executeRaw`DELETE FROM UserSession
        WHERE userId = ${session.userId} AND tokenHash <> ${session.tokenHash} AND SHA2(tokenHash, 256) = ${id}`;
    },
    async revokeAllSessions(session: UserSession) {
      return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM User WHERE id = ${session.userId} FOR UPDATE`;
        const active = await tx.userSession.deleteMany({ where: {
          tokenHash: session.tokenHash, userId: session.userId, expiresAt: { gt: new Date() },
        } });
        if (!active.count) return false;
        await tx.userSession.deleteMany({ where: { userId: session.userId } });
        await tx.authActivity.create({ data: { userId: session.userId, kind: 'signed_out' } });
        return true;
      });
    },
    async adminProfile(hash: string) {
      const current = await db.userSession.findFirst({
        where: { tokenHash: hash, expiresAt: { gt: new Date() }, user: { role: 'admin' } },
        select: { user: { select: { id: true, displayName: true, role: true, identities: { select: { provider: true } } } } },
      });
      return current?.user ?? null;
    },
    async adminDashboard(profile: { id: string; displayName: string | null; role: 'member' | 'admin';
      identities: { provider: AuthProvider }[] }) {
      const [users, activity] = await Promise.all([
        db.user.findMany({
          take: 50, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, displayName: true, role: true, createdAt: true },
        }),
        db.authActivity.findMany({
          take: 50, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, userId: true, kind: true, provider: true, createdAt: true },
        }),
      ]);
      return { profile, users, activity };
    },
    account(id: string) {
      return db.user.findUnique({ where: { id }, select: {
        displayName: true,
        creatorProfile: { select: { id: true } },
        password: { select: { email: true, verifiedAt: true } },
        identities: { select: { provider: true, verifiedEmail: true, avatarUrl: true }, orderBy: { provider: 'asc' } },
      } });
    },
    async rename(id: string, displayName: string | null) {
      await db.user.updateMany({ where: { id }, data: { displayName } });
    },
    async deleteAccount(session: UserSession) {
      return db.$transaction(async (tx) => {
        const active = await tx.userSession.findFirst({ where: {
          tokenHash: session.tokenHash, userId: session.userId, expiresAt: { gt: new Date() },
          verifiedAt: { gt: new Date(Date.now() - verificationDuration) },
        } });
        if (!active) return false;
        return (await tx.user.deleteMany({ where: { id: active.userId } })).count === 1;
      });
    },
    async importSummary(userId: string, guestId: string) {
      const guest = await db.dataOwner.findFirst({ where: { id: guestId, userId: null },
        select: { _count: { select: { wishlists: true } }, preference: { select: { ownerId: true, coolingOffDays: true } } } });
      if (!guest || !guest._count.wishlists && !guest.preference) return null;
      return { guestLists: guest._count.wishlists, accountLists: await db.wishlist.count({
        where: { dataOwner: { userId } },
      }), guestPreference: guest.preference?.coolingOffDays != null };
    },
    importGuest(session: UserSession, guestId: string) {
      return db.$transaction(async (tx) => {
        const { userId } = session;
        // The primary owner lock also serializes imports from different browsers.
        if (!await lockOwner(tx, userId, userId)) return false;
        const active = await tx.userSession.findFirst({ where: {
          tokenHash: session.tokenHash, userId, pendingGuestOwnerId: guestId, expiresAt: { gt: new Date() },
        }, select: { userId: true } });
        if (!active) return false;
        const claimed = await tx.dataOwner.updateMany({ where: { id: guestId, userId: null }, data: { userId } });
        if (!claimed.count) return Boolean(await tx.dataOwner.findFirst({ where: { id: guestId, userId } }));
        const guestPreference = await tx.intelligencePreference.findUnique({ where: { ownerId: guestId } });
        if (guestPreference) {
          const accountPreference = await tx.intelligencePreference.findUnique({ where: { ownerId: userId } });
          const contexts = {
            ...preferenceContexts(guestPreference.financialContexts),
            ...preferenceContexts(accountPreference?.financialContexts ?? null),
          };
          const financialContexts = Object.keys(contexts).length ? contexts : Prisma.DbNull;
          const coolingOffDays = accountPreference?.coolingOffDays ?? guestPreference.coolingOffDays;
          const updatedAt = accountPreference && accountPreference.updatedAt > guestPreference.updatedAt
            ? accountPreference.updatedAt : guestPreference.updatedAt;
          if (coolingOffDays !== null || Object.keys(contexts).length) {
            await tx.intelligencePreference.upsert({
              where: { ownerId: userId },
              create: { ownerId: userId, coolingOffDays, financialContexts, updatedAt },
              update: { coolingOffDays, financialContexts, updatedAt },
            });
          }
          await tx.intelligencePreference.delete({ where: { ownerId: guestId } });
        }
        return true;
      });
    },
    async prune() {
      const now = new Date();
      await db.$transaction([
        db.authActivity.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } } }),
        db.accountToken.deleteMany({ where: { expiresAt: { lte: now } } }),
        db.oAuthAttempt.deleteMany({ where: { expiresAt: { lte: now } } }),
        db.userSession.deleteMany({ where: { expiresAt: { lte: now } } }),
      ]);
      // Old signed cookies may recreate empty guest namespaces on their next visit.
      await db.$executeRaw`
        DELETE FROM DataOwner WHERE userId IS NULL
        AND NOT EXISTS (SELECT 1 FROM Wishlist WHERE Wishlist.ownerId = DataOwner.id)
        AND NOT EXISTS (SELECT 1 FROM IntelligencePreference WHERE IntelligencePreference.ownerId = DataOwner.id)
      `;
    },
  };
}

export type Accounts = ReturnType<typeof prismaAccounts>;

function preferenceContexts(value: Prisma.JsonValue | null): Prisma.JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Prisma.JsonObject : {};
}
