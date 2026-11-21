import { Router, json } from 'express';
import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { validateDesign } from '../shared/creator-design.js';
import { safeImportUrl, productMerchant } from '../shared/product-import.js';
import { currencies } from '../shared/wishlist.js';
import { boundedJpeg, downloadShopeeImage, downloadTokopediaImage } from './tokopedia-metadata.js';
import type { CreatorCatalogRepository } from './prisma-creator-catalog.js';
import type { previewProductMetadata } from './product-preview.js';
import type { createProductMedia } from './product-media.js';

export type CreatorMedia = {
  lookupMetadata?: typeof previewProductMetadata;
  productMedia: ReturnType<typeof createProductMedia>;
};

const catalogPath = '/creator/catalog';
const publicPath = '/creator/storefront';
const productPath = catalogPath + '/products/:id';
const uuid = z.uuid();
const publication = z.strictObject({ published: z.boolean() });
const product = z.strictObject({
  title: z.string().trim().min(1).max(160),
  url: z.string().trim().max(2048).refine(value => Boolean(safeImportUrl(value)), 'Enter a valid product link.'),
  description: z.string().trim().max(1000),
  category: z.string().trim().max(60),
  priceMinor: z.number().int().min(0).max(2147483647).nullish(),
  currency: z.enum(currencies).nullish(),
  photo: z.base64().max(260000).nullable().optional(),
}).refine(input => (input.priceMinor == null) === (input.currency == null), {
  path: ['priceMinor'], message: 'Enter a price and choose its currency.',
});

function missing(res: Response) {
  return res.status(404).json({ code: 'creator_resource_not_found', error: 'This creator resource could not be found.' });
}
function invalid(res: Response, error: z.ZodError) {
  return res.status(400).json({ code: 'invalid_product', error: 'Check the product details.', fields: error.flatten().fieldErrors });
}

export function creatorCatalogRoutes(
  repository: CreatorCatalogRepository,
  session: (req: Request) => Promise<{ userId: string } | null>,
  media?: CreatorMedia,
) {
  const router = Router();
  const imageLimit = rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many photo requests. Try again shortly.' } });
  router.use(catalogPath, async (req, res, next) => {
    const current = await session(req);
    if (!current) return res.status(401).json({ error: 'Sign in to continue.' });
    const profile = await repository.profile(current.userId);
    if (!profile) return res.status(403).json({ error: 'Create a Creator profile first.' });
    res.locals.creator = { userId: current.userId, profileId: profile.id };
    next();
  });

  router.get(catalogPath, async (_req, res) => {
    const catalog = await repository.catalog(res.locals.creator.userId);
    if (!catalog) return missing(res);
    const { products, publishedDesign, ...profile } = catalog;
    res.json({ ...profile, publishedDesign: publishedDesign ? validateDesign(publishedDesign) : null,
      products: products.map(({ hasPhoto, ...item }) => ({ ...item,
        image: hasPhoto ? '/api/account' + catalogPath + '/products/' + item.id + '/photo' : null,
      })),
    });
  });
  const productJson = json({ limit: '275kb', inflate: false });
  async function save(req: Request, res: Response) {
    const input = product.safeParse(req.body);
    if (!input.success) return invalid(res, input.error);
    const { priceMinor, currency, photo, ...fields } = input.data;
    const bytes = photo == null ? photo : Buffer.from(photo, 'base64');
    if (bytes && (!boundedJpeg(bytes) || bytes.length > 195000)) {
      return res.status(400).json({ error: 'Choose a valid JPEG photo.' });
    }
    const result = await repository.save(res.locals.creator.profileId, uuid.parse(req.params.id), {
      ...fields, priceMinor: priceMinor ?? null, currency: currency ?? null,
    }, bytes, req.method === 'PATCH');
    if (result === 'missing') return missing(res);
    if (result === 'conflict') return res.status(409).json({ error: 'This draft already exists. Reopen it from your catalog to edit it.' });
    res.json({ saved: true });
  }
  router.put(productPath, productJson, save);
  router.patch(productPath, productJson, save);
  router.put(productPath + '/publication', async (req, res) => {
    if (!await repository.productPublication(res.locals.creator.profileId, uuid.parse(req.params.id),
      publication.parse(req.body).published)) return missing(res);
    res.sendStatus(204);
  });
  router.delete(productPath, async (req, res) => {
    if (!await repository.remove(res.locals.creator.profileId, uuid.parse(req.params.id))) return missing(res);
    res.sendStatus(204);
  });
  router.put(catalogPath + '/publication', async (req, res) => {
    if (!await repository.storefrontPublication(res.locals.creator.userId, publication.parse(req.body).published)) return missing(res);
    res.sendStatus(204);
  });

  router.get(productPath + '/photo', async (req, res) => {
    const image = await repository.privatePhoto(res.locals.creator.userId, uuid.parse(req.params.id));
    if (!image?.photo) return missing(res);
    res.type('image/jpeg').send(Buffer.from(image.photo));
  });
  router.patch(catalogPath + '/settings', async (req, res) => {
    const { name } = z.strictObject({ name: z.string().trim().min(1).max(100)
      .refine(value => !/[\p{Cc}\p{Cf}]/u.test(value), 'Enter a valid storefront name.') }).parse(req.body);
    if (!await repository.renameStorefront(res.locals.creator.userId, name)) return missing(res);
    res.sendStatus(204);
  });
  router.post(catalogPath + '/import-photo', imageLimit, async (req, res) => {
    const { url: value } = z.strictObject({ url: z.string().max(2048) }).parse(req.body);
    const url = safeImportUrl(value);
    let bytes: Buffer | null = null;
    if (url && media) {
      const merchant = productMerchant(url.hostname);
      if ((merchant === 'tokopedia' || merchant === 'shopee') && media.lookupMetadata) {
        const result = await media.lookupMetadata(url).catch(() => null);
        const download = merchant === 'tokopedia' ? downloadTokopediaImage : downloadShopeeImage;
        if (result?.image) bytes = await download(result.image);
      }
      if (!bytes && merchant === 'ikea') {
        const thumbnail = await media.productMedia(url.href);
        if (thumbnail?.type === 'image/jpeg' && thumbnail.bytes.length <= 195000) bytes = thumbnail.bytes;
      }
    }
    if (!bytes || !boundedJpeg(bytes)) return res.status(422).json({ error: 'The store photo could not be saved. You can upload your own.' });
    res.type('image/jpeg').send(bytes);
  });

  router.get(publicPath + '/:handle', async (req, res) => {
    const handle = uuid.safeParse(req.params.handle);
    if (!handle.success) return missing(res);
    const storefront = await repository.storefront(handle.data);
    if (!storefront) return missing(res);
    res.json({ name: storefront.name, design: validateDesign(storefront.publishedDesign),
      products: storefront.products.map(({ hasPhoto, ...item }) => ({ ...item, image: hasPhoto
        ? '/api/account' + publicPath + '/' + handle.data + '/products/' + item.id + '/photo' : null })),
    });
  });
  router.get(publicPath + '/:handle/products/:id/photo', async (req, res) => {
    const handle = uuid.safeParse(req.params.handle);
    const id = uuid.safeParse(req.params.id);
    if (!handle.success || !id.success) return missing(res);
    const image = await repository.publicPhoto(handle.data, id.data);
    if (!image?.photo) return missing(res);
    res.type('image/jpeg').send(Buffer.from(image.photo));
  });
  return router;
}
