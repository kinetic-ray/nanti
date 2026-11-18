import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import type { ErrorRequestHandler, Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { currencies } from '../shared/wishlist.js';
import { isIkeaMetadataLink, productMerchant, safeImportUrl } from '../shared/product-import.js';
import type { ProductImport } from '../shared/product-import.js';
import type { previewProductMetadata } from './product-preview.js';
import { identifyProduct } from './product-identity.js';
import { readWishlist } from './wishlist.js';
import type { WishlistRepository } from './wishlist.js';
import { intelligenceRoutes } from './intelligence-routes.js';
import type { IntelligenceRepository } from './intelligence.js';
import { adminRoutes } from './admin-routes.js';
import type { AdminCredentials } from './admin-credentials.js';
import type { AffiliateRepository } from './prisma-affiliate.js';
import { purchaseDestinationRoutes } from './purchase-destinations.js';
import type { createProductMedia } from './product-media.js';
import { accountRoutes } from './account-routes.js';
import type { Accounts } from './prisma-accounts.js';
import type { OAuthProviders } from './oauth-providers.js';
import { databaseProblem, databaseUnavailable } from './database-health.js';
import { priceRoutes } from './price-routes.js';
import type { Prices } from './prisma-prices.js';

const uuid = z.uuid();
const listName = z.string().trim().min(1, 'Enter a wishlist name.').max(100);
const listInput = z.strictObject({ name: listName, currency: z.enum(currencies) });
const renameInput = z.strictObject({ name: listName });
const productUrl = z.string().trim().max(2048).transform((value, context) => {
  const parsed = safeImportUrl(value);
  if (parsed) return parsed;
  context.addIssue({ code: 'custom', message: 'Enter a valid HTTP or HTTPS product link.' });
  return z.NEVER;
});
const itemInput = z.strictObject({
  name: z.string().trim().min(1, 'Enter a product name.').max(160),
  url: productUrl.transform((url) => url.href).nullable(),
  priceMinor: z.number().int().min(0).max(999_999_999).nullable(),
  quantity: z.number().int().min(1).max(999),
  priceSource: z.literal('imported_unverified').optional(),
});

type Options = {
  repository: WishlistRepository;
  intelligence?: IntelligenceRepository;
  prices?: Prices;
  affiliate?: AffiliateRepository;
  admin?: AdminCredentials;
  consumer?: { accounts: Accounts; providers: OAuthProviders };
  preview: (url: URL) => Promise<string | null>;
  lookupMetadata?: (url: URL) => ReturnType<typeof previewProductMetadata>;
  productMedia?: ReturnType<typeof createProductMedia>;
  secret: string;
  secureCookies: boolean;
  trustedProxy?: string | number;
  webRoot?: string;
  checkDatabase?: () => Promise<void>;
  retention?: { secret: string; prune: () => Promise<unknown> };
};

function notFound(response: Response) {
  response.status(404).json({ error: 'This wishlist or item could not be found.' });
}

export function createApp({ repository, intelligence, prices, affiliate, admin, consumer, preview, lookupMetadata, productMedia = async () => null,
  secret, secureCookies, trustedProxy, webRoot, checkDatabase, retention }: Options) {
  const app = express();
  const api = express.Router();
  const cookieName = secureCookies ? '__Host-nanti' : 'nanti';
  const account = consumer && accountRoutes(consumer.accounts, consumer.providers, secureCookies, cookieName);
  app.disable('x-powered-by');
  if (trustedProxy) app.set('trust proxy', trustedProxy);
  // Public Shopee preview images are hosted on Shopee's image CDN.
  // Keep all other Helmet CSP protections and allow only the known CDN hosts.
  const imageSources = ["'self'", 'data:', 'https://*.susercontent.com',
    'https://susercontent.com', 'https://*.shopee.co.id', 'https://shopee.co.id'];
  app.use(helmet(secureCookies ? {
    contentSecurityPolicy: { directives: { imgSrc: imageSources } },
  } : {
    strictTransportSecurity: false,
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null, imgSrc: imageSources } },
  }));
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(rateLimit({
    windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many requests. Try again in a minute.' },
  }));
  api.get('/health', async (_req, res) => {
    try {
      await checkDatabase?.();
      res.json({ service: 'nanti', status: 'ready' });
    } catch {
      res.status(503).json({ service: 'nanti', ...databaseProblem });
    }
  });
  if (retention) {
    const digest = (value: string) => createHash('sha256').update(value).digest();
    const authorized = digest(`Bearer ${retention.secret}`);
    api.get('/maintenance/retention', async (req, res) => {
      if (req.method !== 'GET') return res.status(405).set('Allow', 'GET').end();
      if (!timingSafeEqual(authorized, digest(req.get('authorization') ?? ''))) return res.status(401).end();
      await retention.prune();
      res.status(204).end();
    });
  }
  api.use(cookieParser(secret));
  if (account) api.use('/account', account.callbacks);
  api.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
        (req.get('X-Nanti-Request') === '1' && req.is('application/json'))) {
      next();
      return;
    }
    res.status(403).json({ error: 'Request could not be verified.' });
  });
  api.use(express.json({ limit: '12kb' }));
  if (account) api.use('/account', account.api);
  else api.get('/account', (_req, res) => res.json({ available: [], account: null }));
  if (affiliate && admin) api.use('/admin', adminRoutes(affiliate, admin, secret, secureCookies));
  api.use('/admin', (_req, res) => res.status(404).json({
    error: affiliate && admin ? 'This administrator endpoint could not be found.' : 'Administrator sign-in is not configured.',
  }));

  api.post('/session', async (req, res) => {
    const session = uuid.safeParse(req.signedCookies[cookieName]);
    const owner = account ? await account.resolveOwner(req, res, true) :
      { id: session.success ? session.data : randomUUID(), guest: true };
    if (!owner) return res.sendStatus(401);
    const lists = await repository.list(owner.id);
    if (owner.guest) res.cookie(cookieName, owner.id, {
      signed: true, httpOnly: true, secure: secureCookies, sameSite: 'strict',
      path: '/', maxAge: 365 * 24 * 60 * 60 * 1000,
    });
    res.json(lists);
  });

  api.use(async (req, res, next) => {
    const session = uuid.safeParse(req.signedCookies[cookieName]);
    const owner = account ? await account.resolveOwner(req, res, false) :
      session.success ? { id: session.data, guest: true } : null;
    if (!owner) {
      res.status(401).json({ error: 'Refresh to start a wishlist session.' });
      return;
    }
    res.locals.ownerId = owner.id;
    res.locals.guest = owner.guest;
    next();
  });
  if (intelligence) api.use('/intelligence', intelligenceRoutes(repository, intelligence, secret));
  if (prices) api.use(priceRoutes(prices));
  api.use(purchaseDestinationRoutes(repository, affiliate, secret));

  api.get('/wishlists/:listId/items/:itemId/image', rateLimit({
    windowMs: 60_000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many product image requests.' },
  }), async (req, res) => {
    const listId = uuid.parse(req.params.listId);
    const itemId = uuid.parse(req.params.itemId);
    const list = await repository.find(res.locals.ownerId, listId);
    const item = list?.items.find(entry => entry.id === itemId);
    const media = item && await productMedia(item.url);
    if (!media) return notFound(res);
    res.set('Content-Type', media.type).send(media.bytes);
  });

  api.get('/wishlists', async (_req, res) => {
    res.json(await repository.list(res.locals.ownerId));
  });
  api.post('/wishlists', async (req, res) => {
    res.status(201).json(await repository.create(res.locals.ownerId, listInput.parse(req.body), res.locals.guest));
  });
  api.get('/wishlists/:listId', async (req, res) => {
    const list = await readWishlist(repository, res.locals.ownerId, uuid.parse(req.params.listId));
    if (!list) return notFound(res);
    res.json(list);
  });
  api.patch('/wishlists/:listId', async (req, res) => {
    const id = uuid.parse(req.params.listId);
    const { name } = renameInput.parse(req.body);
    if (!await repository.rename(res.locals.ownerId, id, name)) return notFound(res);
    res.sendStatus(204);
  });
  api.delete('/wishlists/:listId', async (req, res) => {
    if (!await repository.remove(res.locals.ownerId, uuid.parse(req.params.listId))) return notFound(res);
    res.sendStatus(204);
  });
  api.post('/wishlists/:listId/items', async (req, res) => {
    const listId = uuid.parse(req.params.listId);
    if (!await repository.addItem(res.locals.ownerId, listId, itemInput.parse(req.body))) return notFound(res);
    res.sendStatus(201);
  });
  api.put('/wishlists/:listId/items/:itemId', async (req, res) => {
    const listId = uuid.parse(req.params.listId);
    const itemId = uuid.parse(req.params.itemId);
    if (!await repository.updateItem(res.locals.ownerId, listId, itemId, itemInput.parse(req.body))) {
      return notFound(res);
    }
    res.sendStatus(204);
  });
  api.delete('/wishlists/:listId/items/:itemId', async (req, res) => {
    const listId = uuid.parse(req.params.listId);
    const itemId = uuid.parse(req.params.itemId);
    if (!await repository.removeItem(res.locals.ownerId, listId, itemId)) return notFound(res);
    res.sendStatus(204);
  });

  const limitProductLookup = rateLimit({
    windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many lookups. Enter the product details below.' },
  });
  api.post('/products/preview', limitProductLookup, async (req, res) => {
    const { url } = z.strictObject({ url: productUrl }).parse(req.body);
    const name = await preview(url);
    res.json(name ? { name } : { name: null });
  });
  api.post('/products/import', limitProductLookup, async (req, res) => {
    const { url } = z.strictObject({ url: productUrl }).parse(req.body);
    const merchant = productMerchant(url.hostname);
    const canLookUp = isIkeaMetadataLink(url) || merchant === 'shopee' || merchant === 'tokopedia';
    const meta = canLookUp && lookupMetadata ? await lookupMetadata(url) : null;
    const name = canLookUp && !lookupMetadata ? await preview(url) : meta?.title ?? null;
    const listing = meta?.image && identifyProduct(new URL(url.pathname, url.origin).href);
    const imagePath = listing ? `/api/products/import/image?url=${encodeURIComponent(listing.canonicalUrl)}` :
      (merchant === 'shopee' || merchant === 'tokopedia') ? meta?.image ?? null : null;
    const result: ProductImport = {
      merchant, hostname: url.hostname, originalUrl: url.href, name,
      ...(imagePath && { imagePath }),
      ...(meta?.price && { price: meta.price }),
      status: imagePath || meta?.price ? 'details_available' : name ? 'name_available' : 'manual_required',
    };
    res.json(result);
  });
  api.get('/products/import/image', limitProductLookup, async (req, res) => {
    const { url } = z.strictObject({ url: productUrl }).parse(req.query);
    const listing = identifyProduct(url.href);
    const image = listing && await productMedia(listing.canonicalUrl);
    if (!image) return notFound(res);
    res.set('Content-Type', image.type).send(image.bytes);
  });

  api.use((_req, res) => notFound(res));
  app.use('/api', api);

  if (webRoot) {
    app.get(['/admin', '/account'], (_req, res) => {
      res.set('Cache-Control', 'no-store').sendFile('index.html', { root: webRoot });
    });
    app.use(express.static(webRoot, { dotfiles: 'deny' }));
  }
  app.use((_req, res) => notFound(res));
  app.use(handleError);
  return app;
}

const handleError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (databaseUnavailable(error)) {
    res.status(503).json(databaseProblem);
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.issues[0]?.message ?? 'Check the details you entered.' });
    return;
  }
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401) {
    res.status(401).json({ error: 'Refresh to start a wishlist session.' });
    return;
  }
  if (status === 400 || status === 413 || status === 415) {
    res.status(status).json({ error: 'The request body is invalid or too large.' });
    return;
  }
  console.error('Request failed', { type: error instanceof Error ? error.name : 'unknown' });
  res.status(500).json({ error: 'Something went wrong. Try again.' });
};
