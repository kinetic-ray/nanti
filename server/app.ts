import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import type { PrismaClient } from './generated/prisma/client.js';
import { recommendationListing, signRecommendationPreview } from './recommendation-workspace-routes.js';
import { recommendationConsumerRoutes } from './recommendation-consumer-routes.js';
import type { ErrorRequestHandler, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { currencies, maxPriceMinor } from '../shared/wishlist.js';
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
import { boundedJpeg, downloadMarketplaceImage, downloadShopeeImage, downloadTokopediaImage } from './tokopedia-metadata.js';
import { type createMysqlImageStorage, mysqlImageId, newMysqlImageKey, ProductImageWriteError } from './mysql-image-storage.js';
import { compressProductImage } from './product-image-jpeg.js';
import { signTokopediaImage, verifyTokopediaImage } from './tokopedia-image-proof.js';
import { signShopeeImage, verifyShopeeImage } from './shopee-image-proof.js';
import { signPublicTitle, verifyPublicTitle } from './product-title-proof.js';
import { accountRoutes } from './account-routes.js';
import type { Accounts } from './prisma-accounts.js';
import type { OAuthProviders } from './oauth-providers.js';
import { databaseProblem, databaseUnavailable } from './database-health.js';
import { Prisma } from './generated/prisma/client.js';
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
  priceMinor: z.number().int().min(0).max(maxPriceMinor).nullable(),
  quantity: z.number().int().min(1).max(999),
  imageKey: z.string().max(255).nullable().optional(),
  priceSource: z.literal('imported_unverified').optional(),
});

