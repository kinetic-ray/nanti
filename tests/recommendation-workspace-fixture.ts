import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { adminCredentialScope, hashAdminPassword } from '../server/admin-credentials.js';
import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/database.js';
import { identifyProduct } from '../server/product-identity.js';
import { prismaAffiliate } from '../server/prisma-affiliate.js';
import { prismaWishlists } from '../server/prisma-wishlists.js';

export const path = '/api/admin/recommendations/workspace';
export const mutation = { 'X-Nanti-Request': '1', 'Content-Type': 'application/json' };
export const image = 'https://images.tokopedia.net/fixture.jpg';

export async function recommendationFixture(databaseUrl: string, enabled = true) {
  const database = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) || !/_test$/u.test(database.pathname)) {
    throw new Error('Recommendation fixtures require an isolated local _test database.');
  }
  const db = connectDatabase(databaseUrl);
  const key = randomUUID().slice(0, 8);
  const title = 'New Balance 540 White ' + key;
  const listing = 'https://www.tokopedia.com/fixture/' + key;
  const missing = listing + '-manual';
  const source = listing + '-source';
  const lookupKeys = [listing, missing, source].map(url => identifyProduct(url)!.lookupKey);
  const secret = randomBytes(32).toString('hex');
  const password = randomBytes(24).toString('base64url');
  const admin = { username: 'recommendation-' + key, passwordHash: await hashAdminPassword(password) };
  const repository = prismaWishlists(db);
  const app = createApp({
    repository, admin, affiliate: prismaAffiliate(db), recommendationsDb: db,
    recommendationSuperadminEnabled: enabled, secret, secureCookies: false,
    preview: async () => null,
    lookupMetadata: async url => url.pathname === new URL(listing).pathname
      ? { title, image, price: { priceMinor: 80000000, currency: 'IDR' } } : null,
    webRoot: fileURLToPath(new URL('../dist/web/', import.meta.url)),
  });
  const curation = { title, category: 'sneakers', color: 'white', style: 'Retro', useCase: 'Sehari-hari', description: null };
  return { db, app, listing, missing, source, title, curation, secret, password, username: admin.username,
    async close() {
      const identity = { lookupKey: { in: lookupKeys } };
      try {
        await db.workspaceAudit.deleteMany({ where: { actor: admin.username } });
        await db.adminSession.deleteMany({ where: { credentialScope: adminCredentialScope(admin, secret) } });
        await db.curatedRecommendation.deleteMany({ where: { url: { startsWith: listing } } });
        await db.adminNotification.deleteMany({ where: { identity } });
        await db.affiliateAudit.deleteMany({ where: { identity } });
        await db.affiliateMapping.deleteMany({ where: { identity } });
        await db.productIdentity.deleteMany({ where: identity });
      } finally {
        await db.$disconnect();
      }
    },
  };
}
