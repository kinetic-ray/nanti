import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect, it } from 'vitest';
import { adminCredentialScope, hashAdminPassword } from '../server/admin-credentials.js';
import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/database.js';
import { prismaAccounts, tokenHash } from '../server/prisma-accounts.js';
import { prismaAffiliate } from '../server/prisma-affiliate.js';
import { prismaWishlists } from '../server/prisma-wishlists.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const mutation = { 'X-Nanti-Request': '1', 'Content-Type': 'application/json' };
const workspace = '/api/admin/workspace';
const catalog = '/api/account/creator/catalog';

it.skipIf(!databaseUrl)('separates Creator, account administrator, and Superadmin privileges and audits administrative writes', async () => {
  const db = connectDatabase(databaseUrl!);
  const secret = randomBytes(32).toString('hex');
  const password = randomBytes(24).toString('base64url');
  const credentials = { username: 'workspace-test', passwordHash: await hashAdminPassword(password) };
  const app = createApp({
    repository: prismaWishlists(db), consumer: { accounts: prismaAccounts(db), providers: {} },
    affiliate: prismaAffiliate(db), admin: credentials, recommendationsDb: db,
    preview: async () => null, secret, secureCookies: false,
  });
  const user = randomUUID();
  const otherUser = randomUUID();
  const profile = randomUUID();
  const otherProfile = randomUUID();
  const product = randomUUID();
  const sibling = randomUUID();
  const foreign = randomUUID();
  const title = 'Workspace test ' + product;
  const original = 'https://www.tokopedia.com/fixture/original';
  const replacement = 'https://shopee.co.id/fixture-replacement';
  const userToken = randomBytes(32).toString('base64url');
  const otherToken = randomBytes(32).toString('base64url');
  const consumer = request.agent(app).set('Cookie', 'nanti-user=' + userToken).set(mutation);
  const accountAdmin = request.agent(app).set('Cookie', 'nanti-user=' + otherToken).set(mutation);
  const root = request.agent(app).set(mutation);

  try {
    for (const [id, pid, token, role] of [[user, profile, userToken, 'member'], [otherUser, otherProfile, otherToken, 'admin']] as const) {
      await db.user.create({ data: {
        id, role, creatorProfile: { create: { id: pid, name: 'Creator ' + pid } },
        sessions: { create: { tokenHash: tokenHash(token), verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } },
      } });
    }
    await db.creatorProduct.createMany({ data: [
      { id: product, profileId: profile, title, url: original, description: '', category: '', published: false },
      { id: sibling, profileId: profile, title: 'Another product', url: original, description: '', category: '', published: false },
      { id: foreign, profileId: otherProfile, title: 'Other profile product', url: original, description: '', category: '', published: false },
    ] });
    const state = (await consumer.get(catalog).expect(200)).body;
    expect(state.products).toHaveLength(2);
    expect(state.products[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);

    const bulk = catalog + '/bulk-publication';
    await request(app).post(bulk).set(mutation).send({ ids: [product], published: true }).expect(401);
    await consumer.post(bulk).send({ ids: [product, product], published: true }).expect(400);
    await consumer.post(bulk).send({ ids: [product, foreign], published: true }).expect(404);
    expect(await db.creatorProduct.count({ where: { id: { in: [product, sibling, foreign] }, published: true } })).toBe(0);
    await consumer.post(bulk).send({ ids: [product, sibling], published: true }).expect(204);
    await consumer.post(bulk).send({ ids: [product, sibling], published: true }).expect(204);
    expect(await db.creatorProduct.count({ where: { profileId: profile, published: true } })).toBe(2);
    await consumer.put(catalog + '/publication').send({ published: true }).expect(204);
    const storefront = '/api/account/creator/storefront/' + state.handle;
    expect((await request(app).get(storefront).expect(200)).body.products).toHaveLength(2);

    await request(app).get(workspace + '/overview').expect(401);
    await consumer.get(workspace + '/products').expect(401);
    await consumer.get(workspace + '/settings/status').expect(401);
    await accountAdmin.get('/api/account/admin').expect(200);
    await accountAdmin.get(workspace + '/users').expect(401);
    const endpoint = workspace + '/products/' + product + '/link';
    const update = { expectedUrl: original, url: replacement, reason: 'Listing moved to the authorised catalogue.' };
    await accountAdmin.patch(endpoint).send(update).expect(401);
    await root.post('/api/admin/login').send({ username: credentials.username, password }).expect(200);
    await root.get(catalog).expect(401);
    await root.get(workspace + '/overview').expect('Cache-Control', 'no-store').expect(200);
    await root.get(workspace + '/settings/status').expect('Cache-Control', 'no-store').expect(200).expect(response => {
      expect(response.body).toMatchObject({ environment: expect.any(String), checks: {
        databaseConfigured: expect.any(Boolean), administratorLoginConfigured: true,
        googleSignInConfigured: expect.any(Boolean), appleSignInConfigured: expect.any(Boolean),
        accountRecoveryConfigured: expect.any(Boolean), imageStorageConfigured: expect.any(Boolean),
        recommendationManagementEnabled: expect.any(Boolean),
      } });
      expect(JSON.stringify(response.body)).not.toContain(password);
    });
    const result = (await root.get(workspace + '/products').query({ q: title, page: 500 }).expect(200)).body;
    expect(result).toMatchObject({ total: 1, page: 1, pages: 1, records: [{ id: product, url: original }] });
    await root.get(workspace + '/users').query({ q: user }).expect(200).expect(response => {
      expect(response.body.records).toEqual([{ id: user, displayName: null, role: 'member', creator: 'Creator ' + profile,
        createdAt: expect.any(String) }]);
    });
    await root.get(workspace + '/creators').query({ q: profile }).expect(200).expect(response => {
      expect(response.body.records).toMatchObject([{ id: profile, products: 2 }]);
    });
    await root.patch(endpoint).set('Sec-Fetch-Site', 'cross-site').send(update).expect(403);
    await root.patch(endpoint).send({ ...update, url: 'http://example.com/unsafe' }).expect(400);
    await root.patch(endpoint).send({ ...update, url: 'https://example.com:8443/unsafe' }).expect(400);
    await root.patch(endpoint).send({ ...update, reason: ' ' }).expect(400);
    await root.patch(endpoint).send(update).expect(204);
    await root.patch(endpoint).send({ ...update, url: 'https://example.com/stale' }).expect(409);
    await root.patch(endpoint).send({ ...update, expectedUrl: replacement }).expect(204);
    const storefrontItems = (await request(app).get(storefront).expect(200)).body.products;
    expect(storefrontItems.find((item: { id: string }) => item.id === product)?.url).toBe(replacement);
    const pullProduct = workspace + '/products/' + sibling + '/unpublish';
    await consumer.post(pullProduct).send({ reason: 'Not the Superadmin.' }).expect(401);
    await root.post(pullProduct).send({ reason: 'Temporary product review.' }).expect(204);
    expect((await request(app).get(storefront).expect(200)).body.products).toHaveLength(1);
    const takeOffline = workspace + '/storefronts/' + profile + '/unpublish';
    await consumer.post(takeOffline).send({ reason: 'Not the Superadmin.' }).expect(401);
    await root.post(takeOffline).send({ reason: 'Temporary storefront review.' }).expect(204);
    await root.post(takeOffline).send({ reason: 'Repeated request.' }).expect(204);
    await request(app).get(storefront).expect(404);
    const audit = await db.workspaceAudit.findMany({ where: { subjectId: { in: [product, sibling, profile] } } });
    expect(audit).toHaveLength(3);
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: credentials.username, action: 'product_link_updated', subjectId: product, reason: update.reason }),
      expect.objectContaining({ actor: credentials.username, action: 'product_unpublished', subjectId: sibling, reason: 'Temporary product review.' }),
      expect.objectContaining({ actor: credentials.username, action: 'storefront_unpublished', subjectId: profile, reason: 'Temporary storefront review.' }),
    ]));
    await root.get(workspace + '/audit').expect(200).expect(response => {
      expect(response.body.workspace).toEqual(expect.arrayContaining(audit.map(entry => expect.objectContaining({ id: entry.id }))));
    });
    await root.post('/api/admin/logout').send({}).expect(204);
    await root.get(workspace + '/audit').expect(401);
  } finally {
    await db.workspaceAudit.deleteMany({ where: { subjectId: { in: [product, sibling, profile] } } });
    await db.adminSession.deleteMany({ where: { credentialScope: adminCredentialScope(credentials, secret) } });
    await db.user.deleteMany({ where: { id: { in: [user, otherUser] } } });
    await db.$disconnect();
  }
});
