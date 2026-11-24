import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import type {
  AdminNotice, AdminPage, AuditEvent, Mapping, MatchClassification, NoticeKind, Opportunity, OpportunityDetail, VerificationEvidence,
} from '../shared/affiliate.js';
import { classifyProductMatch, isEligibleAffiliate, normalizeProductTitle, productKey, safeAdminUrl } from './product-identity.js';

const pageSize = 25;
const mappingFields = {
  id: true, identityId: true, activeIdentityId: true, originalUrl: true, affiliateUrl: true, status: true,
  classification: true, evidence: true, approvedBy: true, approvedAt: true, validatedAt: true, createdAt: true, revision: true,
  identity: { select: { merchant: true } },
} as const;
const identityFields = {
  id: true, merchant: true, market: true, listingId: true, canonicalUrl: true, title: true, reviewedAt: true,
  _count: { select: { items: true } },
  activeMapping: { select: { id: true, classification: true, status: true, affiliateUrl: true, originalUrl: true } },
  mappings: { select: { classification: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
} satisfies Prisma.ProductIdentitySelect;
const auditFields = { id: true, mappingId: true, actor: true, action: true, details: true, createdAt: true,
  identity: { select: { merchant: true } } } as const;
const recent = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

export type ReviewAction =
  | { action: 'approve' | 'revalidate' | 'restore'; revision: number; evidence: VerificationEvidence }
  | { action: 'reject' | 'disable' | 'revoke' | 'invalid'; revision: number; reason: string };

export class AffiliateProblem extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) { super(message); }
}

function unavailable() { return new AffiliateProblem(404, 'This affiliate record could not be found.'); }
function conflict(message = 'This record changed. Reload it before making another decision.') {
  return new AffiliateProblem(409, message);
}

function paginate<T extends { id: string }, R>(rows: T[], map: (row: T) => R): AdminPage<R> {
  const batch = rows.slice(0, pageSize);
  return { records: batch.map(map), next: rows.length > pageSize ? batch.at(-1)!.id : null };
}

function windowAfter(after: string | undefined) {
  return { ...(after && { cursor: { id: after }, skip: 1 }), take: pageSize + 1, orderBy: [...recent] };
}

function candidateClassification(original: string, candidate: string): MatchClassification {
  const match = classifyProductMatch(original, candidate);
  return match === 'exact' ? 'potential' : match;
}

function catalogUrl(value: string, merchant: string) {
  if (merchant !== 'Other' && merchant !== 'Tokopedia') return value;
  const url = new URL(value);
  return merchant === 'Tokopedia' && url.hostname === 'www.tokopedia.com'
    ? url.origin + url.pathname
    : `${url.origin}/`;
}

function mappingView(row: Prisma.AffiliateMappingGetPayload<{ select: typeof mappingFields }>): Mapping {
  return {
    id: row.id, originalUrl: catalogUrl(row.originalUrl, row.identity.merchant), affiliateUrl: row.affiliateUrl, status: row.status,
    classification: row.classification, evidence: row.evidence as VerificationEvidence | null, approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null, validatedAt: row.validatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), active: row.activeIdentityId !== null,
    eligible: isEligibleAffiliate(row.originalUrl, row.affiliateUrl), revision: row.revision,
  };
}

function opportunityView(row: Prisma.ProductIdentityGetPayload<{ select: typeof identityFields }>): Opportunity {
  const active = row.activeMapping;
  const coverage = Boolean(active && active.status === 'approved' && active.classification === 'verified_exact' &&
    isEligibleAffiliate(row.canonicalUrl, active.affiliateUrl));
  return {
    id: row.id, merchant: row.merchant, market: row.market, listingId: row.listingId,
    canonicalUrl: catalogUrl(row.canonicalUrl, row.merchant),
    title: row.title, savedCount: row._count.items, coverage,
    classification: coverage ? 'verified_exact' : row.mappings[0]?.classification ?? 'insufficient',
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    submissionStatus: coverage ? 'affiliate_link_assigned' : row.reviewedAt ? 'reviewed' : 'pending',
  };
}

function auditView(row: Prisma.AffiliateAuditGetPayload<{ select: typeof auditFields }>): AuditEvent {
  const details = row.details as Record<string, unknown>;
  if (typeof details.originalUrl === 'string') {
    details.originalUrl = catalogUrl(details.originalUrl, row.identity.merchant);
  }
  return { ...row, details, createdAt: row.createdAt.toISOString() };
}

