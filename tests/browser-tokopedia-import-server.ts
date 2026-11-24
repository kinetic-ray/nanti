import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/database.js';
import { createMysqlImageStorage } from '../server/mysql-image-storage.js';
import { prismaWishlists } from '../server/prisma-wishlists.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const secret = process.env.SESSION_SECRET;
const port = Number(process.env.PORT ?? 3000);
if (!databaseUrl || !secret || !Number.isInteger(port)) {
  throw new Error('Set TEST_DATABASE_URL, SESSION_SECRET, and a valid PORT for the isolated browser fixture.');
}

const listing = 'https://tokopedia.link/fixture-helmet?ref=e2e';
const productUrl = 'https://www.tokopedia.com/lenovo-authorized-surabaya/charger-innergie-by-delta-180w-gaming-adaptor-laptop-universal-t18';
const imageUrl = 'https://images.tokopedia.net/fixtures/charger.jpg';
const jpeg = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#334455' } })
  .jpeg({ quality: 70 }).toBuffer();
const db = connectDatabase(databaseUrl);
const app = createApp({
  secret,
  secureCookies: false,
  preview: async () => null,
  repository: prismaWishlists(db),
  mysqlImages: createMysqlImageStorage(db),
  checkDatabase: async () => { await db.$connect(); },
  lookupMetadata: async url => url.href === listing ? {
    title: 'Charger INNERGIE 180W fixture',
    productUrl,
    image: imageUrl,
    price: { priceMinor: 173_500_000, currency: 'IDR' },
    sellerName: 'Lenovo Authorized Surabaya',
  } : null,
  marketplaceImageRequest: async url => url.href === imageUrl
    ? new Response(Uint8Array.from(jpeg), { headers: { 'content-type': 'image/jpeg' } })
    : new Response(null, { status: 404 }),
  webRoot: fileURLToPath(new URL('../dist/web/', import.meta.url)),
});

const server = createServer(app).listen(port, '127.0.0.1');
const stop = () => server.close(() => { void db.$disconnect(); });
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
console.log(`Tokopedia import fixture server listening on 127.0.0.1:${port}`);
