import type { Prisma, PrismaClient } from './generated/prisma/client.js';
import { identifyProduct } from './product-identity.js';

export async function getOrCreateProductIdentity(db: Prisma.TransactionClient, url: string) {
  const product = identifyProduct(url);
  if (!product) return null;
  const { hasAttribution: _hasAttribution, ...listing } = product;
  const created = await db.productIdentity.createMany({ data: [{ ...listing, title: null }], skipDuplicates: true });
  const { id } = await db.productIdentity.findUniqueOrThrow({ where: { lookupKey: listing.lookupKey }, select: { id: true } });
  return { id, created: created.count > 0 };
}

export async function notifyNewProduct(db: PrismaClient, identity: { id: string; created: boolean } | null) {
  if (identity?.created) {
    const { id } = identity;
    await db.adminNotification.createMany({
      data: [{ eventKey: `opportunity:${id}`, identityId: id, kind: 'new_opportunity',
        subject: 'Produk baru menunggu ditinjau', targetPath: `/admin?section=links#opportunity-${id}` }],
      skipDuplicates: true,
    }).catch(() => console.error('Product review notification write failed'));
  }
}

export async function indexExistingProducts(db: PrismaClient) {
  let after: string | undefined;
  let linked = 0;
  while (true) {
    const rows = await db.item.findMany({
      where: { id: after ? { gt: after } : undefined, productIdentityId: null, url: { not: null } },
      orderBy: { id: 'asc' }, take: 150, select: { id: true, url: true },
    });
    if (!rows.length) return linked;
    for (const { id, url } of rows) {
      if (!url || !identifyProduct(url)) continue;
      const result = await db.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM Item WHERE id = ${id} AND BINARY url = ${url} AND productIdentityId IS NULL FOR UPDATE
        `;
        if (!locked.length) return null;
        const identity = await getOrCreateProductIdentity(tx, url);
        await tx.item.update({ where: { id }, data: { productIdentityId: identity?.id ?? null } });
        return { identity };
      });
      if (result) {
        linked += 1;
        await notifyNewProduct(db, result.identity);
      }
    }
    after = rows.at(-1)!.id;
  }
}
