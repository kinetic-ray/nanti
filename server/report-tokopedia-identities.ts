import { connectDatabase } from './database.js';
import { identifyProduct } from './product-identity.js';

const url = process.env.DATABASE_URL;
if (!url?.startsWith('mysql://')) {
  console.error('Set DATABASE_URL to the intended migrated database.');
  process.exit(1);
}

const db = connectDatabase(url);
try {
  let after: string | undefined;
  let affected = 0;
  while (true) {
    const rows = await db.productIdentity.findMany({
      where: { merchant: 'Other', ...(after && { id: { gt: after } }) },
      orderBy: { id: 'asc' },
      take: 100,
      select: {
        id: true, canonicalUrl: true, reviewedAt: true, title: true,
        _count: { select: { items: true, mappings: true, audit: true, notifications: true } },
      },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const product = identifyProduct(row.canonicalUrl);
      if (product?.merchant !== 'Tokopedia') continue;
      const [target, priceObservations] = await Promise.all([
        db.productIdentity.findUnique({
          where: { lookupKey: product.lookupKey },
          select: {
            id: true, reviewedAt: true,
            _count: { select: { items: true, mappings: true, audit: true, notifications: true } },
          },
        }),
        db.priceObservation.count({ where: { item: { productIdentityId: row.id } } }),
      ]);
      affected++;
      console.log(JSON.stringify({
        identityId: row.id,
        canonicalIdentityId: target?.id ?? null,
        reviewed: row.reviewedAt !== null,
        hasCatalogTitle: row.title !== null,
        references: { ...row._count, priceObservations },
        canonicalReferences: target?._count ?? null,
        canonicalReviewed: Boolean(target?.reviewedAt),
        collision: Boolean(target && target.id !== row.id),
      }));
    }
    after = rows.at(-1)!.id;
  }
  console.log(JSON.stringify({ affected, mode: 'read-only' }));
} catch {
  console.error('Could not inspect product identities. Check the database connection and migrations.');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
