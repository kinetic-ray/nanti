import { Router } from 'express';
import type { PrismaClient } from './generated/prisma/client.js';
import { adminWorkspaceRoutes } from './admin-workspace-routes.js';
import { recommendationAdminRoutes } from './recommendation-admin-routes.js';
import type { CookieOptions, ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AdminCredentials } from './admin-credentials.js';
import { adminCredentialScope, adminSessionMs, adminTokenHash, newAdminSession, verifyAdminPassword } from './admin-credentials.js';
import { AffiliateProblem } from './prisma-affiliate.js';
import type { AffiliateRepository } from './prisma-affiliate.js';
import { safeAdminUrl } from './product-identity.js';

const id = z.uuid();
const page = z.strictObject({ after: id.optional() });
const login = z.strictObject({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) });
const httpsUrl = z.string().trim().max(2048).transform((value, context) => {
  const url = safeAdminUrl(value);
  if (url) return url;
  context.addIssue({ code: 'custom', message: 'Enter a valid HTTPS URL.' });
  return z.NEVER;
});
const optionalAttribute = z.string().trim().min(1).max(120).optional();
const evidence = z.strictObject({
  title: z.string().trim().min(1).max(160), brand: optionalAttribute, model: optionalAttribute, sellerId: optionalAttribute,
  variants: z.strictObject({
    color: optionalAttribute, size: optionalAttribute, capacity: optionalAttribute, configuration: optionalAttribute,
    other: z.string().trim().min(1).max(240).optional(),
  }),
  notes: z.string().trim().min(12).max(2000),
  evidenceUrl: httpsUrl.transform((url) => url.href).optional(),
  confirmedExact: z.literal(true),
});
const revision = z.number().int().nonnegative();
const review = z.union([
  z.strictObject({ action: z.enum(['approve', 'revalidate', 'restore']), revision, evidence }),
  z.strictObject({ action: z.enum(['reject', 'disable', 'revoke', 'invalid']), revision, reason: z.string().trim().min(3).max(600) }),
]);

const handleAffiliateProblem: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (!(error instanceof AffiliateProblem)) return next(error);
  res.status(error.status).json({ error: error.message });
};

export function adminRoutes(affiliate: AffiliateRepository, credentials: AdminCredentials, secret: string, secure: boolean, recommendationsDb?: PrismaClient, recommendationSuperadminEnabled = false) {
  const router = Router();
  const scope = adminCredentialScope(credentials, secret);
  const cookie = secure ? '__Host-nanti-admin' : 'nanti-admin';
  const options = { path: '/', httpOnly: true, sameSite: 'strict', secure } satisfies CookieOptions;

  router.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('Sec-Fetch-Site') === 'cross-site') {
      res.status(403).json({ error: 'Request could not be verified.' });
      return;
    }
    next();
  });

  router.post('/login', rateLimit({
    windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  }), async (req, res) => {
    const input = login.safeParse(req.body);
    if (!input.success || !await verifyAdminPassword(credentials, input.data.username, input.data.password)) {
      res.status(401).json({ error: 'The username or password is incorrect.' });
      return;
    }
    const session = newAdminSession();
    await affiliate.addSession(session.tokenHash, scope, session.expiresAt, adminTokenHash(req.cookies[cookie]));
    res.cookie(cookie, session.token, { ...options, maxAge: adminSessionMs });
    res.json({ username: credentials.username });
  });

  router.use(async (req, res, next) => {
    const tokenHash = adminTokenHash(req.cookies[cookie]);
    if (!tokenHash || !await affiliate.hasSession(tokenHash, scope)) {
      res.status(401).json({ error: 'Administrator sign-in is required.' });
      return;
    }
    res.locals.adminTokenHash = tokenHash;
    next();
  });

  router.get('/session', (_req, res) => { res.json({ username: credentials.username }); });
  router.post('/logout', async (_req, res) => {
    await affiliate.removeSession(res.locals.adminTokenHash, scope);
    res.clearCookie(cookie, options).sendStatus(204);
  });

  if (recommendationsDb) router.use('/workspace', adminWorkspaceRoutes(recommendationsDb, credentials.username, {
    databaseConfigured: true,
    administratorLoginConfigured: Boolean(credentials.username && credentials.passwordHash),
    recommendationManagementEnabled: recommendationSuperadminEnabled,
  }));
  if (recommendationsDb && recommendationSuperadminEnabled) router.use('/recommendations', recommendationAdminRoutes(recommendationsDb));

  router.get('/opportunities', async (req, res) => {
    res.json(await affiliate.listOpportunities(page.parse(req.query).after));
  });
  router.get('/opportunities/:identityId', async (req, res) => {
    const opportunity = await affiliate.detail(id.parse(req.params.identityId));
    if (!opportunity) throw new AffiliateProblem(404, 'This product identity could not be found.');
    res.json(opportunity);
  });
  router.get('/opportunities/:identityId/mappings', async (req, res) => {
    res.json(await affiliate.listMappings(id.parse(req.params.identityId), page.parse(req.query).after));
  });
  router.get('/opportunities/:identityId/audit', async (req, res) => {
    res.json(await affiliate.listAudit(id.parse(req.params.identityId), page.parse(req.query).after));
  });
  router.post('/opportunities/:identityId/mappings', async (req, res) => {
    const { url } = z.strictObject({ url: httpsUrl }).parse(req.body);
    res.status(201).json(await affiliate.addCandidate(id.parse(req.params.identityId), url, credentials.username));
  });
  router.patch('/opportunities/:identityId/mappings/:mappingId', async (req, res) => {
    res.json(await affiliate.reviewMapping(id.parse(req.params.identityId), id.parse(req.params.mappingId),
      credentials.username, review.parse(req.body)));
  });

  router.get('/notifications', async (req, res) => {
    res.json(await affiliate.notices(page.parse(req.query).after));
  });
  router.post('/notifications/read-all', async (_req, res) => {
    await affiliate.markAllNoticesRead();
    res.sendStatus(204);
  });
  router.patch('/notifications/:noticeId', async (req, res) => {
    const { action } = z.strictObject({ action: z.enum(['read', 'unread', 'dismiss']) }).parse(req.body);
    if (!await affiliate.updateNotice(id.parse(req.params.noticeId), action)) {
      throw new AffiliateProblem(404, 'This notification could not be found.');
    }
    res.sendStatus(204);
  });
  router.use(handleAffiliateProblem);
  return router;
}
