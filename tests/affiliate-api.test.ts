import { testDatabaseUrl } from './test-database-url.mjs';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminCredentialScope, digest, hashAdminPassword } from '../server/admin-credentials.js';
import type { AdminCredentials } from '../server/admin-credentials.js';
import { createApp } from '../server/app.js';
import { indexExistingProducts } from '../server/catalog-ingestion.js';
import { connectDatabase } from '../server/database.js';
import { identifyProduct } from '../server/product-identity.js';
import { previewProductMetadata } from '../server/product-preview.js';
import { prismaAffiliate } from '../server/prisma-affiliate.js';
import { prismaIntelligence } from '../server/prisma-intelligence.js';
import { prismaWishlists } from '../server/prisma-wishlists.js';
import { createMysqlImageStorage } from '../server/mysql-image-storage.js';
import { adminProducts } from '../server/admin-products.js';
import type { VerificationEvidence } from '../shared/affiliate.js';
import type { Item } from '../shared/wishlist.js';

const mutation = { 'X-Nanti-Request': '1', 'Content-Type': 'application/json' };
const adminPath = '/api/admin';
const credentials: AdminCredentials = { username: 'affiliate-reviewer', passwordHash: '' };
const password = randomBytes(24).toString('base64url');
const secret = randomBytes(32).toString('hex');
const evidence: VerificationEvidence = {
  title: '  QA Lamp White  ', brand: 'QA brand', model: 'QA-100', sellerId: 'verified retailer',
  variants: { color: 'White', size: 'Small', configuration: 'Single unit' },
  notes: 'Compared article number, store market, product options, and listing evidence.',
  confirmedExact: true,
};

