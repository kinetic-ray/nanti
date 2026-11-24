import { parseArgs } from 'node:util';
import { connectDatabase } from '../server/database.js';
import { previewProductMetadata } from '../server/product-preview.js';
import { safeImportUrl } from '../shared/product-import.js';
import { identifyProduct } from '../server/product-identity.js';

const { values } = parseArgs({ options: {
  after: { type: 'string' }, limit: { type: 'string', default: '20' },
  refresh: { type: 'boolean' }, apply: { type: 'boolean' },
} });
const limit = Number(values.limit);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !Number.isInteger(limit) || limit < 1 || limit > 50 || (values.apply && !values.refresh)) {
  throw new Error('Set DATABASE_URL, choose a limit of 1–50, and use --refresh with --apply.');
}
const db = connectDatabase(databaseUrl);
try {
  const rows = await db.productIdentity.findMany({
    where: { ...(values.after && { id: { gt: values.after } }), items: { some: {} } },
    select: { id: true, title: true, canonicalUrl: true, lookupKey: true, merchant: true },
    orderBy: { id: 'asc' }, take: limit,
  });
  for (const row of rows) {
    const [photo, price, unmarkedPhoto, unmarkedPrice, mismatched] = await Promise.all([
      db.productImage.count({ where: { marketplaceIdentityId: row.id } }),
      db.priceObservation.count({ where: { marketplaceIdentityId: row.id } }),
      db.productImage.count({ where: { marketplaceIdentityId: null, item: { productIdentityId: row.id } } }),
      db.priceObservation.count({ where: { marketplaceIdentityId: null, source: 'imported_unverified',
        item: { productIdentityId: row.id } } }),
      db.item.count({ where: { productIdentityId: row.id, OR: [
        { productImage: { marketplaceIdentityId: { notIn: [row.id] } } },
        { priceObservations: { some: { marketplaceIdentityId: { notIn: [row.id] } } } },
      ] } }),
    ]);
    if (row.title && photo && price && !mismatched) continue;
    const url = safeImportUrl(row.canonicalUrl);
    const eligible = url && row.merchant !== 'Other' && identifyProduct(url.href)?.lookupKey === row.lookupKey;
    const metadata = values.refresh && !row.title && eligible
      ? await previewProductMetadata(url).catch(() => null) : null;
    const recoveredTitle = metadata?.title?.trim().slice(0, 160);
    const updated = values.apply && recoveredTitle ? await db.productIdentity.updateMany({
      where: { id: row.id, lookupKey: row.lookupKey, title: null }, data: { title: recoveredTitle },
    }) : null;
    console.log(JSON.stringify({
      id: row.id, title: row.title ? 'present' : updated?.count ? 'recovered' : recoveredTitle ? 'recoverable' :
        values.refresh ? 'unavailable-from-refresh' : 'missing',
      image: photo ? 'public' : unmarkedPhoto ? 'legacy-provenance-unavailable' : 'missing',
      price: price ? 'public' : unmarkedPrice ? 'legacy-provenance-unavailable' : 'missing',
      mismatchedOccurrences: mismatched,
    }));
  }
  console.log(JSON.stringify({ mode: values.apply ? 'apply' : 'dry-run', inspected: rows.length,
    next: rows.length === limit ? rows.at(-1)?.id : null }));
} finally {
  await db.$disconnect();
}
