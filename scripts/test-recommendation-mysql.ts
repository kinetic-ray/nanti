import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectDatabase } from '../server/database.js';

const url = process.env.DATABASE_URL;
const target = url && new URL(url);
const local = target && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname);
if (!url || !target || !local || (target.pathname !== '/nanti_migration_test' &&
    (url !== process.env.TEST_DATABASE_URL || !/_test$/u.test(target.pathname)))) {
  throw new Error('Recommendation DB smoke tests require a disposable local test schema.');
}
const db = connectDatabase(url);
const ownerId = randomUUID();
const key = randomUUID().replace(/-/gu, '').padEnd(64, '0');
let productId: string | null = null;
let requestId: string | null = null;
try {
  const product = await db.curatedRecommendation.create({
    data: { title: 'Brodo Nexus White', url: 'https://www.tokopedia.com/brodo/nexus',
      category: 'sneakers', color: 'white', currency: 'IDR', priceMinor: 80000000,
      priceVerified: true, priceVerifiedAt: new Date(), published: true },
  });
  productId = product.id;
  assert.equal(product.fulfillmentCursor, null);
  const cursor = randomUUID();
  await db.curatedRecommendation.update({ where: { id: product.id }, data: { fulfillmentCursor: cursor } });
  assert.equal((await db.curatedRecommendation.findUniqueOrThrow({ where: { id: product.id } })).fulfillmentCursor, cursor);

  const entry = await db.recommendationRequest.create({
    data: { ownerId, productKey: key, productName: 'New Balance 540 White',
      sourceCategory: 'sneakers', sourceColor: 'white', sourceCurrency: 'IDR',
      sourcePriceMinor: 100000000 },
  });
  requestId = entry.id;
  assert.equal(entry.status, 'pending');
  const claim = await db.recommendationRequest.updateMany({
    where: { id: entry.id, status: 'pending' }, data: { status: 'fulfilled', fulfilledAt: new Date() },
  });
  assert.equal(claim.count, 1);
  assert.equal((await db.recommendationRequest.updateMany({
    where: { id: entry.id, status: 'pending' }, data: { status: 'fulfilled' },
  })).count, 0);

  await db.recommendationNotice.createMany({ data: [{ requestId: entry.id, productId: product.id }], skipDuplicates: true });
  await db.recommendationNotice.createMany({ data: [{ requestId: entry.id, productId: product.id }], skipDuplicates: true });
  assert.equal(await db.recommendationNotice.count({ where: { requestId: entry.id } }), 1);
  assert.equal((await db.recommendationNotice.findFirstOrThrow({ where: { requestId: entry.id } })).readAt, null);
  await db.recommendationNotice.updateMany({ where: { requestId: entry.id, readAt: null }, data: { readAt: new Date() } });
  assert.ok((await db.recommendationNotice.findFirstOrThrow({ where: { requestId: entry.id } })).readAt);
  console.log('Recommendation MySQL smoke test passed: catalog, cursor, request claim, notice dedup, read status.');
} finally {
  if (requestId) await db.recommendationRequest.delete({ where: { id: requestId } });
  if (productId) await db.curatedRecommendation.delete({ where: { id: productId } });
  await db.$disconnect();
}