const url = testDatabaseUrl;
describe.skipIf(!url)('Affiliate Center with MySQL', () => {
  const db = connectDatabase(url ?? 'mysql://127.0.0.1/nanti_test');
  const repository = prismaWishlists(db);
  const affiliate = prismaAffiliate(db);
  const options = { repository, affiliate, intelligence: prismaIntelligence(db), admin: credentials, secret,
    secureCookies: false, preview: async () => null };
  const owners = new Set<string>();
  const keys = new Set<string>();
  const noticeKeys = new Set<string>();

  beforeAll(async () => { credentials.passwordHash = await hashAdminPassword(password); });
  // The router derives its session scope when created, after the asynchronous password bootstrap.
  function app(secureCookies = false) { return createApp({ ...options, secureCookies }); }
  async function administrator(application = app()) {
    const agent = request.agent(application);
    const login = await agent.post(`${adminPath}/login`).set(mutation).send({ username: credentials.username, password })
      .expect(200, { username: credentials.username });
    const cookie = String(login.headers['set-cookie']?.[0]).split(';')[0]!;
    return { agent, cookie };
  }
  async function wishlist(application = app()) {
    const agent = request.agent(application);
    const session = await agent.post('/api/session').set(mutation).send({}).expect(200);
    const signed = decodeURIComponent(String(session.headers['set-cookie']?.[0]).split(';')[0]!.slice('nanti='.length));
    const ownerId = signed.slice(2).split('.')[0]!;
    owners.add(ownerId);
    const created = await agent.post('/api/wishlists').set(mutation).send({ name: 'Private wishlist fixture', currency: 'IDR' }).expect(201);
    return { agent, ownerId, wishlistId: created.body.id as string, path: `/api/wishlists/${created.body.id}` };
  }
  function listing() {
    const article = String(randomInt(10_000_000, 99_999_999));
    const canonical = `https://www.ikea.com/us/en/p/local-qa-lamp-white-${article}/`;
    const key = identifyProduct(canonical)!.lookupKey;
    keys.add(key);
    return { article, canonical, key };
  }
  async function add(fixture: Awaited<ReturnType<typeof wishlist>>, url: string | null, name = 'Private item label') {
    await fixture.agent.post(`${fixture.path}/items`).set(mutation)
      .send({ name, priceMinor: 5000, quantity: 2, url }).expect(201);
    const detail = await fixture.agent.get(fixture.path).expect(200);
    return (detail.body.items as Item[]).find((item) => item.name === name)!;
  }

  afterEach(async () => {
    await db.wishlist.deleteMany({ where: { ownerId: { in: [...owners] } } });
    const identities = await db.productIdentity.findMany({ where: { lookupKey: { in: [...keys] } }, select: { id: true } });
    const identityIds = identities.map(({ id }) => id);
    await db.affiliateAudit.deleteMany({ where: { identityId: { in: identityIds } } });
    await db.adminNotification.deleteMany({ where: { identityId: { in: identityIds } } });
    await db.affiliateMapping.deleteMany({ where: { identityId: { in: identityIds } } });
    await db.productIdentity.deleteMany({ where: { id: { in: identityIds } } });
    await db.adminSession.deleteMany({ where: { credentialScope: adminCredentialScope(credentials, secret) } });
    if (noticeKeys.size) await db.adminNotification.deleteMany({ where: { eventKey: { in: [...noticeKeys] } } });
    owners.clear(); keys.clear(); noticeKeys.clear();
  });
  afterAll(() => db.$disconnect());

  it('separates admin authentication, validates mutations, and expires or revokes sessions', async () => {
    const application = app();
    const { agent: anonymous } = await wishlist(application);
    await anonymous.get(`${adminPath}/opportunities`).expect(401);
    await anonymous.post(`${adminPath}/opportunities/${randomUUID()}/mappings`).set(mutation).send({ url: 'https://example.test/' }).expect(401);
    await anonymous.patch(`${adminPath}/notifications/${randomUUID()}`).set(mutation).send({ action: 'dismiss' }).expect(401);
    await anonymous.post(`${adminPath}/login`).send({}).expect(403);
    await anonymous.post(`${adminPath}/login`).set({ ...mutation, 'Sec-Fetch-Site': 'cross-site' })
      .send({ username: credentials.username, password }).expect(403);
    await anonymous.post(`${adminPath}/login`).set(mutation).send({ username: credentials.username, password, role: 'admin' }).expect(401);
    await anonymous.post(`${adminPath}/login`).set(mutation).send({ username: credentials.username, password: 'wrong' }).expect(401);
    const admin = await administrator(application);
    await admin.agent.get(`${adminPath}/session`).expect('Cache-Control', 'no-store').expect(200, { username: credentials.username });
    await admin.agent.get('/api/wishlists').expect(401);
    await admin.agent.patch(`${adminPath}/notifications/${randomUUID()}`).send({ action: 'read' }).expect(403);
    const tokenHash = digest(admin.cookie.slice('nanti-admin='.length));
    const row = await db.adminSession.findUnique({ where: { tokenHash } });
    expect(row?.tokenHash).toBe(tokenHash);
    expect(admin.cookie).not.toContain(tokenHash);
    await admin.agent.post(`${adminPath}/logout`).set(mutation).send({}).expect(204);
    await request(application).get(`${adminPath}/session`).set('Cookie', admin.cookie).expect(401);
    const next = await administrator(application);
    await db.adminSession.update({ where: { tokenHash: digest(next.cookie.slice('nanti-admin='.length)) },
      data: { expiresAt: new Date(0) } });
    await next.agent.get(`${adminPath}/opportunities`).expect(401);
    const secure = await request(app(true)).post(`${adminPath}/login`).set(mutation)
      .send({ username: credentials.username, password }).expect(200);
    const flags = String(secure.headers['set-cookie']?.[0]);
    expect(flags).toMatch(/^__Host-nanti-admin=.*Path=\/.*HttpOnly.*Secure.*SameSite=Strict/u);
    await request(createApp({ ...options, admin: undefined })).get(`${adminPath}/session`)
      .expect(404, { error: 'Administrator sign-in is not configured.' });
  });

  it('rate-limits unsuccessful sign-in attempts', async () => {
    const application = app();
    for (let attempt = 0; attempt < 8; attempt++) {
      await request(application).post(`${adminPath}/login`).set(mutation).send({}).expect(401);
    }
    await request(application).post(`${adminPath}/login`).set(mutation)
      .send({ username: credentials.username, password }).expect(429);
  });

  it('shows the public import title while keeping the saved wishlist label private', async () => {
    const title = 'Public marketplace lamp';
    const application = createApp({ ...options, lookupMetadata: async () => ({ title, image: null, price: null }) });
    const customer = await wishlist(application);
    const sample = listing();
    const forged = listing();
    const preview = await customer.agent.post('/api/products/import').set(mutation).send({ url: sample.canonical }).expect(200);
    expect(preview.body).toMatchObject({ name: title, publicTitleProof: expect.any(String) });
    const data = { name: 'Private gift idea', priceMinor: null, quantity: 1,
      publicTitle: { title, proof: preview.body.publicTitleProof }, url: sample.canonical };
    const requestId = randomUUID();
    for (let replay = 0; replay < 2; replay++) {
      await customer.agent.post(`${customer.path}/items`).set(mutation).set('Idempotency-Key', requestId).send(data).expect(201);
    }
    await customer.agent.post(`${customer.path}/items`).set(mutation).send({ ...data, url: forged.canonical }).expect(201);
    const identity = await db.productIdentity.findUniqueOrThrow({ where: { lookupKey: sample.key }, include: { _count: {
      select: { items: true, notifications: true },
    } } });
    expect(identity).toMatchObject({ title, _count: { items: 1, notifications: 1 } });
    await expect(db.productIdentity.findUniqueOrThrow({ where: { lookupKey: forged.key } })).resolves.toMatchObject({ title: null });
    const admin = await administrator(application);
    const response = await admin.agent.get(`${adminPath}/opportunities`).query({ q: title }).expect(200);
    expect(response.body.records).toEqual([expect.objectContaining({ id: identity.id, title })]);
    expect(response.text).not.toContain(data.name);
  });

  it('publishes only signed prices and marketplace photos with an authorized admin image route', async () => {
    const source = 'https://www.tokopedia.com/test-shop/' + randomUUID();
    const photoUrl = 'https://images.tokopedia.net/test.jpg';
    const photo = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#334455' } }).jpeg().toBuffer();
    keys.add(identifyProduct(source)!.lookupKey);
    const application = createApp({ ...options, mysqlImages: createMysqlImageStorage(db),
      lookupMetadata: async () => ({ productUrl: source, title: 'Public test charger', image: photoUrl,
        price: { priceMinor: 2300000, currency: 'IDR' } }),
      marketplaceImageRequest: async () => new Response(Uint8Array.from(photo), { headers: { 'content-type': 'image/jpeg' } }),
    });
    const customer = await wishlist(application);
    const preview = (await customer.agent.post('/api/products/import').set(mutation).send({ url: source }).expect(200)).body;
    const payload = { name: 'Private label', url: source, priceMinor: 2300000, priceSource: 'imported_unverified', quantity: 1,
      publicTitle: { title: preview.name, proof: preview.publicTitleProof }, publicPriceProof: preview.publicPriceProof,
      saveMarketplaceImage: true, tokopediaProductUrl: source,
      tokopediaImage: { url: photoUrl, proof: preview.tokopediaImageProof } };
    await customer.agent.post(customer.path + '/items').set(mutation).set('Idempotency-Key', randomUUID()).send(payload).expect(201);
    const privateImage = await createMysqlImageStorage(db).storeJpeg(customer.ownerId, photo);
    await customer.agent.post(customer.path + '/items').set(mutation).send({ name: 'Private upload', url: source,
      quantity: 1, priceMinor: 700, priceSource: 'imported_unverified', publicPriceProof: preview.publicPriceProof,
      imageKey: privateImage }).expect(201);
    const admin = await administrator(application);
    const { body } = await admin.agent.get(adminPath + '/products').query({ q: preview.name, state: 'original' }).expect(200);
    expect(body.records).toEqual([expect.objectContaining({ title: preview.name, merchant: 'Tokopedia', replaced: false,
      price: { priceMinor: 2300000, currency: 'IDR' }, image: expect.any(String) })]);
    const [product] = body.records;
    await customer.agent.get(product.image).expect(401);
    await admin.agent.get(product.image).expect('Content-Type', /image\/jpeg/u).expect(200);
    expect(await db.productImage.count({ where: { marketplaceIdentityId: product.id } })).toBe(1);
    expect(await db.priceObservation.count({ where: { marketplaceIdentityId: product.id } })).toBe(1);
  });

  it.each(['short link', 'landing page'])('deduplicates a verified %s and preserves the submitted purchase URL', async kind => {
    const item = randomInt(10_000_000, 99_999_999);
    const direct = 'https://shopee.co.id/product/123/' + item;
    const landing = 'https://shopee.co.id/opaanlp/123/' + item;
    const share = kind === 'short link' ? 'https://s.shopee.co.id/' + randomUUID() : landing;
    const directKey = identifyProduct(direct)!.lookupKey;
    const shareKey = identifyProduct(share)!.lookupKey;
    keys.add(directKey);
    keys.add(shareKey);
    const title = 'Public short-link product';
    const fetchPage: typeof fetch = async target => {
      if (kind === 'short link' && String(target) === share) {
        return new Response(null, { status: 301, headers: { location: landing } });
      }
      const html = String(target) === landing ? '<title>Shopee</title>' :
        '<link rel="canonical" href="' + direct + '"><meta property="og:title" content="' + title + '">';
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    };
    const application = createApp({ ...options, lookupMetadata: target => previewProductMetadata(target, fetchPage) });
    const first = await wishlist(application);
    const second = await wishlist(application);
    const preview = (await first.agent.post('/api/products/import').set(mutation).send({ url: share }).expect(200)).body;
    const payload = { url: share, name: 'Private wishlist label', quantity: 1, priceMinor: null,
      verifiedListing: { url: direct, proof: preview.listingProof },
      publicTitle: { title, proof: preview.publicTitleProof } };
    await first.agent.post(first.path + '/items').set(mutation).send(payload).expect(201);
    const saved = (await first.agent.get(first.path).expect(200)).body.items[0];
    await first.agent.get(first.path + '/items/' + saved.id + '/purchase').expect(200, {
      originalUrl: share, affiliatePath: null,
    });
    await add(second, direct, 'Second private label');
    await second.agent.post(second.path + '/items').set(mutation).send(payload).expect(201);
    const identity = await db.productIdentity.findUniqueOrThrow({ where: { lookupKey: directKey }, select: {
      title: true, items: { select: { ownerId: true, url: true, name: true } },
    } });
    expect(identity).toEqual({ title, items: expect.arrayContaining([
      { ownerId: first.ownerId, url: share, name: payload.name },
      { ownerId: second.ownerId, url: direct, name: 'Second private label' },
    ]) });
    expect(identity.items).toHaveLength(2);
    await expect(db.productIdentity.findUniqueOrThrow({ where: { lookupKey: shareKey } })).resolves.toMatchObject({
      merchant: 'Shopee', title: null,
    });
  });

  it('activates a cross-market replacement, serializes changes, and restores the original', async () => {
    const application = createApp({ ...options, recommendationsDb: db });
    const customer = await wishlist(application);
    const { canonical, key } = listing();
    const item = await add(customer, canonical);
    const { id } = await db.productIdentity.findUniqueOrThrow({ where: { lookupKey: key } });
    const admin = await administrator(application);
    const path = `${adminPath}/products/${id}`;
    const purchase = `${customer.path}/items/${item.id}/purchase`;
    const replacement = 'https://www.tokopedia.com/test-shop/test-product';
    const next = 'https://www.tokopedia.com/test-shop/next-product';
    const save = (url: string) => admin.agent.patch(path).set(mutation).send({ url });
    await customer.agent.patch(path).set(mutation).send({ url: replacement }).expect(401);
    await save('https://127.0.0.1/private').expect(400);
    await save(replacement).expect(200, { url: replacement, replaced: true });
    await save(replacement).expect(200, { url: replacement, replaced: true });
    const active = (await customer.agent.get(purchase).expect(200)).body;
    await customer.agent.get(active.affiliatePath).expect('Location', replacement).expect(302);
    const curated = await db.curatedRecommendation.create({ data: {
      title: 'Matching public recommendation', url: canonical, category: 'headphones', currency: 'IDR',
      priceMinor: 10000, priceVerified: true, priceVerifiedAt: new Date(), published: true,
    } });
    const recommendation = `/api/recommendations/products/${curated.id}/open`;
    try {
      await customer.agent.get(recommendation).expect('Location', replacement).expect(302);
    } finally {
      await db.curatedRecommendation.delete({ where: { id: curated.id } });
    }
    expect(await db.affiliateAudit.count({ where: { identityId: id } })).toBe(1);
    const failingDb = db.$extends({ query: { affiliateAudit: {
      create() { throw new Error('Audit write failed'); },
    } } });
    await expect(adminProducts(failingDb as unknown as typeof db).replaceProductUrl(id, next, credentials.username))
      .rejects.toThrow('Audit write failed');
    expect(await db.affiliateMapping.findUnique({ where: { activeIdentityId: id } }))
      .toMatchObject({ affiliateUrl: replacement });
    await Promise.all([save(next).expect(200), save(replacement + '-other').expect(200)]);
    expect(await db.affiliateMapping.count({ where: { activeIdentityId: id } })).toBe(1);
    await save(canonical).expect(200, { url: canonical, replaced: false });
    await customer.agent.get(purchase).expect(200, { originalUrl: canonical, affiliatePath: null });
    expect(await db.affiliateAudit.count({ where: { identityId: id } })).toBe(4);
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).url).toBe(canonical);
  });

  it('deduplicates eligible listings, preserves saved URLs and withholds private wishlist details', async () => {
    const application = app();
    const first = await wishlist(application);
    const second = await wishlist(application);
    const sample = listing();
    const variant = listing();
    const raw = `${sample.canonical}?utm_content=owner_ref`;
    const [item] = await Promise.all([add(first, raw), add(second, sample.canonical)]);
    await add(first, variant.canonical, 'Another private label');
    await add(first, `${sample.canonical}?size=XL`, 'Unknown option');
    await add(second, 'https://example.test/private-path?token=private', 'Private domain');
    expect(item.url).toBe(raw);
    const { agent } = await administrator(application);
    const shared = await agent.get(adminPath + '/products').query({ q: 'Other' }).expect(200);
    const otherKey = identifyProduct('https://example.test/private-path?token=private')!.lookupKey;
    keys.add(otherKey);
    const other = await db.productIdentity.findUniqueOrThrow({ where: { lookupKey: otherKey } });
    expect(shared.body.records).toContainEqual(expect.objectContaining({ id: other.id, title: null, image: null, price: null }));
    const detailResponse = await agent.get(adminPath + '/products/' + other.id).expect(200);
    expect(detailResponse.body).toMatchObject({ url: 'https://example.test/', originalUrl: 'https://example.test/' });
    expect(detailResponse.text).not.toContain('private-path');
    const list = await agent.get(`${adminPath}/opportunities`).expect(200);
    const detail = list.body.records.find((entry: { listingId: string }) => entry.listingId === sample.article);
    expect(detail).toMatchObject({
      market: 'us/en', canonicalUrl: sample.canonical, savedCount: 2, coverage: false,
      title: null, classification: 'insufficient', reviewedAt: null,
    });
    expect(list.body.records.find((entry: { listingId: string }) => entry.listingId === variant.article).savedCount).toBe(1);
    const serialized = JSON.stringify(list.body);
    for (const value of [first.ownerId, second.ownerId, first.wishlistId, second.wishlistId,
      'Private item label', 'owner_ref', 'Private wishlist fixture', 'private-path', 'priceMinor', 'assessment']) {
      expect(serialized).not.toContain(value);
    }
    const { body } = await agent.get(`${adminPath}/notifications`).expect(200);
    expect(body.records.filter(({ identityId, kind }: { identityId: string | null; kind: string }) =>
      identityId === detail.id && kind === 'new_opportunity')).toHaveLength(1);
    const event = body.records.find(({ identityId }: { identityId: string }) => identityId === detail.id);
    expect(event.targetPath).toBe(`/admin?section=products#product-${detail.id}`);
    for (const action of ['read', 'unread', 'dismiss']) {
      await agent.patch(`${adminPath}/notifications/${event.id}`).set(mutation).send({ action }).expect(204);
      const current = await agent.get(`${adminPath}/notifications`).expect(200);
      const notice = current.body.records.find(({ id }: { id: string }) => id === event.id);
      if (action === 'dismiss') expect(notice).toBeUndefined();
      else expect(Boolean(notice.readAt)).toBe(action === 'read');
    }
    const purchase = await first.agent.get(`${first.path}/items/${item.id}/purchase`).expect(200, { originalUrl: raw, affiliatePath: null });
    expect(purchase.headers['cache-control']).toBe('no-store');
    await second.agent.get(`${first.path}/items/${item.id}/purchase`).expect(404);
  });

  it('saves on the first attempt when the ownership lock exceeds the default transaction deadline', async () => {
    const fixture = await wishlist();
    const { canonical, key } = listing();
    let resolve!: () => void;
    const locked = new Promise<void>(ready => { resolve = ready; });
    const hold = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM DataOwner WHERE id = ${fixture.ownerId} FOR UPDATE`;
      resolve();
      await delay(5_700);
    }, { timeout: 12_000 });
    const input = { name: 'Slow database fixture', url: canonical, priceMinor: 5000, quantity: 1 };
    const id = randomUUID();
    try {
      await Promise.race([locked, hold]);
      await fixture.agent.post(`${fixture.path}/items`).set(mutation).set('Idempotency-Key', id).send(input).expect(201);
      const identity = await db.productIdentity.findUniqueOrThrow({ where: { lookupKey: key }, select: { id: true } });
      expect(await db.item.findUnique({ where: { id } })).toMatchObject({ productIdentityId: identity.id, url: canonical });
      expect(await db.priceObservation.count({ where: { itemId: id, priceMinor: 5000 } })).toBe(1);
      expect(await db.adminNotification.count({ where: { eventKey: `opportunity:${identity.id}` } })).toBe(1);
    } finally {
      await hold;
    }
  }, 20_000);

  it('commits a product save when the review notification write fails', async () => {
    const { canonical, key } = listing();
    const fixture = await wishlist();
    const noticeWrite = vi.spyOn(db.adminNotification, 'createMany').mockRejectedValueOnce(new Error('Notification unavailable'));
    try {
      const item = await add(fixture, canonical);
      expect(item).toBeDefined();
      expect(noticeWrite).toHaveBeenCalledOnce();
      const identity = await db.productIdentity.findUniqueOrThrow({ where: { lookupKey: key }, select: { id: true } });
      expect(await db.item.findUnique({ where: { id: item.id }, select: { productIdentityId: true } }))
        .toEqual({ productIdentityId: identity.id });
    } finally {
      noticeWrite.mockRestore();
    }
  });

  it('makes saved products idempotent and visible in the Superadmin product review queue', async () => {
    const owner = await wishlist();
    const sample = listing();
    const requestId = randomUUID();
    const input = { name: 'Shared lamp listing', priceMinor: 12500, quantity: 1, url: sample.canonical };
    const submit = () => owner.agent.post(`${owner.path}/items`).set(mutation).set('Idempotency-Key', requestId).send(input).expect(201);
    await Promise.all([submit(), submit()]);
    await submit();
    const saved = await owner.agent.get(owner.path).expect(200);
    expect(saved.body.items.filter(({ id }: { id: string }) => id === requestId)).toHaveLength(1);

    await owner.agent.post(`${owner.path}/items`).set(mutation).set('Idempotency-Key', requestId)
      .send({ ...input, name: 'Different payload' }).expect(409);
    const { agent } = await administrator();
    const queue = await agent.get(`${adminPath}/opportunities`).expect(200);
    const row = queue.body.records.find(({ listingId }: { listingId: string }) => listingId === sample.article);
    expect(row).toMatchObject({ canonicalUrl: sample.canonical, savedCount: 1, submissionStatus: 'pending' });
    expect(JSON.stringify(queue.body)).not.toContain(owner.ownerId);
  });

  it('resolves reviewed Tokopedia, Shopee, and manual affiliate URLs from their saved products', async () => {
    const owner = await wishlist();
    const admin = await administrator();
    const samples = [
      ['https://www.tokopedia.com/store/phone-case', 'https://www.tokopedia.com/store/phone-case?utm_source=partner'],
      ['https://shopee.co.id/Phone-Case-i.123.456', 'https://shopee.co.id/Phone-Case-i.123.456?utm_source=partner'],
      ['https://shop.example.test/items/phone-case?variant=blue', 'https://shop.example.test/items/phone-case?variant=blue&utm_source=partner'],
    ] as const;
    for (const [original, affiliateUrl] of samples) {
      keys.add(identifyProduct(original)!.lookupKey);
      const item = await add(owner, original, `Saved ${new URL(original).hostname}`);
      const identity = await db.productIdentity.findUniqueOrThrow({ where: { lookupKey: identifyProduct(original)!.lookupKey } });
      expect(identity.title).toBeNull();
      const path = `${adminPath}/opportunities/${identity.id}`;
      const candidate = await admin.agent.post(`${path}/mappings`).set(mutation).send({ url: affiliateUrl }).expect(201);
      expect(candidate.body.eligible).toBe(true);
      const identified = identifyProduct(original)!;
      expect(candidate.body.originalUrl).toBe(identified.merchant === 'Other'
        ? `${new URL(original).origin}/` : identified.canonicalUrl);
      await admin.agent.patch(`${path}/mappings/${candidate.body.id}`).set(mutation).send({ action: 'approve', revision: 0, evidence }).expect(200);
      const purchase = await owner.agent.get(`${owner.path}/items/${item.id}/purchase`).expect(200);
      await owner.agent.get(purchase.body.affiliatePath).expect('Location', affiliateUrl).expect(302);
    }
  });

  it('deduplicates hourly system failure notices and marks the full notification center read', async () => {
    const hour = new Date().toISOString().slice(0, 13);
    const failureKey = `failure:product-save:P2034:${hour}`;
    await affiliate.recordSystemFailure('P2034');
    await affiliate.recordSystemFailure('P2034');
    const userId = randomUUID();
    noticeKeys.add(failureKey);
    noticeKeys.add(`test-user:${userId}`);
    await db.adminNotification.create({ data: { eventKey: `test-user:${userId}`, kind: 'new_user',
      subject: 'Pengguna baru terdaftar', targetPath: '/admin?section=users' } });
    const { agent } = await administrator();
    const before = await agent.get(`${adminPath}/notifications`).expect(200);
    const failure = before.body.records.find(({ kind }: { kind: string }) => kind === 'system_failure');
    const user = before.body.records.find(({ kind }: { kind: string }) => kind === 'new_user');
    expect(before.body.unread).toBeGreaterThanOrEqual(2);
    expect(failure).toMatchObject({ identityId: null, title: 'Gangguan penyimpanan produk (P2034)',
      targetPath: '/admin?section=settings' });
    expect(await db.adminNotification.count({ where: { kind: 'system_failure', subject: 'Gangguan penyimpanan produk (P2034)' } })).toBe(1);
    expect(user).toMatchObject({ identityId: null, title: 'Pengguna baru terdaftar', targetPath: '/admin?section=users' });
    await agent.post(`${adminPath}/notifications/read-all`).set(mutation).send({}).expect(204);
    expect((await agent.get(`${adminPath}/notifications`).expect(200)).body.unread).toBe(0);
  });

  it('requires exact verification, protects the active slot, and falls back promptly after revocation', async () => {
    const application = app();
    const owner = await wishlist(application);
    const other = await wishlist(application);
    const sample = listing();
    const variant = listing();
    const item = await add(owner, sample.canonical);
    const second = await add(owner, variant.canonical, 'Second item');
    const empty = await add(owner, null, 'Unlinked item');
    const productPath = `${owner.path}/items/${item.id}`;
    const purchase = `${productPath}/purchase`;
    await owner.agent.get(`${owner.path}/items/${empty.id}/purchase`).expect(200, { originalUrl: null, affiliatePath: null });

    const wishlistIntelligence = owner.path.replace('/api/wishlists', '/api/intelligence/wishlists');
    const criteria = [{ id: randomUUID(), name: 'Unit price', kind: 'price', weight: 1 }];
    const alternatives = [item, second].map(({ id }) => ({ itemId: id, ratings: {} }));
    const compare = () => owner.agent.post(`${wishlistIntelligence}/comparisons`).set(mutation).send({ criteria, alternatives }).expect(201);
    const impulse = () => owner.agent.post(`${wishlistIntelligence}/items/${item.id}/impulse`).set(mutation).send({ need: true }).expect(201);
    const timing = () => owner.agent.post(`${wishlistIntelligence}/items/${item.id}/timing`).set(mutation)
      .send({ liquidMinor: '10000', reserveMinor: '0', obligationsMinor: '0' }).expect(200);
    const before = [(await compare()).body.result, (await impulse()).body.result, (await timing()).body];
    const { agent } = await administrator(application);
    const identity = await db.productIdentity.findUniqueOrThrow({ where: { lookupKey: sample.key } });
    const path = `${adminPath}/opportunities/${identity.id}`;
    const addCandidate = (url: string) => agent.post(`${path}/mappings`).set(mutation).send({ url });
    const review = (mappingId: string, data: object) => agent.patch(`${path}/mappings/${mappingId}`).set(mutation).send(data);
    const approve = { action: 'approve', revision: 0, evidence };

    await addCandidate('http://example.test/').expect(400);
    await addCandidate('javascript:void(0)').expect(400);
    const opaque = await addCandidate('https://example.test/opaque-candidate').expect(201);
    expect(opaque.body.classification).toBe('insufficient');
    await review(opaque.body.id, approve).expect(400);
    const mismatch = await addCandidate(`${variant.canonical}?utm_source=qa`).expect(201);
    expect(mismatch.body.classification).toBe('mismatch');
    await review(mismatch.body.id, approve).expect(400);
    await review(mismatch.body.id, { action: 'reject', revision: 0, reason: 'Different article.' }).expect(200);

    const direct = `${sample.canonical}?utm_source=qa&utm_medium=verification`;
    const first = await addCandidate(direct).expect(201);
    const duplicate = await addCandidate(`${sample.canonical}?utm_medium=verification&utm_source=qa`).expect(201);
    expect(duplicate.body.id).toBe(first.body.id);
    expect(first.body).toMatchObject({ active: false, classification: 'potential', eligible: true, status: 'pending' });
    expect(await db.adminNotification.count({ where: { eventKey: `candidate:${first.body.id}` } })).toBe(1);
    expect(await db.affiliateAudit.count({ where: { mappingId: first.body.id } })).toBe(1);
    await owner.agent.patch(`${path}/mappings/${first.body.id}`).set(mutation).send(approve).expect(401);
    await review(first.body.id, { ...approve, evidence: { ...evidence, confirmedExact: false } }).expect(400);
    await owner.agent.get(purchase).expect(200, { originalUrl: sample.canonical, affiliatePath: null });

    const active = await review(first.body.id, approve).expect(200);
    expect(active.body).toMatchObject({ active: true, classification: 'verified_exact', status: 'approved',
      approvedBy: credentials.username, approvedAt: expect.any(String), validatedAt: expect.any(String) });
    const secondCandidate = await addCandidate(`${sample.canonical}?utm_source=second`).expect(201);
    await review(secondCandidate.body.id, approve).expect(409);
    await review(first.body.id, { action: 'revalidate', revision: 0, evidence }).expect(409);
    await review(first.body.id, { action: 'revalidate', revision: 1, evidence: {
      ...evidence, variants: { ...evidence.variants, color: 'Blue' },
    } }).expect(409);
    const validated = await review(first.body.id, { action: 'revalidate', revision: 1, evidence }).expect(200);
    expect(validated.body.revision).toBe(2);
    const destination = await owner.agent.get(purchase).expect(200);
    const link = String(destination.body.affiliatePath);
    expect(Object.keys(destination.body).sort()).toEqual(['affiliatePath', 'originalUrl']);
    expect(link).toMatch(/^\/api\/wishlists\//u);
    expect(link).not.toContain(first.body.id);
    await owner.agent.get(link).expect('Location', direct).expect('Referrer-Policy', 'no-referrer').expect(302);
    await other.agent.get(link).expect(409);
    await owner.agent.get(link + '&destination=https%3A%2F%2Fexample.test').expect(409);
    expect([(await compare()).body.result, (await impulse()).body.result, (await timing()).body]).toEqual(before);

    const history = await agent.get(path).expect(200);
    expect(history.body).toMatchObject({ coverage: true, title: 'QA Lamp White', normalizedTitle: 'qa lamp white',
      brand: 'QA brand', model: 'QA-100', variants: evidence.variants, reviewedAt: expect.any(String) });
    expect(history.body.audit.filter(({ mappingId }: { mappingId: string }) => mappingId === first.body.id)
      .map(({ action }: { action: string }) => action)).toEqual(['revalidate', 'approve', 'candidate_added']);

    await review(first.body.id, { action: 'revoke', revision: 2, reason: 'Tracking relationship ended.' }).expect(200);
    await owner.agent.get(link).expect('Location', sample.canonical).expect(302);
    await owner.agent.get(purchase).expect(200, { originalUrl: sample.canonical, affiliatePath: null });
    const restored = await review(first.body.id, { action: 'restore', revision: 3, evidence }).expect(200);
    expect(restored.body).toMatchObject({ status: 'approved', active: true, revision: 4 });
    const restoredPurchase = await owner.agent.get(purchase).expect(200);
    await owner.agent.get(restoredPurchase.body.affiliatePath).expect('Location', direct).expect(302);
    await review(first.body.id, { action: 'disable', revision: 4, reason: 'Switching to a replacement link.' }).expect(200);
    const inbox = await agent.get(`${adminPath}/notifications`).expect(200);
    expect(inbox.body.records.filter(({ identityId, kind }: { identityId: string; kind: string }) =>
      identityId === identity.id && kind === 'mapping_revoked')).toHaveLength(1);

    await review(secondCandidate.body.id, approve).expect(200);
    const next = await owner.agent.get(purchase).expect(200);
    await owner.agent.put(productPath).set(mutation).send({ name: item.name, priceMinor: item.priceMinor, quantity: item.quantity, url: variant.canonical }).expect(204);
    await owner.agent.get(next.body.affiliatePath).expect(409);
    await owner.agent.get(purchase).expect(200, { originalUrl: variant.canonical, affiliatePath: null });
  });

  it('indexes legacy rows without rewriting original links and invalidates unusable stored destinations', async () => {
    const application = app();
    const owner = await wishlist(application);
    const sample = listing();
    const variant = listing();
    const original = `${sample.canonical}?utm_source=legacy`;
    const item = await db.item.create({ data: { id: randomUUID(), ownerId: owner.ownerId, wishlistId: owner.wishlistId,
      name: 'Legacy private name', url: original, quantity: 1, priceMinor: 50 } });
    const count = await indexExistingProducts(db);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(await indexExistingProducts(db)).toBe(0);
    expect(await db.item.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ url: original, productIdentityId: expect.any(String) });
    const identity = await db.productIdentity.findUniqueOrThrow({ where: { lookupKey: sample.key } });
    const { agent } = await administrator(application);
    const path = `${adminPath}/opportunities/${identity.id}/mappings`;
    const candidate = await agent.post(path).set(mutation).send({ url: `${sample.canonical}?utm_source=qa` }).expect(201);
    await agent.patch(`${path}/${candidate.body.id}`).set(mutation)
      .send({ action: 'approve', revision: 0, evidence }).expect(200);
    await db.affiliateMapping.update({ where: { id: candidate.body.id }, data: { affiliateUrl: variant.canonical } });
    for (let attempt = 0; attempt < 2; attempt++) {
      await owner.agent.get(`${owner.path}/items/${item.id}/purchase`).expect(200, { originalUrl: original, affiliatePath: null });
    }
    expect(await db.affiliateMapping.findUnique({ where: { id: candidate.body.id } })).toMatchObject({ status: 'invalid', activeIdentityId: null });
    expect(await db.adminNotification.count({ where: { identityId: identity.id, kind: 'mapping_invalid' } })).toBe(1);
    expect(await db.affiliateAudit.count({ where: { mappingId: candidate.body.id, action: 'invalid', actor: 'system:resolver' } })).toBe(1);
  });
});
