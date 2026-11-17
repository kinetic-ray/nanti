import { randomUUID } from 'node:crypto';
import express from 'express';
import type { ErrorRequestHandler, Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { currencies, safeProductUrl } from '../shared/wishlist.js';
import { readWishlist } from './wishlist.js';
import type { WishlistRepository } from './wishlist.js';

const uuid = z.uuid();
const listName = z.string().trim().min(1, 'Enter a wishlist name.').max(100);
const listInput = z.strictObject({ name: listName, currency: z.enum(currencies) });
const renameInput = z.strictObject({ name: listName });
const productUrl = z.string().trim().max(2048).transform((value, context) => {
  const parsed = safeProductUrl(value);
  if (parsed) return parsed;
  context.addIssue({ code: 'custom', message: 'Enter a valid HTTP or HTTPS product link.' });
  return z.NEVER;
});
const itemInput = z.strictObject({
  name: z.string().trim().min(1, 'Enter a product name.').max(160),
  url: productUrl.transform((url) => url.href).nullable(),
  priceMinor: z.number().int().min(0).max(999_999_999).nullable(),
  quantity: z.number().int().min(1).max(999),
});

type Options = {
  repository: WishlistRepository;
  preview: (url: URL) => Promise<string | null>;
  secret: string;
  secureCookies: boolean;
  webRoot?: string;
};

function notFound(response: Response) {
  response.status(404).json({ error: 'This wishlist or item could not be found.' });
}

export function createApp({ repository, preview, secret, secureCookies, webRoot }: Options) {
  const app = express();
  const api = express.Router();
  const cookieName = secureCookies ? '__Host-nanti' : 'nanti';
  app.disable('x-powered-by');
  app.use(helmet(secureCookies ? {} : {
    strictTransportSecurity: false,
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
  }));
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(rateLimit({
    windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many requests. Try again in a minute.' },
  }));
  api.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
        (req.get('X-Nanti-Request') === '1' && req.is('application/json'))) {
      next();
      return;
    }
    res.status(403).json({ error: 'Request could not be verified.' });
  });
  api.use(express.json({ limit: '12kb' }), cookieParser(secret));

  api.post('/session', async (req, res) => {
    const session = uuid.safeParse(req.signedCookies[cookieName]);
    const ownerId = session.success ? session.data : randomUUID();
    const lists = session.success ? await repository.list(ownerId) : [];
    res.cookie(cookieName, ownerId, {
      signed: true, httpOnly: true, secure: secureCookies, sameSite: 'strict',
      path: '/', maxAge: 365 * 24 * 60 * 60 * 1000,
    });
    res.json(lists);
  });

  api.use((req, res, next) => {
    const session = uuid.safeParse(req.signedCookies[cookieName]);
    if (!session.success) {
      res.status(401).json({ error: 'Refresh to start a wishlist session.' });
      return;
    }
    res.locals.ownerId = session.data;
    next();
  });

  api.get('/wishlists', async (_req, res) => {
    res.json(await repository.list(res.locals.ownerId));
  });
  api.post('/wishlists', async (req, res) => {
    res.status(201).json(await repository.create(res.locals.ownerId, listInput.parse(req.body)));
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

  api.post('/products/preview', rateLimit({
    windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many lookups. Enter the product details below.' },
  }), async (req, res) => {
    const { url } = z.strictObject({ url: productUrl }).parse(req.body);
    const name = await preview(url);
    res.json(name ? { name } : { name: null });
  });

  api.use((_req, res) => notFound(res));
  app.use('/api', api);

  if (webRoot) {
    app.use(express.static(webRoot, { dotfiles: 'deny' }));
  }
  app.use((_req, res) => notFound(res));
  app.use(handleError);
  return app;
}

const handleError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.issues[0]?.message ?? 'Check the details you entered.' });
    return;
  }
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 400 || status === 413 || status === 415) {
    res.status(status).json({ error: 'The request body is invalid or too large.' });
    return;
  }
  console.error('Request failed', { type: error instanceof Error ? error.name : 'unknown' });
  res.status(500).json({ error: 'Something went wrong. Try again.' });
};
