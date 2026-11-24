import type { Prisma, PrismaClient } from './generated/prisma/client.js';
import { identifyProduct } from './product-identity.js';

export async function getOrCreateProductIdentity(db: Prisma.TransactionClient, url: string) {
  const product = identifyProduct(url);
  if (!product) return null;
  const { hasAttribution: _hasAttribution, ...listing } = product;
  const created = await db.productIdentity.createMany({ data: [{ ...listing, title: null }], skipDuplicates: true });
  const { id } = await db.productIdentity.findUniqueOrThrow({ where: { lookupKey: listing.lookupKey }, select: { id: true } });
  if (created.count) {
    await db.adminNotification.createMany({
      data: [{ eventKey: `opportunity:${id}`, identityId: id, kind: 'new_opportunity',
        subject: 'Produk baru menunggu ditinjau', targetPath: `/admin?section=links#opportunity-${id}` }],
      skipDuplicates: true,
    });
  }
  return id;
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
      linked += await db.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM Item WHERE id = ${id} AND BINARY url = ${url} AND productIdentityId IS NULL FOR UPDATE
        `;
        if (!locked.length) return 0;
        const productIdentityId = await getOrCreateProductIdentity(tx, url);
        return (await tx.item.updateMany({ where: { id }, data: { productIdentityId } })).count;
      });
    }
    after = rows.at(-1)!.id;
  }
}
