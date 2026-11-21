import request from 'supertest';
import { expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/database.js';
import { prismaAccounts, tokenHash } from '../server/prisma-accounts.js';
import { prismaWishlists } from '../server/prisma-wishlists.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

it.skipIf(!databaseUrl)('isolates creator drafts and publishes only eligible catalog products', async () => {
  const db = connectDatabase(databaseUrl!);
  const app = createApp({
    repository: prismaWishlists(db), consumer: { accounts: prismaAccounts(db), providers: {} },
    preview: async () => null, secret: 'creator-integration-test-secret', secureCookies: false,
  });
  const users = [randomUUID(), randomUUID()];
  const clients = users.map(() => request.agent(app).set('X-Nanti-Request', '1'));
  const [owner, stranger] = clients;
  const catalog = '/api/account/creator/catalog';
  try {
    for (const [index, userId] of users.entries()) {
      const token = randomBytes(32).toString('base64url');
      await db.user.create({ data: { id: userId, creatorProfile: { create: { name: 'Test creator' } },
        sessions: { create: { tokenHash: tokenHash(token), verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } } } });
      clients[index]!.set('Cookie', 'nanti-user=' + token);
    }
    await request(app).get(catalog).expect(401);
    const state = await owner!.get(catalog).expect(200);
    const ownerProfile = await db.creatorProfile.findUniqueOrThrow({ where: { userId: users[0] } });
    const publicPath = '/api/account/creator/storefront/' + state.body.handle;
    await request(app).get(publicPath).expect(404);
    const input = { title: 'Canvas bag', url: 'https://example.com/bag', description: '', category: '' };
    const productPath = catalog + '/products/' + randomUUID();
    await stranger!.put(productPath).send({ ...input, profileId: ownerProfile.id }).expect(400);
    await owner!.put(productPath).send({ ...input, url: 'javascript:alert(1)' }).expect(400);
    await owner!.put(productPath).send({ ...input, photo: 'aW52YWxpZA==' }).expect(400);
    expect((await owner!.get(catalog).expect(200)).body.products).toEqual([]);
    const photo = Buffer.from('ffd8ffc0000b080010002001011100ffda0008010100003f0000ffd9', 'hex').toString('base64');
    await owner!.put(productPath).send({ ...input, photo }).expect(200);
    await owner!.put(productPath).send({ ...input, photo }).expect(200);
    await owner!.put(productPath).send({ ...input, title: 'Conflicting retry', photo }).expect(409);
    expect((await owner!.get(catalog).expect(200)).body.products).toHaveLength(1);
    await stranger!.put(productPath).send(input).expect(404);
    await stranger!.patch(productPath).send(input).expect(404);
    await stranger!.patch(productPath).send({ ...input, profileId: ownerProfile.id }).expect(400);
    await stranger!.put(productPath + '/publication').send({ published: true }).expect(404);
    expect((await stranger!.get(catalog).expect(200)).body.products).toEqual([]);
    await request(app).get(productPath + '/photo').expect(401);
    await stranger!.get(productPath + '/photo').expect(404);
    await stranger!.delete(productPath).send({}).expect(404);
    await owner!.get(productPath + '/photo').expect('Content-Type', /image\/jpeg/).expect(200);
    const publicPhoto = publicPath + '/products/' + productPath.split('/').at(-1) + '/photo';
    await owner!.put(catalog + '/publication').send({ published: true }).expect(204);
    expect((await request(app).get(publicPath).expect(200)).body.products).toEqual([]);
    await request(app).get(publicPhoto).expect(404);
    await owner!.put(productPath + '/publication').send({ published: true }).expect(204);
    const published = (await request(app).get(publicPath).expect(200)).body;
    expect(Object.keys(published).sort()).toEqual(['design', 'name', 'products']);
    expect(published.products).toEqual([{ ...input, id: productPath.split('/').at(-1), currency: null, priceMinor: null, image: publicPhoto }]);
    await request(app).get(publicPhoto).expect('Content-Type', /image\/jpeg/).expect(200);
    await owner!.put(productPath + '/publication').send({ published: false }).expect(204);
    expect((await request(app).get(publicPath).expect(200)).body.products).toEqual([]);
    await request(app).get(publicPhoto).expect(404);
    await owner!.put(productPath + '/publication').send({ published: true }).expect(204);
    await owner!.put(catalog + '/publication').send({ published: false }).expect(204);
    await request(app).get(publicPath).expect(404);
    await request(app).get(publicPhoto).expect(404);
    await db.userSession.updateMany({ where: { userId: users[0] }, data: { expiresAt: new Date(0) } });
    await owner!.get(catalog).expect(401);
    await owner!.patch(productPath).send(input).expect(401);
    await owner!.delete(productPath).send({}).expect(401);
    await owner!.put(catalog + '/publication').send({ published: true }).expect(401);
    expect(await db.creatorProduct.count({ where: { profileId: ownerProfile.id } })).toBe(1);
    await request(app).get(publicPath).expect(404);
  } finally {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
});
