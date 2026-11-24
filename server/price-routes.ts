import { Router } from 'express';
import { z } from 'zod';
import { userPriceSources } from '../shared/prices.js';
import { maxPriceMinor } from '../shared/wishlist.js';
import type { Prices } from './prisma-prices.js';

const ids = z.strictObject({ listId: z.uuid(), itemId: z.uuid() });
const priceMinor = z.number().int().min(0).max(maxPriceMinor);
const cursor = z.string().regex(/^[1-9]\d{0,19}$/u).transform(value => BigInt(value))
  .refine(value => value <= 18_446_744_073_709_551_615n).optional();
const target = z.strictObject({ priceMinor, notify: z.boolean() });
const input = z.strictObject({ priceMinor, source: z.enum(userPriceSources) });
const itemPath = '/wishlists/:listId/items/:itemId/prices';
const missing = { error: 'This wishlist or item could not be found.' };

export function priceRoutes(prices: Prices) {
  const api = Router();
  api.get(itemPath, async (req, res) => {
    const { listId, itemId } = ids.parse(req.params);
    const before = cursor.parse(req.query.before);
    const page = await prices.details(res.locals.ownerId, listId, itemId, before);
    if (!page) { res.status(404).json(missing); return; }
    res.json(page);
  });
  api.post(itemPath, async (req, res) => {
    const { listId, itemId } = ids.parse(req.params);
    const { priceMinor, source } = input.parse(req.body);
    const result = await prices.record(res.locals.ownerId, listId, itemId, priceMinor, source);
    if (result === 'missing') { res.status(404).json(missing); return; }
    if (result === 'link_required') {
      res.status(400).json({ error: 'Save a listing link before recording a price copied from it.' });
      return;
    }
    res.status(result === 'recorded' ? 201 : 200).json({ recorded: result === 'recorded' });
  });
  api.put(`${itemPath}/target`, async (req, res) => {
    const { listId, itemId } = ids.parse(req.params);
    if (!await prices.setTarget(res.locals.ownerId, listId, itemId, target.parse(req.body))) {
      res.status(404).json(missing);
      return;
    }
    res.sendStatus(204);
  });
  api.delete(`${itemPath}/target`, async (req, res) => {
    const { listId, itemId } = ids.parse(req.params);
    if (!await prices.setTarget(res.locals.ownerId, listId, itemId, null)) {
      res.status(404).json(missing);
      return;
    }
    res.sendStatus(204);
  });
  api.get('/prices/alerts', async (_req, res) => res.json(await prices.inbox(res.locals.ownerId)));
  api.patch('/prices/alerts', async (req, res) => {
    z.strictObject({}).parse(req.body);
    await prices.markRead(res.locals.ownerId);
    res.sendStatus(204);
  });
  return api;
}
