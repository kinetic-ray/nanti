import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { PurchaseDestination } from '../shared/affiliate.js';
import { safeProductUrl } from '../shared/wishlist.js';
import type { AffiliateRepository } from './prisma-affiliate.js';
import { identifyProduct, isEligibleAffiliate } from './product-identity.js';
import type { WishlistRepository } from './wishlist.js';

const ids = z.strictObject({ listId: z.uuid(), itemId: z.uuid() });
const proof = z.string().regex(/^[0-9a-f]{64}$/u);
const ticket = z.strictObject({ source: proof, mapping: proof, lang: z.enum(['id', 'en']).default('id') });
const prefix = '/wishlists/:listId/items/:itemId/purchase';

function matches(left: string, right: string) {
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

async function activeAffiliate(affiliate: AffiliateRepository | undefined, originalUrl: string) {
  const identity = identifyProduct(originalUrl);
  if (!affiliate || !identity) return null;
  const record = await affiliate.activeDestination(identity.lookupKey);
  const mapping = record?.activeMapping;
  if (!record || !mapping) return null;
  if (mapping.status === 'approved' && mapping.classification === 'verified_exact' && mapping.identityId === record.id &&
      mapping.approvedAt && mapping.validatedAt && mapping.approvedBy &&
      (mapping.evidence as { confirmedExact?: boolean } | null)?.confirmedExact === true &&
      record.canonicalUrl === identity.canonicalUrl && mapping.originalUrl === identity.canonicalUrl &&
      isEligibleAffiliate(originalUrl, mapping.affiliateUrl)) {
    return mapping;
  }
  try {
    await affiliate.invalidateMapping(record.id, mapping.id, mapping.revision);
  } catch { console.error('Could not record an invalid affiliate mapping.'); }
  return null;
}

export function purchaseDestinationRoutes(wishlists: WishlistRepository, affiliate: AffiliateRepository | undefined, secret: string) {
  const router = Router();

  function sign(domain: string, values: string[]) {
    return createHmac('sha256', secret).update(JSON.stringify([domain, values])).digest('hex');
  }
  async function read(ownerId: string, listId: string, itemId: string) {
    const list = await wishlists.find(ownerId, listId);
    const item = list?.items.find(({ id }) => id === itemId);
    if (!item) return null;
    const originalUrl = item.url ? safeProductUrl(item.url)?.href ?? null : null;
    const source = originalUrl ? sign('purchase-source', [ownerId, listId, itemId, originalUrl]) : null;
    return { originalUrl, source };
  }

  router.get(prefix, async (req, res) => {
    const { listId, itemId } = ids.parse(req.params);
    const listing = await read(res.locals.ownerId, listId, itemId);
    if (!listing) {
      res.status(404).json({ error: 'This wishlist or item could not be found.' });
      return;
    }
    const { originalUrl, source } = listing;
    const mapping = originalUrl && source ? await activeAffiliate(affiliate, originalUrl) : null;
    const body: PurchaseDestination = { originalUrl, affiliatePath: null };
    if (mapping && source) {
      const signed = sign('purchase-affiliate', [source, mapping.id, String(mapping.revision), mapping.affiliateUrl]);
      body.affiliatePath = `/api/wishlists/${listId}/items/${itemId}/purchase/open?source=${source}&mapping=${signed}`;
    }
    res.json(body);
  });

  router.get(`${prefix}/open`, async (req, res) => {
    const { listId, itemId } = ids.parse(req.params);
    const input = ticket.safeParse(req.query);
    const listing = await read(res.locals.ownerId, listId, itemId);
    res.set('Referrer-Policy', 'no-referrer');
    if (!input.success || !listing?.source || !listing.originalUrl || !matches(input.data.source, listing.source)) {
      const en = req.query.lang === 'en';
      const message = en ? 'The saved product changed. Open its details in Nanti again.'
        : 'Produk tersimpan berubah. Buka kembali detailnya di Nanti.';
      res.status(409).type('html').send(`<!doctype html><html lang="${en ? 'en' : 'id'}"><head><meta charset="utf-8"><title>Nanti</title></head><body><main><h1>Nanti</h1><p>${message}</p><a href="/">Nanti</a></main></body></html>`);
      return;
    }
    const { originalUrl, source } = listing;
    const mapping = await activeAffiliate(affiliate, originalUrl);
    const destination = mapping && matches(input.data.mapping,
      sign('purchase-affiliate', [source, mapping.id, String(mapping.revision), mapping.affiliateUrl]))
      ? mapping.affiliateUrl : originalUrl;
    res.redirect(302, destination);
  });
  return router;
}
