import { Prisma, type PrismaClient } from './generated/prisma/client.js';
import { createMysqlImageStorage } from './mysql-image-storage.js';
import { productKey } from './product-identity.js';
import { catalogUrl, destinationFields, effectiveMapping } from './effective-product-url.js';
import { currencies } from '../shared/wishlist.js';

const select = { id: true, title: true, merchant: true, canonicalUrl: true,
  activeMapping: { select: destinationFields } } satisfies Prisma.ProductIdentitySelect;
const visible = { OR: [{ items: { some: {} } }, { mappings: { some: {} } }] } satisfies Prisma.ProductIdentityWhereInput;
const pageSize = 25;

export function adminProducts(db: PrismaClient) {
  async function summary(row: Prisma.ProductIdentityGetPayload<{ select: typeof select }>) {
    const [image, price] = await Promise.all([
      db.productImage.findFirst({ where: { marketplaceIdentityId: row.id, itemId: { not: null } },
        select: { id: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      db.priceObservation.findFirst({ where: { marketplaceIdentityId: row.id }, orderBy: { id: 'desc' },
        select: { priceMinor: true, currency: true } }),
    ]);
    const currency = currencies.find(value => value === price?.currency);
    return { id: row.id, title: row.title, merchant: row.merchant, replaced: Boolean(effectiveMapping(row)),
      image: image ? `/api/admin/products/${row.id}/photo` : null,
      price: price && currency ? { priceMinor: price.priceMinor, currency } : null };
  }

  return {
    async listProducts(input: { q?: string; after?: string; state?: 'original' | 'replacement' }) {
      const where: Prisma.ProductIdentityWhereInput = { AND: [visible,
        ...(input.q ? [{ OR: [{ title: { contains: input.q } }, { merchant: { contains: input.q } }] }] : []),
        ...(input.state === 'replacement' ? [{ activeMapping: { isNot: null } }] : []),
      ] };
      const matches: Prisma.ProductIdentityGetPayload<{ select: typeof select }>[] = [];
      let cursor = input.after;
      while (matches.length <= pageSize) {
        const rows = await db.productIdentity.findMany({ where, select, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: pageSize + 1, ...(cursor && { cursor: { id: cursor }, skip: 1 }) });
        for (const row of rows) {
          if (!input.state || Boolean(effectiveMapping(row)) === (input.state === 'replacement')) matches.push(row);
        }
        if (rows.length <= pageSize) break;
        cursor = rows.at(-1)?.id;
      }
      const records = matches.slice(0, pageSize);
      return { records: await Promise.all(records.map(summary)), next: matches.length > pageSize ? records.at(-1)!.id : null };
    },
    async productDetail(id: string) {
      const row = await db.productIdentity.findFirst({ where: { id, ...visible }, select });
      if (!row) return null;
      const originalUrl = catalogUrl(row.canonicalUrl, row.merchant);
      return { ...await summary(row), originalUrl, url: effectiveMapping(row)?.affiliateUrl ?? originalUrl };
    },
    async productPhoto(id: string) {
      const image = await db.productImage.findFirst({ where: { marketplaceIdentityId: id, itemId: { not: null } },
        select: { id: true, itemId: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      return image?.itemId ? createMysqlImageStorage(db).readJpeg(`mysql/${image.id}.jpg`, image.itemId) : null;
    },
    async replaceProductUrl(id: string, input: string, actor: string) {
      return db.$transaction(async tx => {
        const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM ProductIdentity WHERE id = ${id} FOR UPDATE`;
        if (!locked) return null;
        const row = await tx.productIdentity.findFirst({ where: { id, ...visible }, select });
        if (!row) return null;
        const current = effectiveMapping(row);
        const original = catalogUrl(row.canonicalUrl, row.merchant);
        const restore = input === original;
        const effective = current?.affiliateUrl ?? original;
        if (effective === input && (!restore || !row.activeMapping)) return { url: effective, replaced: Boolean(current) };
        const previous = row.activeMapping;
        if (previous) await tx.affiliateMapping.update({ where: { id: previous.id }, data: {
          activeIdentityId: null, status: 'disabled', revision: { increment: 1 },
        } });
        const next = restore ? null : await tx.affiliateMapping.create({ data: {
          identityId: id, activeIdentityId: id, originalUrl: row.canonicalUrl, affiliateUrl: input,
          candidateKey: productKey(`direct:${crypto.randomUUID()}`), status: 'approved', directReplacement: true,
          classification: 'insufficient', approvedBy: actor, approvedAt: new Date(),
        }, select: { id: true } });
        const mappingId = next?.id ?? previous?.id;
        if (mappingId) await tx.affiliateAudit.create({ data: {
          identityId: id, mappingId, actor, action: restore ? 'original_restored' : 'destination_replaced',
          details: { previousUrl: effective, effectiveUrl: input },
        } });
        return { url: input, replaced: !restore };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    },
  };
}
