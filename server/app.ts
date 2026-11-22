import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { recommendationConsumerRoutes } from './recommendation-consumer-routes.js';
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
import type { createImageStorage } from './image-storage.js';
import { boundedJpeg, downloadTokopediaImage } from './tokopedia-metadata.js';
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
const productLink = z.string().trim().max(2048).transform((value, context) => {
  const parsed = safeImportUrl(value);
  if (parsed) return { parsed, original: value };
  context.addIssue({ code: 'custom', message: 'Enter a valid HTTP or HTTPS product link.' });
  return z.NEVER;
});
const productUrl = productLink.transform(({ parsed }) => parsed);
const itemInput = z.strictObject({
  sellerName: z.string().trim().min(1).max(160).nullable().optional(),
  name: z.string().trim().min(1, 'Enter a product name.').max(160),
  url: productLink.transform(({ original }) => original).nullable(),
  priceMinor: z.number().int().min(0).max(999_999_999).nullable(),
  quantity: z.number().int().min(1).max(999),
  imageKey: z.string().max(255).nullable().optional(),
  priceSource: z.literal('imported_unverified').optional(),
});

type Options = {
  repository: WishlistRepository;
  intelligence?: IntelligenceRepository;
  prices?: Prices;
  recommendationsDb?: PrismaClient;
  affiliate?: AffiliateRepository;
  admin?: AdminCredentials;
  consumer?: { accounts: Accounts; providers: OAuthProviders };
  preview: (url: URL) => Promise<string | null>;
  lookupMetadata?: (url: URL, request?: typeof fetch, onDiagnostic?: (reason: string, host: string, status?: number) => void) => ReturnType<typeof previewProductMetadata>;
  productMedia?: ReturnType<typeof createProductMedia>;
  imageStorage?: ReturnType<typeof createImageStorage>;
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

export function createApp({ repository, intelligence, prices, recommendationsDb, affiliate, admin, consumer, preview, lookupMetadata, productMedia = async () => null, imageStorage,
  secret, secureCookies, trustedProxy, webRoot, checkDatabase, retention }: Options) {
  const app = express();
  const api = express.Router();
  const cookieName = secureCookies ? '__Host-nanti' : 'nanti';
  const account = consumer && accountRoutes(consumer.accounts, consumer.providers, secureCookies, cookieName, { lookupMetadata, productMedia });
  app.disable('x-powered-by');
  if (trustedProxy) app.set('trust proxy', trustedProxy);
  // Public Shopee preview images are hosted on Shopee's image CDN.
  // Keep all other Helmet CSP protections and allow only the known CDN hosts.
  const imageSources = ["'self'", 'data:', 'https://images.unsplash.com', 'https://*.susercontent.com',
    'https://susercontent.com', 'https://*.shopee.co.id', 'https://shopee.co.id', 'https://*.googleusercontent.com',
    'https://*.tokopedia.net', 'https://tokopedia.net', 'https://*.tokopedia.com', 'https://tokopedia.com',
    'https://*.tokopedia-static.net', 'https://tokopedia-static.net',
    'https://*.tiktokcdn.com', 'https://tiktokcdn.com', 'https://*.ibytedtos.com', 'https://ibytedtos.com',
    ...(imageStorage ? [imageStorage.origin] : [])];
  app.use(helmet(secureCookies ? {
    contentSecurityPolicy: { directives: { imgSrc: imageSources,
      connectSrc: ["'self'", ...(imageStorage ? [imageStorage.origin] : [])] } },
  } : {
    strictTransportSecurity: false,
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null, imgSrc: imageSources,
      connectSrc: ["'self'", ...(imageStorage ? [imageStorage.origin] : [])] } },
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
    } catch (error) {
      // Log only structured error identifiers; never log SQL, connection URLs or credentials.
      const failure = error && typeof error === 'object' ? error as {
        code?: unknown; errorCode?: unknown; cause?: { code?: unknown; kind?: unknown };
      } : {};
      const identifier = [failure.code, failure.errorCode, failure.cause?.code, failure.cause?.kind]
        .find((value): value is string => typeof value === 'string' && /^[A-Za-z0-9_]{2,48}$/u.test(value));
      console.error('Database readiness check failed', { code: identifier ?? 'unknown' });
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
        (req.get('X-Nanti-Request') === '1' && (req.is('application/json') ||
          (req.method === 'POST' && req.path === '/uploads/product-image/content' && req.is('image/jpeg'))))) {
      next();
      return;
    }
    res.status(403).json({ error: 'Request could not be verified.' });
  });
  const parseJson = express.json({ limit: '12kb' });
  api.use((req, res, next) => {
    if (account && ['PUT', 'PATCH'].includes(req.method) &&
        /^\/account\/creator\/catalog\/products\/[a-f0-9-]{36}\/?$/iu.test(req.path)) return next();
    return parseJson(req, res, next);
  });
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
  if (recommendationsDb) api.use('/recommendations', recommendationConsumerRoutes(recommendationsDb));
  api.use(purchaseDestinationRoutes(repository, affiliate, secret));

  const limitImageUpload = rateLimit({
    windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many image uploads. Try again shortly.' },
  });
  api.post('/uploads/product-image', limitImageUpload, async (req, res) => {
    if (!imageStorage) return res.status(503).json({ error: 'Image uploads are not configured.' });
    if (imageStorage.provider === 'r2') return res.status(410).json({ error: 'Refresh to use the secure image uploader.' });
    const { contentType, size } = z.strictObject({
      contentType: z.literal('image/jpeg'), size: z.number().int().min(1).max(195_000),
    }).parse(req.body);
    void contentType;
    void size;
    res.json(imageStorage.createUpload(res.locals.ownerId));
  });

  api.post('/uploads/product-image/content', limitImageUpload,
    express.raw({ type: 'image/jpeg', limit: 195_000, inflate: false }), async (req, res) => {
      if (!imageStorage) return res.status(503).json({ error: 'Image uploads are not configured.' });
      if (!Buffer.isBuffer(req.body) || !boundedJpeg(req.body)) {
        return res.status(400).json({ error: 'Choose a valid JPEG photo.' });
      }
      const owner = res.locals.ownerId as string;
      const { key } = imageStorage.createUpload(owner);
      const stored = await imageStorage.storeJpeg(owner, req.body, key).catch(() => null);
      if (!stored) {
        if (!await imageStorage.discard(key).catch(() => false)) console.warn('Could not remove an unattached product photo.');
        return res.status(502).json({ error: 'Image upload failed. Try again.' });
      }
      return res.status(201).json({ key: stored });
    });

  api.get('/wishlists/:listId/items/:itemId/uploaded-image', async (req, res) => {
    if (!imageStorage) return notFound(res);
    const list = await repository.find(res.locals.ownerId, uuid.parse(req.params.listId));
    const item = list?.items.find(entry => entry.id === uuid.parse(req.params.itemId));
    if (!item?.imageKey || !imageStorage.validKey(list!.scopeId ?? res.locals.ownerId, item.imageKey)) return notFound(res);
    const image = await imageStorage.readJpeg(item.imageKey);
    if (!image) return notFound(res);
    res.set('Cache-Control', 'private, no-store').type('image/jpeg').send(image);
  });

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
    const { saveTokopediaImage, tokopediaProductUrl, ...input } = itemInput.extend({
      saveTokopediaImage: z.literal(true).optional(), tokopediaProductUrl: z.string().max(2048).optional(),
    }).parse(req.body);
    const owner = res.locals.ownerId as string;
    if (input.imageKey && (!imageStorage || !imageStorage.validKey(owner, input.imageKey) ||
      !await imageStorage.exists(input.imageKey))) return res.status(400).json({ error: 'Image upload was not verified.' });
    if (!saveTokopediaImage || input.imageKey) {
      if (!await repository.addItem(owner, listId, input)) return notFound(res);
      return res.sendStatus(201);
    }

    const requestId = uuid.parse(req.get('Idempotency-Key'));
    const listing = input.url && safeImportUrl(input.url);
    if (!listing || productMerchant(listing.hostname) !== 'tokopedia') {
      return res.status(400).json({ error: 'Enter a valid Tokopedia product link.' });
    }

    const list = await repository.find(owner, listId);
    if (!list) return notFound(res);
    const replay = (saved: (typeof list.items)[number]) => {
      if (saved.url !== input.url || saved.name !== input.name || saved.priceMinor !== input.priceMinor ||
          saved.quantity !== input.quantity || (saved.sellerName ?? null) !== (input.sellerName ?? null)) {
        return res.status(409).json({ error: 'This save was already used for a different product.' });
      }
      return res.status(201).json({ photoStatus: saved.imageKey ? 'saved' : 'unavailable' });
    };
    const existing = list.items.find(item => item.id === requestId);
    if (existing) return replay(existing);

    const discard = async (key: string) => {
      if (!await imageStorage?.discard(key).catch(() => false)) {
        console.warn('Could not remove an unattached product photo.');
      }
    };
    let imageKey: string | null = null;
    if (imageStorage && lookupMetadata) {
      let allocatedKey: string | undefined;
      try {
        // Recheck the original product link. No client-provided CDN URL is fetched.
        const metadata = await lookupMetadata(listing);
        const bytes = metadata?.image && (!tokopediaProductUrl || metadata.productUrl === tokopediaProductUrl) &&
          await downloadTokopediaImage(metadata.image);
        if (bytes) {
          const scope = list.scopeId ?? owner;
          allocatedKey = imageStorage.createUpload(scope).key;
          imageKey = await imageStorage.storeJpeg(scope, bytes, allocatedKey);
        }
      } catch {
        // A store or bucket failure must not block saving the item.
      }
      if (allocatedKey && !imageKey) await discard(allocatedKey);
    }

    let writeError: unknown;
    try {
      if (await repository.addItem(owner, listId, { ...input, imageKey }, requestId)) {
        return res.status(201).json({ photoStatus: imageKey ? 'saved' : 'unavailable' });
      }
    } catch (error) {
      writeError = error;
    }

    // Check the stored key before cleanup in case the database committed before the response failed.
    const current = await repository.find(owner, listId);
    const saved = current?.items.find(item => item.id === requestId);
    if (imageKey && saved?.imageKey !== imageKey) await discard(imageKey);
    if (saved) return replay(saved);
    if (writeError) throw writeError;
    return notFound(res);
  });
  async function removeUnusedR2Image(key: string) {
    try {
      if (repository.imageReferenced && !await repository.imageReferenced(key) && !await imageStorage?.discard(key)) {
        console.warn('Could not remove an unused product photo.');
      }
    } catch {
      console.warn('Could not remove an unused product photo.');
    }
  }

  async function previousR2Image(owner: string, listId: string, itemId: string) {
    if (imageStorage?.provider !== 'r2' || !repository.imageReferenced) return null;
    const list = await repository.find(owner, listId);
    const key = list?.items.find(item => item.id === itemId)?.imageKey;
    return key && imageStorage.validKey(list?.scopeId ?? owner, key) ? key : null;
  }

  api.put('/wishlists/:listId/items/:itemId', async (req, res) => {
    const listId = uuid.parse(req.params.listId);
    const itemId = uuid.parse(req.params.itemId);
    const input = itemInput.parse(req.body);
    if (input.imageKey && (!imageStorage || !imageStorage.validKey(res.locals.ownerId, input.imageKey) ||
      !await imageStorage.exists(input.imageKey))) return res.status(400).json({ error: 'Image upload was not verified.' });
    const previous = input.imageKey !== undefined ? await previousR2Image(res.locals.ownerId, listId, itemId) : null;
    if (!await repository.updateItem(res.locals.ownerId, listId, itemId, input)) {
      return notFound(res);
    }
    if (previous && previous !== input.imageKey) await removeUnusedR2Image(previous);
    res.sendStatus(204);
  });
  api.delete('/wishlists/:listId/items/:itemId', async (req, res) => {
    const listId = uuid.parse(req.params.listId);
    const itemId = uuid.parse(req.params.itemId);
    const previous = await previousR2Image(res.locals.ownerId, listId, itemId);
    if (!await repository.removeItem(res.locals.ownerId, listId, itemId)) return notFound(res);
    if (previous) await removeUnusedR2Image(previous);
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
    const { url: { parsed: url, original } } = z.strictObject({ url: productLink }).parse(req.body);
    const merchant = productMerchant(url.hostname);
    const canLookUp = isIkeaMetadataLink(url) || merchant === 'shopee' || merchant === 'tokopedia';
    let diagnostic: { code: string; host: string; httpStatus?: number } | null = null;
    const meta = canLookUp && lookupMetadata ? await lookupMetadata(url, undefined, (code, host, httpStatus) => {
      diagnostic = { code, host, ...(httpStatus === undefined ? {} : { httpStatus }) };
    }) : null;
    const name = canLookUp && !lookupMetadata ? await preview(url) : meta?.title ?? null;
    const listing = meta?.image && identifyProduct(new URL(url.pathname, url.origin).href);
    const imagePath = listing ? `/api/products/import/image?url=${encodeURIComponent(listing.canonicalUrl)}` :
      (merchant === 'shopee' || merchant === 'tokopedia') ? meta?.image ?? null : null;
    const result: ProductImport = {
      merchant, hostname: url.hostname, originalUrl: original, name,
      ...(merchant === 'tokopedia' && meta?.productUrl && { productUrl: meta.productUrl }),
      ...(merchant === 'tokopedia' && imageStorage && imagePath && meta?.productUrl && { canSaveImage: true }),
      ...(imagePath && { imagePath }),
      ...(meta?.price && { price: meta.price }),
      ...(meta?.sellerName && { sellerName: meta.sellerName }),
      ...(!meta && !name && { diagnostic: diagnostic ?? { code: canLookUp ? (lookupMetadata ? 'metadata_unavailable' : 'adapter_disabled') : 'unsupported_url', host: url.hostname } }),
      status: imagePath || meta?.price || meta?.sellerName ? 'details_available' : name ? 'name_available' : 'manual_required',
    };
    res.json(result);
  });
  api.post('/products/import/tokopedia-image', limitProductLookup, async (req, res) => {
    const { url } = z.strictObject({ url: productUrl }).parse(req.body);
    if (!imageStorage || !lookupMetadata || url.origin !== 'https://www.tokopedia.com' || url.search || url.hash) {
      return res.status(422).json({ error: 'The store photo could not be saved. You can upload your own.' });
    }
    try {
      const metadata = await lookupMetadata(url);
      const bytes = metadata?.image && await downloadTokopediaImage(metadata.image);
      const imageKey = bytes && await imageStorage.storeJpeg(res.locals.ownerId, bytes);
      if (imageKey) return res.status(201).json({ imageKey });
    } catch {
      // Keep temporary retailer and storage URLs out of logs and responses.
    }
    return res.status(422).json({ error: 'The store photo could not be saved. You can upload your own.' });
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
    app.get(['/admin', '/account', '/creator', '/creator/studio', '/creator/demo', '/store/:handle'], (_req, res) => {
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