function evidenceConflicts(
  prior: { brand: string | null; model: string | null; sellerId: string | null; variants: Prisma.JsonValue },
  next: VerificationEvidence,
) {
  const variants = prior.variants as VerificationEvidence['variants'] | null;
  const pairs = [
    [prior.brand, next.brand], [prior.model, next.model], [prior.sellerId, next.sellerId],
    ...Object.entries(next.variants).map(([key, value]) => [variants?.[key as keyof typeof next.variants], value]),
  ];
  return pairs.some(([old, current]) => old && current && normalizeProductTitle(old) !== normalizeProductTitle(current));
}

async function notify(tx: Prisma.TransactionClient, identityId: string, kind: NoticeKind, eventKey: string) {
  await tx.adminNotification.createMany({ data: [{ identityId, kind, eventKey }], skipDuplicates: true });
}

export function prismaAffiliate(db: PrismaClient) {
  async function listMappings(identityId: string, after?: string) {
    return paginate(await db.affiliateMapping.findMany({
      ...windowAfter(after), where: { identityId }, select: mappingFields,
    }), mappingView);
  }

  async function listAudit(identityId: string, after?: string) {
    return paginate(await db.affiliateAudit.findMany({
      ...windowAfter(after), where: { identityId }, select: auditFields,
    }), auditView);
  }

  return {
    async listOpportunities(after?: string, filters: { q?: string; merchant?: string; reviewed?: boolean; active?: boolean } = {}) {
      const q = filters.q?.trim();
      const where: Prisma.ProductIdentityWhereInput = {
        AND: [
          { OR: [{ items: { some: {} } }, { mappings: { some: {} } }] },
          ...(q ? [{ OR: [{ title: { contains: q } }, { sellerId: { contains: q } }, { listingId: { contains: q } }] }] : []),
          ...(filters.merchant ? [{ merchant: filters.merchant }] : []),
          ...(filters.reviewed === undefined ? [] : [filters.reviewed ? { reviewedAt: { not: null } } : { reviewedAt: null }]),
          ...(filters.active === undefined ? [] : [filters.active ? { activeMapping: { is: { status: 'approved' as const } } } : { activeMapping: null }]),
        ],
      };
      const rows = await db.productIdentity.findMany({
        ...windowAfter(after), select: identityFields,
        where,
      });
      return paginate(rows, opportunityView);
    },
    async detail(id: string): Promise<OpportunityDetail | null> {
      const identity = await db.productIdentity.findUnique({ where: { id },
        select: { ...identityFields, normalizedTitle: true, brand: true, model: true, sellerId: true, variants: true },
      });
      if (!identity) return null;
      const [mappings, audit] = await Promise.all([listMappings(id), listAudit(id)]);
      const { normalizedTitle, brand, model, sellerId } = identity;
      return {
        ...opportunityView(identity), normalizedTitle, brand, model, sellerId,
        variants: identity.variants as VerificationEvidence['variants'] | null,
        mappings: mappings.records, audit: audit.records, nextMappings: mappings.next, nextAudit: audit.next,
      };
    },
    listMappings,
    listAudit,
    async addCandidate(identityId: string, candidate: URL, actor: string) {
      const affiliateUrl = candidate.href;
      const ordered = new URL(affiliateUrl);
      ordered.searchParams.sort();
      const candidateKey = productKey(ordered.href);
      const where = { identityId_candidateKey: { identityId, candidateKey } };
      try {
        return await db.$transaction(async (tx) => {
          const identity = await tx.productIdentity.findUnique({ where: { id: identityId }, select: { canonicalUrl: true } });
          if (!identity) throw unavailable();
          const existing = await tx.affiliateMapping.findUnique({ where, select: mappingFields });
          if (existing) return mappingView(existing);
          const originalUrl = identity.canonicalUrl;
          const classification = candidateClassification(originalUrl, affiliateUrl);
          const row = await tx.affiliateMapping.create({
            data: { identityId, originalUrl, affiliateUrl, candidateKey, classification }, select: mappingFields,
          });
          await tx.affiliateAudit.create({ data: { identityId, mappingId: row.id, actor, action: 'candidate_added',
            details: { affiliateUrl, classification } } });
          await notify(tx, identityId, 'candidate_review', `candidate:${row.id}`);
          return mappingView(row);
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await db.affiliateMapping.findUnique({ where, select: mappingFields });
          if (existing) return mappingView(existing);
        }
        throw error;
      }
    },
    async reviewMapping(identityId: string, mappingId: string, actor: string, review: ReviewAction) {
      try {
        return await db.$transaction(async (tx) => {
          const row = await tx.affiliateMapping.findFirst({
            where: { id: mappingId, identityId }, select: { ...mappingFields, identity: {
              select: { canonicalUrl: true, brand: true, model: true, sellerId: true, variants: true },
            } },
          });
          if (!row) throw unavailable();
          if (row.revision !== review.revision) throw conflict();
          const { action } = review;
          const now = new Date();
          const revision = row.revision + 1;
          let update: Prisma.AffiliateMappingUncheckedUpdateManyInput;
          let identityData: Prisma.ProductIdentityUpdateInput = { reviewedAt: now };
          let details: Prisma.InputJsonObject = { previousStatus: row.status, revision };

          if ('evidence' in review) {
            const allowed = action === 'approve' ? row.status === 'pending' :
              action === 'restore' ? row.status === 'disabled' || row.status === 'revoked' || row.status === 'invalid' :
              row.status === 'approved';
            if (!allowed) throw conflict('This mapping cannot be approved or validated in its current state.');
            const { evidence } = review;
            const eligible = isEligibleAffiliate(row.identity.canonicalUrl, row.affiliateUrl);
            const override = typeof evidence.overrideReason === 'string' && evidence.overrideReason.length >= 12 &&
              safeAdminUrl(row.identity.canonicalUrl)?.protocol === 'https:' && safeAdminUrl(row.affiliateUrl)?.protocol === 'https:';
            if (!eligible && !override) {
              throw new AffiliateProblem(400, 'Approval requires the same product, variant, market, and a direct attributed link.');
            }
            if (evidenceConflicts(row.identity, evidence)) throw conflict('The proposed evidence conflicts with verified product attributes.');
            update = {
              activeIdentityId: identityId, status: 'approved', classification: 'verified_exact', validatedAt: now,
              evidence,
              ...((action === 'approve' || action === 'restore') && { approvedBy: actor, approvedAt: now }),
            };
            details = { ...details, evidence, originalUrl: row.originalUrl, affiliateUrl: row.affiliateUrl, status: 'approved',
              ...(override && { override: true, overrideReason: evidence.overrideReason }) };
            identityData = {
              title: evidence.title, normalizedTitle: normalizeProductTitle(evidence.title).slice(0, 220),
              brand: evidence.brand, model: evidence.model, sellerId: evidence.sellerId,
              variants: { ...(row.identity.variants as VerificationEvidence['variants'] | null), ...evidence.variants }, reviewedAt: now,
            };
          } else {
            const allowed = action === 'reject' ? row.status === 'pending' :
              action === 'disable' ? row.status === 'approved' :
              row.status === 'approved' || row.status === 'disabled';
            if (!allowed) throw conflict('This action is unavailable for the current mapping status.');
            const status = { reject: 'rejected', disable: 'disabled', revoke: 'revoked', invalid: 'invalid' } as const;
            update = { activeIdentityId: null, status: status[review.action], ...(action === 'reject' || action === 'invalid'
              ? { validatedAt: now, classification: action === 'invalid' ? 'insufficient' :
                candidateClassification(row.originalUrl, row.affiliateUrl) } : {}) };
            details = { ...details, reason: review.reason, status: status[review.action] };
          }

          const updated = await tx.affiliateMapping.updateMany({ where: { id: mappingId, revision: row.revision },
            data: { ...update, revision },
          });
          if (!updated.count) throw conflict();
          await tx.productIdentity.update({ where: { id: identityId }, data: identityData });
          await tx.affiliateAudit.create({ data: { identityId, mappingId, actor, action, details } });
          if (action === 'approve' || action === 'reject') {
            await tx.adminNotification.updateMany({ where: { eventKey: `candidate:${mappingId}`, dismissedAt: null },
              data: { dismissedAt: now },
            });
          }
          if (action === 'revoke' || action === 'invalid') {
            await notify(tx, identityId, action === 'revoke' ? 'mapping_revoked' : 'mapping_invalid', `${action}:${mappingId}:${revision}`);
          }
          return mappingView(await tx.affiliateMapping.findUniqueOrThrow({ where: { id: mappingId }, select: mappingFields }));
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw conflict('An active mapping already covers this product. Disable or revoke it first.');
        }
        throw error;
      }
    },
    async activeDestination(lookupKey: string) {
      return db.productIdentity.findUnique({ where: { lookupKey }, select: {
        id: true, canonicalUrl: true, activeMapping: { select: {
          id: true, identityId: true, revision: true, affiliateUrl: true, originalUrl: true, classification: true,
          status: true, approvedAt: true, validatedAt: true, approvedBy: true, evidence: true,
        } },
      } });
    },
    async invalidateMapping(identityId: string, mappingId: string, revision: number) {
      await db.$transaction(async (tx) => {
        const now = new Date();
        const update = await tx.affiliateMapping.updateMany({
          where: { id: mappingId, identityId, activeIdentityId: identityId, revision },
          data: { status: 'invalid', classification: 'insufficient', activeIdentityId: null, validatedAt: now, revision: { increment: 1 } },
        });
        if (!update.count) return;
        await tx.productIdentity.update({ where: { id: identityId }, data: { reviewedAt: now } });
        await tx.affiliateAudit.create({ data: { identityId, mappingId, actor: 'system:resolver', action: 'invalid',
          details: { reason: 'The saved mapping no longer passes the current exact destination checks.', revision: revision + 1 } } });
        await notify(tx, identityId, 'mapping_invalid', `invalid:${mappingId}:${revision + 1}`);
      });
    },
    async notices(after?: string): Promise<AdminPage<AdminNotice> & { unread: number }> {
      const [rows, unread] = await Promise.all([
        db.adminNotification.findMany({ ...windowAfter(after), where: { dismissedAt: null },
          select: { id: true, identityId: true, kind: true, subject: true, targetPath: true, readAt: true, createdAt: true,
            identity: { select: { title: true, listingId: true } } } }),
        db.adminNotification.count({ where: { dismissedAt: null, readAt: null } }),
      ]);
      return { ...paginate(rows, (row) => ({
        id: row.id, identityId: row.identityId, kind: row.kind as NoticeKind,
        title: row.subject ?? row.identity?.title ?? null, listingId: row.identity?.listingId ?? null,
        targetPath: row.targetPath ?? (row.identityId ? `/admin?section=links#opportunity-${row.identityId}` : '/admin?section=notifications'),
        readAt: row.readAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
      })), unread };
    },
    async recordSystemFailure(code: string) {
      const safeCode = /^[A-Za-z0-9_]{2,32}$/u.test(code) ? code : 'unexpected';
      const hour = new Date().toISOString().slice(0, 13);
      await db.adminNotification.createMany({
        data: [{ eventKey: `failure:product-save:${safeCode}:${hour}`, kind: 'system_failure',
          subject: `Gangguan penyimpanan produk (${safeCode})`, targetPath: '/admin?section=settings' }],
        skipDuplicates: true,
      });
    },
    async updateNotice(id: string, action: 'read' | 'unread' | 'dismiss') {
      const now = new Date();
      return (await db.adminNotification.updateMany({
        where: { id, dismissedAt: null },
        data: action === 'dismiss' ? { dismissedAt: now } : { readAt: action === 'read' ? now : null },
      })).count > 0;
    },
    async markAllNoticesRead() {
      const now = new Date();
      return db.adminNotification.updateMany({ where: { dismissedAt: null, readAt: null }, data: { readAt: now } });
    },
    async addSession(tokenHash: string, credentialScope: string, expiresAt: Date, replaceHash: string | null) {
      await db.$transaction([
        db.adminSession.deleteMany({ where: { OR: [{ expiresAt: { lte: new Date() } },
          ...(replaceHash ? [{ tokenHash: replaceHash }] : [])] } }),
        db.adminSession.create({ data: { tokenHash, credentialScope, expiresAt } }),
      ]);
    },
    async hasSession(tokenHash: string, credentialScope: string) {
      return Boolean(await db.adminSession.findFirst({
        where: { tokenHash, credentialScope, expiresAt: { gt: new Date() } }, select: { tokenHash: true },
      }));
    },
    async removeSession(tokenHash: string, credentialScope: string) {
      await db.adminSession.deleteMany({ where: { tokenHash, credentialScope } });
    },
  };
}

export type AffiliateRepository = ReturnType<typeof prismaAffiliate>;
