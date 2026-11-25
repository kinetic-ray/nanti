import { testDatabaseUrl } from './test-database-url.mjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { getOrCreateProductIdentity } from '../server/catalog-ingestion.js';
import { mutation, path, recommendationFixture, image } from './recommendation-workspace-fixture.js';

const databaseUrl = testDatabaseUrl;

it.skipIf(!databaseUrl)('requires the configured Superadmin session for the recommendation workspace', async () => {
  const fixture = await recommendationFixture(databaseUrl!, false);
  try {
    const root = request.agent(fixture.app).set(mutation);
    await request(fixture.app).get(path).expect(401);
    await request(fixture.app).post(path + '/preview').set(mutation).send({ url: fixture.listing }).expect(401);
    await root.post('/api/admin/login').send({ username: fixture.username, password: fixture.password }).expect(200);
    await root.get(path).expect(404);
  } finally { await fixture.close(); }
});

it.skipIf(!databaseUrl)('curates marketplace metadata and keeps identity, publication, private wishlist data and audit consistent', async () => {
  const fixture = await recommendationFixture(databaseUrl!);
  const { db, app, listing, curation } = fixture;
  const root = request.agent(app).set(mutation);

  try {
    await root.get(path).expect(401);
    await root.post('/api/admin/login').send({ username: fixture.username, password: fixture.password }).expect(200);
    await root.post(path + '/preview').set('Sec-Fetch-Site', 'cross-site').send({ url: listing }).expect(403);
    await root.post(path + '/preview').send({ url: 'https://127.0.0.1/private' }).expect(400);
    await root.post(path + '/preview').send({ url: 'https://tk.tokopedia.com/unresolved' }).expect(422);
    await root.post(path + '/preview').send({ url: 'https://www.tokopedia.com/?redirect=https://example.com' }).expect(400);
    const identity = await db.$transaction(tx => getOrCreateProductIdentity(tx, listing));
    expect(identity).not.toBeNull();
    const consumer = request.agent(app).set(mutation);
    await consumer.post('/api/session').send({}).expect(200);
    const bootstrap = (await consumer.post('/api/wishlists').send({ name: 'Private wishlist', currency: 'IDR' }).expect(201)).body;
    const sessionWishlist = await db.wishlist.findUniqueOrThrow({ where: { id: bootstrap.id } });
    try {
      const item = await db.item.create({ data: {
        wishlistId: sessionWishlist.id, ownerId: sessionWishlist.ownerId, productIdentityId: identity!.id,
        name: 'New Balance 540 White Private label', url: listing, priceMinor: 100000000, quantity: 1, imageKey: 'private-image',
      } });
      const sourceIdentity = await db.$transaction(tx => getOrCreateProductIdentity(tx, fixture.source));
      expect(sourceIdentity).not.toBeNull();
      const source = await db.item.create({ data: {
        wishlistId: sessionWishlist.id, ownerId: sessionWishlist.ownerId, name: fixture.title,
        url: fixture.source, priceMinor: 100000000, quantity: 1, productIdentityId: sourceIdentity!.id,
      } });
      const alternative = (itemId: string) => consumer.post('/api/recommendations/alternatives').send({
        itemId, wishlistId: sessionWishlist.id,
        answers: { practicalNeed: true, alreadyHave: false, useOften: true, canWait: true, withoutDiscount: true, socialPressure: false },
        finances: { cashMinor: '50000000', billsMinor: '10000000', setAsideMinor: '10000000' },
      }).expect(200);
      async function expectCandidate(id: string, present: boolean, itemId = source.id) {
        const response = await alternative(itemId);
        expect(response.body.alternatives.some((match: { product: { id: string } }) => match.product.id === id)).toBe(present);
        return response.body.alternatives.find((match: { product: { id: string } }) => match.product.id === id);
      }

      const originalUrl = listing + '?utm_source=fixture';
      const preview = (await root.post(path + '/preview').send({ url: originalUrl }).expect(200)).body;
      expect(preview.metadata).toMatchObject({ title: fixture.title, originalUrl, image, price: { priceMinor: 80000000, currency: 'IDR' } });
      await root.post(path).send({ curation, preview: { ...preview, metadata: { ...preview.metadata, image: '/api/private' } } }).expect(409);
      const creates = await Promise.all([root.post(path).send({ curation, preview }), root.post(path).send({ curation, preview })]);
      expect(creates.map(result => result.status).sort()).toEqual([201, 409]);
      const product = creates.find(result => result.status === 201)!.body;
      expect(product).toMatchObject({ importedTitle: fixture.title, image, status: 'draft', url: originalUrl, marketplace: 'Tokopedia' });
      expect(product).not.toHaveProperty('productIdentityId');
      const row = await db.curatedRecommendation.findUniqueOrThrow({ where: { id: product.id } });
      expect(row.productIdentityId).toBe(identity!.id);
      expect(row.priceMinor).toBe(80000000);
      expect(await db.item.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
        name: item.name, priceMinor: item.priceMinor, imageKey: item.imageKey,
      });
      expect(await db.item.count({ where: { productIdentityId: identity!.id } })).toBe(1);
      expect(JSON.stringify(product)).not.toContain('Private label');

      const manual = (await root.post(path + '/preview').send({ url: fixture.missing }).expect(200)).body;
      expect(manual.metadata).toMatchObject({ title: null, image: null, price: null });
      const manualProduct = (await root.post(path).send({ curation: { ...curation, title: fixture.title + ' manual', category: 'manual-' + fixture.title },
        preview: manual }).expect(201)).body;
      expect(manualProduct).toMatchObject({ importedTitle: null, image: null, price: null, status: 'draft' });
      for (const page of [1, 2]) {
        const results = (await root.get(path).query({ q: fixture.title, status: 'draft', size: 1, page }).expect(200)).body;
        expect(results.total).toBe(2);
        expect(results.products).toHaveLength(1);
      }
      expect((await root.get(path).query({ q: fixture.title, category: 'sneakers' }).expect(200)).body.total).toBe(1);

      const endpoint = path + '/' + product.id;
      const change = (action: string) => root.patch(endpoint + '/lifecycle').send({ action }).expect(204);
      await root.patch(endpoint).send({ curation: { ...curation, title: 'Nama kurasi ' + fixture.title, style: 'Modern' } }).expect(204);
      await expectCandidate(product.id, false);
      await root.patch(path + '/' + manualProduct.id).send({ curation }).expect(204);
      await root.patch(path + '/' + manualProduct.id + '/lifecycle').send({ action: 'publish' }).expect(204);
      await expectCandidate(manualProduct.id, false);
      await change('publish');
      const active = await expectCandidate(product.id, true);
      expect(active.product).not.toHaveProperty('productIdentityId');
      await expectCandidate(product.id, false, item.id);

      const replacement = fixture.source + '-replacement';
      await db.affiliateMapping.create({ data: { identityId: identity!.id, activeIdentityId: identity!.id,
        originalUrl: listing, affiliateUrl: replacement, candidateKey: randomUUID().replaceAll('-', '').padEnd(64, '0'),
        status: 'approved', classification: 'verified_exact', directReplacement: true,
      } });
      const mapped = await expectCandidate(product.id, true);
      await consumer.get(mapped.product.purchasePath).expect(302).expect('Location', replacement);

      await change('unpublish');
      await expectCandidate(product.id, false);
      await change('publish');
      await change('archive');
      await expectCandidate(product.id, false);
      await consumer.get(mapped.product.purchasePath).expect(404);
      expect((await root.get(path).query({ q: fixture.title, status: 'archived' }).expect(200)).body.total).toBe(1);
      await change('restore');
      await expectCandidate(product.id, false);
      expect(await db.curatedRecommendation.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({
        style: 'Modern', published: false, archivedAt: null, importedTitle: fixture.title,
      });
      const audits = await db.workspaceAudit.findMany({ where: { subjectId: product.id } });
      expect(audits.map(event => event.action).sort()).toEqual([
        'recommendation_archived', 'recommendation_created', 'recommendation_published', 'recommendation_published',
        'recommendation_restored', 'recommendation_unpublished', 'recommendation_updated',
      ]);
    } finally {
      await db.dataOwner.deleteMany({ where: { id: sessionWishlist.ownerId } });
    }
  } finally { await fixture.close(); }
}, 30_000);