type Options = {
  repository: WishlistRepository;
  intelligence?: IntelligenceRepository;
  prices?: Prices;
  recommendationsDb?: PrismaClient;
  recommendationSuperadminEnabled?: boolean;
  affiliate?: AffiliateRepository;
  admin?: AdminCredentials;
  consumer?: { accounts: Accounts; providers: OAuthProviders };
  preview: (url: URL) => Promise<string | null>;
  lookupMetadata?: (url: URL, request?: typeof fetch, onDiagnostic?: (reason: string, host: string, status?: number) => void) => ReturnType<typeof previewProductMetadata>;
  productMedia?: ReturnType<typeof createProductMedia>;
  imageStorage?: ReturnType<typeof createImageStorage>;
  mysqlImages?: ReturnType<typeof createMysqlImageStorage>;
  marketplaceImageRequest?: Parameters<typeof downloadMarketplaceImage>[2];
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

export function createApp({ repository, intelligence, prices, recommendationsDb, recommendationSuperadminEnabled = false, affiliate, admin, consumer, preview, lookupMetadata, productMedia = async () => null, imageStorage, mysqlImages,
  marketplaceImageRequest, secret, secureCookies, trustedProxy, webRoot, checkDatabase, retention }: Options) {
  const app = express();
  const api = express.Router();
  const cookieName = secureCookies ? '__Host-nanti' : 'nanti';
  const account = consumer && accountRoutes(consumer.accounts, consumer.providers, secureCookies, cookieName, {
    lookupMetadata, productMedia, marketplaceImageRequest,
    verifyShopeeImage: (owner, listing, product, image, proof) => verifyShopeeImage(secret,
      { owner, listing, product, image }, proof),
  });
  app.disable('x-powered-by');
  if (trustedProxy) app.set('trust proxy', trustedProxy);
  // Public Shopee preview images are hosted on Shopee's image CDN.
  // Keep all other Helmet CSP protections and allow only the known CDN hosts.
  const imageSources = ["'self'", 'data:', 'https://images.unsplash.com', 'https://*.susercontent.com',
    'https://susercontent.com', 'https://cf.shopee.co.id', 'https://*.googleusercontent.com',
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
  const limitProductLookup = rateLimit({
    windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many lookups. Enter the product details below.' },
  });
  if (affiliate && admin) api.use('/admin', adminRoutes(affiliate, admin, secret, secureCookies, recommendationsDb, recommendationSuperadminEnabled,
    [limitProductLookup, (req, res) => importProduct(req, res, true)]));
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
  if (recommendationsDb) api.use('/recommendations', recommendationConsumerRoutes(recommendationsDb, affiliate));
  api.use(purchaseDestinationRoutes(repository, affiliate, secret));

  const limitImageUpload = rateLimit({
    windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many image uploads. Try again shortly.' },
  });
  api.post('/uploads/product-image', limitImageUpload, async (req, res) => {
    if (mysqlImages) return res.status(410).json({ error: 'Refresh to use the secure image uploader.' });
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
      if (!mysqlImages && !imageStorage) return res.status(503).json({ error: 'Image uploads are not configured.' });
      if (!Buffer.isBuffer(req.body) || !boundedJpeg(req.body)) {
        return res.status(400).json({ error: 'Choose a valid JPEG photo.' });
      }
      const owner = res.locals.ownerId as string;
      if (mysqlImages) {
        const bytes = await compressProductImage(req.body);
        if (!bytes) return res.status(400).json({ error: 'Choose a valid JPEG photo.' });
        const key = await mysqlImages.storeJpeg(owner, bytes).catch(() => null);
        if (!key) return res.status(502).json({ error: 'Image upload failed. Try again.' });
        return res.status(201).json({ key });
      }
      if (!imageStorage) return res.sendStatus(503);
      const { key } = imageStorage.createUpload(owner);
      const stored = await imageStorage.storeJpeg(owner, req.body, key).catch(() => null);
      if (!stored) {
        if (!await imageStorage.discard(key).catch(() => false)) console.warn('Could not remove an unattached product photo.');
        return res.status(502).json({ error: 'Image upload failed. Try again.' });
      }
      return res.status(201).json({ key: stored });
    });

  api.get('/wishlists/:listId/items/:itemId/uploaded-image', async (req, res) => {
    const list = await repository.find(res.locals.ownerId, uuid.parse(req.params.listId));
    const item = list?.items.find(entry => entry.id === uuid.parse(req.params.itemId));
    if (!item?.imageKey) return notFound(res);
    const mysqlKey = mysqlImageId(item.imageKey);
    const image = mysqlKey
      ? await mysqlImages?.readJpeg(item.imageKey, item.id)
      : imageStorage?.validKey(list?.scopeId ?? res.locals.ownerId, item.imageKey)
        ? await imageStorage.readJpeg(item.imageKey) : null;
    if (!image || (mysqlImages && !mysqlKey && !boundedJpeg(image))) return notFound(res);
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).type('image/jpeg').send(image);
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
  const limitMarketplaceSave = rateLimit({
    windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    skip: req => !req.body?.saveMarketplaceImage && !req.body?.saveTokopediaImage,
    message: { error: 'Too many store photo requests. Try again shortly.' },
  });
  api.post('/wishlists/:listId/items', (req, res, next) => {
    const requestId = randomUUID();
    const started = performance.now();
    res.locals.productSaveRequestId = requestId;
    res.set('X-Nanti-Request-Id', requestId);
    res.once('finish', () => console.info('Product save response', {
      requestId, status: res.statusCode, elapsedMs: Math.round(performance.now() - started),
      code: res.locals.productSaveCode,
    }));
    next();
  }, limitMarketplaceSave, async (req, res) => {
    const listId = uuid.parse(req.params.listId);
    const { saveMarketplaceImage, saveTokopediaImage, tokopediaProductUrl, tokopediaImage,
      shopeeProductUrl, shopeeImage, publicTitle, publicPriceProof, verifiedListing, ...input } = itemInput.extend({
      verifiedListing: z.strictObject({ url: z.string().max(2048), proof: z.string().max(80) }).optional(),
      publicPriceProof: z.string().max(80).optional(),
      publicTitle: z.strictObject({ title: z.string().min(1).max(160), proof: z.string().max(80) }).optional(),
      saveMarketplaceImage: z.literal(true).optional(),
      saveTokopediaImage: z.literal(true).optional(), tokopediaProductUrl: z.string().max(2048).optional(),
      tokopediaImage: z.strictObject({ url: z.string().max(2048), proof: z.string().max(80) }).optional(),
      shopeeProductUrl: z.string().max(2048).optional(),
      shopeeImage: z.strictObject({ url: z.string().max(2048), proof: z.string().max(80) }).optional(),
    }).parse(req.body);
    const owner = res.locals.ownerId as string;
    const publicUrl = input.url && safeImportUrl(input.url);
    const verifiedTitle = publicTitle && publicUrl && verifyPublicTitle(secret, {
      owner, url: publicUrl.href, title: publicTitle.title,
    }, publicTitle.proof) ? publicTitle.title : undefined;
    const key = req.get('Idempotency-Key');
    const parsedKey = key ? uuid.safeParse(key) : undefined;
    if (parsedKey && !parsedKey.success) {
      res.locals.productSaveCode = 'invalid_save_key';
      return res.status(400).json({ code: 'invalid_save_key', error: 'Reopen the product form to start a new save.' });
    }
    const requestId = parsedKey?.data;
    if ((saveMarketplaceImage || saveTokopediaImage) && !input.imageKey && !requestId) {
      return res.status(400).json({ error: 'This product save expired. Check the details and submit it again.' });
    }
    const list = await repository.find(owner, listId);
    if (!list) return notFound(res);
    const price = input.priceMinor !== null ? { priceMinor: input.priceMinor, currency: list.currency } : undefined;
    const priceVerified = publicPriceProof && publicUrl && price && verifyPublicTitle(secret, {
      owner, url: publicUrl.href, title: '', price,
    }, publicPriceProof);
    const listingUrl = verifiedListing && publicUrl && verifyPublicTitle(secret, {
      owner, url: publicUrl.href, title: 'resolved-listing:' + verifiedListing.url,
    }, verifiedListing.proof) ? verifiedListing.url : undefined;
    const publicMetadata = { title: verifiedTitle, priceCurrency: priceVerified ? list.currency : undefined, listingUrl };
    const replay = (saved: (typeof list.items)[number]) => {
      if (saved.url !== input.url || saved.name !== input.name || saved.priceMinor !== input.priceMinor ||
          saved.quantity !== input.quantity || (saved.sellerName ?? null) !== (input.sellerName ?? null) ||
          (input.imageKey && saved.imageKey !== input.imageKey)) {
        return res.status(409).json({ error: 'This save key belongs to different product details. Review your wishlist before submitting again.' });
      }
      if (!saveMarketplaceImage && !saveTokopediaImage) return res.sendStatus(201);
      return res.status(201).json({ photoStatus: saved.imageKey ? 'saved' : 'unavailable' });
    };
    const findSaved = async () => requestId
      ? (await repository.find(owner, listId))?.items.find(item => item.id === requestId)
      : undefined;
    const existing = requestId ? list.items.find(item => item.id === requestId) : undefined;
    if (existing) return replay(existing);
    if (input.imageKey && !(mysqlImages && mysqlImageId(input.imageKey)) &&
      (mysqlImages || !imageStorage?.validKey(owner, input.imageKey) || !await imageStorage.exists(input.imageKey))) {
      return res.status(400).json({ error: 'Image upload was not verified.' });
    }
    if ((!saveMarketplaceImage && !saveTokopediaImage) || input.imageKey) {
      try {
        if (await repository.addItem(owner, listId, input, requestId, undefined, publicMetadata)) return res.sendStatus(201);
      } catch (error) {
        if (error instanceof ProductImageWriteError) return res.status(400).json({ error: error.message });
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
      const saved = await findSaved();
      return saved ? replay(saved) : res.status(409).json({ error: 'This save could not be confirmed. Refresh your wishlist and check whether the product was added.' });
    }

    const idempotencyKey = requestId!;
    const listing = input.url && safeImportUrl(input.url);
    const merchant = listing && productMerchant(listing.hostname);
    const ikeaPhoto = listing && merchant === 'ikea' && mysqlImages && isIkeaMetadataLink(listing);
    if (!listing || (!ikeaPhoto && merchant !== 'tokopedia' && (merchant !== 'shopee' || !saveMarketplaceImage))) {
      return res.status(400).json({ error: 'Enter a valid marketplace product link.' });
    }

    if (mysqlImages) {
      let photo: Buffer | null = null;
      try {
        const loadPhoto = async (url: string) => {
          if (merchant !== 'shopee' && merchant !== 'tokopedia') return null;
          const bytes = await downloadMarketplaceImage(merchant, url, marketplaceImageRequest);
          return bytes ? compressProductImage(bytes, true) : null;
        };
        const verifiedImage = merchant === 'tokopedia' && tokopediaImage && tokopediaProductUrl &&
          verifyTokopediaImage(secret, { owner, listing: listing.href, product: tokopediaProductUrl, image: tokopediaImage.url },
            tokopediaImage.proof) ? tokopediaImage.url : null;
        const verifiedShopeeImage = merchant === 'shopee' && shopeeImage && shopeeProductUrl &&
          verifyShopeeImage(secret, { owner, listing: listing.href, product: shopeeProductUrl, image: shopeeImage.url },
            shopeeImage.proof) ? shopeeImage.url : null;
        if (ikeaPhoto) {
          const media = await productMedia(listing.href);
          if (media) photo = await compressProductImage(media.bytes, true);
        }
        if (verifiedImage) photo = await loadPhoto(verifiedImage);
        if (verifiedShopeeImage) photo = await loadPhoto(verifiedShopeeImage);
        if (!ikeaPhoto && !photo && !verifiedShopeeImage && !shopeeImage) {
          const metadata = await lookupMetadata?.(listing);
          if (metadata?.image && metadata.image !== verifiedImage &&
              (!tokopediaProductUrl || metadata.productUrl === tokopediaProductUrl) &&
              (!shopeeProductUrl || metadata.productUrl === shopeeProductUrl)) {
            photo = await loadPhoto(metadata.image);
          }
        }
      } catch {
        // Metadata and download failures still allow a text-only save.
      }
      if (photo) {
        try {
          if (await repository.addItem(owner, listId, { ...input, imageKey: newMysqlImageKey() }, idempotencyKey, photo,
            { ...publicMetadata, marketplacePhoto: true })) {
            return res.status(201).json({ photoStatus: 'saved' });
          }
        } catch (error) {
          const saved = await findSaved();
          if (saved) return replay(saved);
          if (!(error instanceof ProductImageWriteError)) throw error;
        }
      }
      try {
        if (await repository.addItem(owner, listId, { ...input, imageKey: null }, idempotencyKey, undefined, publicMetadata)) {
          return res.status(201).json({ photoStatus: 'unavailable' });
        }
      } catch (error) {
        const saved = await findSaved();
        if (saved) return replay(saved);
        throw error;
      }
      const saved = await findSaved();
      return saved ? replay(saved) : notFound(res);
    }

    const discard = async (key: string) => {
      if (!await imageStorage?.discard(key).catch(() => false)) {
        console.warn('Could not remove an unattached product photo.');
      }
    };
    let imageKey: string | null = null;
    if (imageStorage && lookupMetadata) {
      let allocatedKey: string | undefined;
      try {
        const verifiedShopeeImage = merchant === 'shopee' && shopeeImage && shopeeProductUrl &&
          verifyShopeeImage(secret, { owner, listing: listing.href, product: shopeeProductUrl, image: shopeeImage.url },
            shopeeImage.proof) ? shopeeImage.url : null;
        // A Shopee image URL is fetched only when its short-lived server proof matches this owner and listing.
        const metadata = verifiedShopeeImage || shopeeImage ? null : await lookupMetadata(listing);
        const metadataMatches = metadata?.image && (!tokopediaProductUrl || metadata.productUrl === tokopediaProductUrl) &&
          (!shopeeProductUrl || metadata.productUrl === shopeeProductUrl);
        const imageUrl = verifiedShopeeImage ?? (metadataMatches ? metadata.image : null);
        const bytes = imageUrl ? merchant === 'shopee'
          ? await downloadMarketplaceImage('shopee', imageUrl, marketplaceImageRequest)
          : await downloadTokopediaImage(imageUrl) : null;
        const photo = bytes && merchant === 'shopee' ? await compressProductImage(bytes, true) : bytes;
        if (photo) {
          const scope = list.scopeId ?? owner;
          allocatedKey = imageStorage.createUpload(scope).key;
          imageKey = await imageStorage.storeJpeg(scope, photo, allocatedKey);
        }
      } catch {
        // A store or bucket failure must not block saving the item.
      }
      if (allocatedKey && !imageKey) await discard(allocatedKey);
    }

    let writeError: unknown;
    try {
      if (await repository.addItem(owner, listId, { ...input, imageKey }, requestId, undefined, publicMetadata)) {
        return res.status(201).json({ photoStatus: imageKey ? 'saved' : 'unavailable' });
      }
    } catch (error) {
      writeError = error;
    }

    // Check the stored key before cleanup in case the database committed before the response failed.
    const saved = await findSaved();
    if (imageKey && saved?.imageKey !== imageKey) await discard(imageKey);
    if (saved) return replay(saved);
    if (writeError) throw writeError;
    return notFound(res);
  });
  api.put('/wishlists/:listId/items/:itemId', async (req, res) => {
    const listId = uuid.parse(req.params.listId);
    const itemId = uuid.parse(req.params.itemId);
    const input = itemInput.parse(req.body);
    if (input.imageKey && !(mysqlImages && mysqlImageId(input.imageKey))) {
      if (mysqlImages) {
        const list = await repository.find(res.locals.ownerId, listId);
        if (list?.items.find(item => item.id === itemId)?.imageKey !== input.imageKey) {
          return res.status(400).json({ error: 'Image upload was not verified.' });
        }
        // Preserve the existing legacy reference without reattaching it.
        delete input.imageKey;
      } else if (!imageStorage?.validKey(res.locals.ownerId, input.imageKey) || !await imageStorage.exists(input.imageKey)) {
        return res.status(400).json({ error: 'Image upload was not verified.' });
      }
    }
    try {
      if (!await repository.updateItem(res.locals.ownerId, listId, itemId, input)) return notFound(res);
    } catch (error) {
      if (error instanceof ProductImageWriteError) return res.status(400).json({ error: error.message });
      throw error;
    }
    res.sendStatus(204);
  });
  api.delete('/wishlists/:listId/items/:itemId', async (req, res) => {
    const listId = uuid.parse(req.params.listId);
    const itemId = uuid.parse(req.params.itemId);
    if (!await repository.removeItem(res.locals.ownerId, listId, itemId)) return notFound(res);
    res.sendStatus(204);
  });

  api.post('/products/preview', limitProductLookup, async (req, res) => {
    const { url } = z.strictObject({ url: productUrl }).parse(req.body);
    const name = await preview(url);
    res.json(name ? { name } : { name: null });
  });
  async function importProduct(req: Request, res: Response, adminPreview = false) {
    const { url: { parsed: url, original } } = z.strictObject({ url: productLink }).parse(req.body);
    const merchant = productMerchant(url.hostname);
    if (adminPreview && (url.protocol !== 'https:' || url.port || merchant === 'other')) {
      return res.status(400).json({ error: 'Gunakan tautan HTTPS produk Tokopedia, Shopee, atau IKEA.' });
    }
    const canLookUp = isIkeaMetadataLink(url) || merchant === 'shopee' || merchant === 'tokopedia';
    let diagnostic: { code: string; host: string; httpStatus?: number } | null = null;
    const meta = canLookUp && lookupMetadata ? await lookupMetadata(url, undefined, (code, host, httpStatus) => {
      diagnostic = { code, host, ...(httpStatus === undefined ? {} : { httpStatus }) };
    }) : null;
    const name = canLookUp && !lookupMetadata ? await preview(url) : meta?.title ?? null;
    const listing = merchant === 'ikea' && meta?.image && identifyProduct(url.href);
    const imagePath = listing && listing.merchant === 'IKEA' ? `/api/products/import/image?url=${encodeURIComponent(listing.canonicalUrl)}` :
      (merchant === 'shopee' || merchant === 'tokopedia') ? meta?.image ?? null : null;
    if (adminPreview) {
      const resolved = meta?.productUrl ?? url.href;
      if (!recommendationListing(resolved)) {
        return res.status(422).json({ error: 'Tautan belum mengarah ke produk. Gunakan tautan lengkap dari marketplace.' });
      }
      const price = meta?.price;
      return res.json(signRecommendationPreview(secret, res.locals.adminTokenHash, {
        originalUrl: original, listingUrl: resolved, title: meta?.title?.trim().slice(0, 160) || null,
        image: imagePath && imagePath.length <= 2048 ? imagePath : null,
        price: price && Number.isSafeInteger(price.priceMinor) && price.priceMinor > 0 && price.priceMinor <= 2_000_000_000 ? price : null,
      }));
    }
    const result: ProductImport = {
      merchant, hostname: url.hostname, originalUrl: original, name,
      ...(meta?.productUrl && meta.productUrl.length <= 2048 && recommendationListing(meta.productUrl) &&
        /^(?:www\.)?(?:s\.shopee\.co\.id|shopee\.ee|tokopedia\.link|tk\.tokopedia\.com|vt\.tokopedia\.com)$/u.test(url.hostname) &&
        { listingProof: signPublicTitle(secret, {
          owner: res.locals.ownerId, url: url.href, title: 'resolved-listing:' + meta.productUrl,
        }) }),
      ...(meta?.title && meta.title.length <= 160 && { publicTitleProof: signPublicTitle(secret, {
        owner: res.locals.ownerId, url: url.href, title: meta.title,
      }) }),
      ...(meta?.price && { publicPriceProof: signPublicTitle(secret, {
        owner: res.locals.ownerId, url: url.href, title: '', price: meta.price,
      }) }),
      ...(merchant === 'tokopedia' && meta?.productUrl && { productUrl: meta.productUrl }),
      ...((merchant === 'tokopedia' || merchant === 'shopee') && (mysqlImages || imageStorage) && imagePath && { canSaveImage: true }),
      ...(merchant === 'ikea' && mysqlImages && imagePath && { canSaveImage: true }),
      ...(mysqlImages && merchant === 'tokopedia' && meta?.productUrl && imagePath && {
        tokopediaImageProof: signTokopediaImage(secret, {
          owner: res.locals.ownerId, listing: url.href, product: meta.productUrl, image: imagePath,
        }),
      }),
      ...(merchant === 'shopee' && (mysqlImages || imageStorage) && meta?.productUrl && imagePath && {
        shopeeImageProof: signShopeeImage(secret, {
          owner: res.locals.ownerId, listing: url.href, product: meta.productUrl, image: imagePath,
        }),
      }),
      ...(merchant === 'shopee' && meta?.productUrl && { productUrl: meta.productUrl }),
      ...(imagePath && { imagePath }),
      ...(meta?.price && { price: meta.price }),
      ...(meta?.sellerName && { sellerName: meta.sellerName }),
      ...(!meta && !name && { diagnostic: diagnostic ?? { code: canLookUp ? (lookupMetadata ? 'metadata_unavailable' : 'adapter_disabled') : 'unsupported_url', host: url.hostname } }),
      status: imagePath || meta?.price || meta?.sellerName ? 'details_available' : name ? 'name_available' : 'manual_required',
    };
    res.json(result);
  }
  api.post('/products/import', limitProductLookup, (req, res) => importProduct(req, res));
  api.post('/products/import/tokopedia-image', limitProductLookup, async (req, res) => {
    const { url } = z.strictObject({ url: productUrl }).parse(req.body);
    if ((!mysqlImages && !imageStorage) || !lookupMetadata || url.origin !== 'https://www.tokopedia.com' || url.search || url.hash) {
      return res.status(422).json({ error: 'The store photo could not be saved. You can upload your own.' });
    }
    try {
      const metadata = await lookupMetadata(url);
      const bytes = metadata?.image && await downloadTokopediaImage(metadata.image);
      const photo = bytes && (mysqlImages ? await compressProductImage(bytes) : bytes);
      const imageKey = photo && await (mysqlImages ?? imageStorage)?.storeJpeg(res.locals.ownerId, photo);
      if (imageKey) return res.status(201).json({ imageKey });
    } catch {
      // Keep temporary retailer and storage URLs out of logs and responses.
    }
    return res.status(422).json({ error: 'The store photo could not be saved. You can upload your own.' });
  });
  api.get('/products/import/image', limitProductLookup, async (req, res) => {
    const { url } = z.strictObject({ url: productUrl }).parse(req.query);
    const listing = identifyProduct(url.href);
    if (listing?.merchant !== 'IKEA') return notFound(res);
    const image = await productMedia(listing.canonicalUrl);
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
  api.use(async (error: unknown, req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (req.method === 'POST' && /^\/wishlists\/[0-9a-f-]{36}\/items\/?$/iu.test(req.path) &&
        !(error instanceof z.ZodError) && (error as { status?: unknown } | null)?.status !== 400) {
      _res.locals.productSaveFailed = true;
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'unexpected';
      await affiliate?.recordSystemFailure(code).catch(() => undefined);
    }
    next(error);
  });
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
    if (res.locals.productSaveRequestId) {
      const issue = error.issues[0];
      const field = issue?.path[0];
      const message = field === 'name' ? 'Enter a product name up to 160 characters.' :
        field === 'quantity' ? 'Enter a whole number from 1 to 999.' :
        field === 'priceMinor' ? 'Check the product price and try again.' :
        field === 'url' ? 'Enter a valid HTTP or HTTPS product link, or leave it blank.' :
        'Check the product details. If the problem continues, reopen the form.';
      res.locals.productSaveCode = 'invalid_product_details';
      res.status(400).json({ code: 'invalid_product_details', error: message });
      return;
    }
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
  if (res.locals.productSaveFailed && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028') {
    res.locals.productSaveCode = 'product_save_transaction_unavailable';
    console.error('Product save failed', { requestId: res.locals.productSaveRequestId, code: error.code, status: 503 });
    res.status(503).json({ code: res.locals.productSaveCode, error: 'Saving took too long. Your details are still here. Wait a moment and try saving again.' });
    return;
  }
  if (res.locals.productSaveFailed && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    console.error('Request failed', { type: error.name, code: error.code });
    res.status(409).json({ error: 'This save may already be in your wishlist. Refresh the list and check before submitting again.' });
    return;
  }
  if (res.locals.productSaveFailed && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
    console.error('Request failed', { type: error.name, code: error.code });
    res.status(409).json({ error: 'This save conflicted with another update. Refresh your wishlist and check whether the product was added before trying again.' });
    return;
  }
  const safeCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
  console.error('Request failed', { type: error instanceof Error ? error.name : 'unknown', ...(safeCode && { code: safeCode }) });
  res.status(500).json({ error: res.locals.productSaveFailed
    ? 'Could not save the product. Your details are still here. Refresh your wishlist and check whether it was added before trying again.'
    : 'Something went wrong. Try again.' });
};
