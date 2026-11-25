import { parseArgs } from 'node:util';
import { connectDatabase } from '../server/database.js';
import { previewProductMetadata } from '../server/product-preview.js';
import { safeImportUrl } from '../shared/product-import.js';
import { identifyCatalogProduct } from '../server/product-identity.js';

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
    where: { ...(values.after && { id: { gt: values.after } }) },
    select: { id: true, title: true, canonicalUrl: true, lookupKey: true, merchant: true },
    orderBy: { id: 'asc' }, take: limit,
  });
  const findings = { reclassified: 0, duplicates: 0, changedKeys: 0, missingTitles: 0, recoverableTitles: 0,
    recoveredTitles: 0, missingPublicImages: 0, missingPublicPrices: 0, mismatchedOccurrences: 0 };
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
    const url = safeImportUrl(row.canonicalUrl);
    const identity = url && identifyCatalogProduct(url.href);
    const reclassified = Boolean(identity && identity.merchant !== row.merchant);
    const eligible = url && identity && identity.merchant !== 'Other' &&
      (identity.merchant !== 'IKEA' || process.env.NANTI_IKEA_METADATA_PERMISSION === 'granted');
    const metadata = values.refresh && (!row.title || identity?.market === 'global' ||
      (identity?.merchant === 'Tokopedia' && url?.hostname !== 'www.tokopedia.com')) && eligible
      ? await previewProductMetadata(url).catch(() => null) : null;
    const resolved = metadata?.productUrl && identifyCatalogProduct(metadata.productUrl);
    const target = resolved || identity;
    const changedKey = Boolean(target && target.lookupKey !== row.lookupKey);
    const duplicate = target && changedKey ? await db.productIdentity.findUnique({
      where: { lookupKey: target.lookupKey }, select: { id: true },
    }) : null;
    const recoveredTitle = !row.title && metadata?.title?.trim().slice(0, 160);
    const updated = values.apply && recoveredTitle && !changedKey ? await db.productIdentity.updateMany({
      where: { id: row.id, lookupKey: row.lookupKey, canonicalUrl: row.canonicalUrl, title: null }, data: { title: recoveredTitle },
    }) : null;
    findings.reclassified += Number(reclassified);
    findings.changedKeys += Number(changedKey);
    findings.duplicates += Number(Boolean(duplicate));
    findings.missingTitles += Number(!row.title);
    findings.recoverableTitles += Number(Boolean(recoveredTitle));
    findings.recoveredTitles += updated?.count ?? 0;
    findings.missingPublicImages += Number(!photo);
    findings.missingPublicPrices += Number(!price);
    findings.mismatchedOccurrences += mismatched;
    if (row.title && photo && price && !mismatched && !changedKey && !reclassified) continue;
    console.log(JSON.stringify({
      id: row.id, merchant: row.merchant, detectedMerchant: identity?.merchant, changedKey, duplicateOf: duplicate?.id,
      title: row.title ? 'present' : updated?.count ? 'recovered' : recoveredTitle ? 'recoverable' :
        values.refresh ? 'unavailable-from-refresh' : 'missing',
      image: photo ? 'public' : unmarkedPhoto ? 'legacy-provenance-unavailable' : 'missing',
      price: price ? 'public' : unmarkedPrice ? 'legacy-provenance-unavailable' : 'missing',
      mismatchedOccurrences: mismatched,
    }));
  }
  console.log(JSON.stringify({ mode: values.apply ? 'apply' : 'dry-run', inspected: rows.length, findings,
    next: rows.length === limit ? rows.at(-1)?.id : null }));
} finally {
  await db.$disconnect();
}
