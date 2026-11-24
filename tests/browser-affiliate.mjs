
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { adminCredentialScope, hashAdminPassword } from '../server/admin-credentials.ts';
import { createApp } from '../server/app.ts';
import { connectDatabase } from '../server/database.ts';
import { createMysqlImageStorage } from '../server/mysql-image-storage.ts';
import { prismaAccounts } from '../server/prisma-accounts.ts';
import { prismaAffiliate } from '../server/prisma-affiliate.ts';
import { prismaWishlists } from '../server/prisma-wishlists.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname) ||
    !/_test$/u.test(new URL(databaseUrl).pathname)) throw new Error('Set a disposable local TEST_DATABASE_URL.');
const db = connectDatabase(databaseUrl);
const key = randomUUID();
const original = 'https://www.tokopedia.com/fixture-store/charger-' + key;
const replacement = 'https://shopee.co.id/product/11111/22222';
const title = 'Public fixture charger ' + key;
const email = key + '@example.test';
const image = 'https://images.tokopedia.net/fixture.jpg';
const password = randomBytes(24).toString('base64url');
const secret = randomBytes(32).toString('hex');
const credentials = { username: 'fixture-admin', passwordHash: await hashAdminPassword(password) };
const accounts = prismaAccounts(db);
await accounts.passwords.register(email, password);
const verification = await accounts.passwords.issue(email, 'verify');
assert.ok(verification);
assert.ok(await accounts.passwords.consume(verification, 'verify', password));
const jpeg = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#334455' } }).jpeg().toBuffer();
const app = createApp({ secret, secureCookies: false, preview: async () => null,
  consumer: { accounts, providers: {} }, admin: credentials, affiliate: prismaAffiliate(db),
  repository: prismaWishlists(db), mysqlImages: createMysqlImageStorage(db), recommendationsDb: db,
  lookupMetadata: async url => url.href === original ? { productUrl: original, title, image,
    price: { priceMinor: 173500000, currency: 'IDR' } } : null,
  marketplaceImageRequest: async () => new Response(Uint8Array.from(jpeg), { headers: { 'content-type': 'image/jpeg' } }),
  webRoot: fileURLToPath(new URL('../dist/web/', import.meta.url)),
});
const server = createServer(app).listen(0, '127.0.0.1');
await once(server, 'listening');
const baseURL = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.NANTI_BROWSER_PATH, headless: true });
const shopper = await browser.newPage({ baseURL });
const admin = await browser.newPage({ baseURL, viewport: { width: 1365, height: 900 } });
const artifacts = process.env.NANTI_BROWSER_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const screenshot = name => artifacts && admin.screenshot({ path: join(artifacts, name) });
const button = (root, name) => root.getByRole('button', { name, exact: true });
const dialog = (root, name) => root.getByRole('dialog', { name, exact: true });
const headers = { 'X-Nanti-Request': '1' };
const show = locator => locator.waitFor({ state: 'visible' });
await admin.addInitScript({ path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') });
async function axe() {
  const violations = await admin.evaluate(async () => (await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
  })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target }) => target) })));
  assert.deepEqual(violations, []);
}
try {
  assert.equal((await shopper.request.post('/api/account/password/login', { headers, data: { email, password } })).status(), 204);
  await shopper.route(image, route => route.fulfill({ contentType: 'image/jpeg', body: jpeg }));
  await shopper.goto('/');
  await button(shopper, 'Buat wishlist').click();
  const category = dialog(shopper, 'Kategori wishlist baru');
  await category.getByLabel('Nama kategori wishlist').fill('Private browser wishlist');
  await button(category, 'Simpan wishlist').click();
  await show(shopper.getByRole('heading', { name: 'Private browser wishlist' }));
  await button(shopper, 'Tambah produk').click();
  const form = dialog(shopper, 'Tambah produk');
  await form.getByLabel('Tempel tautan produk').fill(original);
  await button(form, 'Cek link produk').click();
  await show(form.getByText(title, { exact: true }));
  await button(form, 'Simpan produk').click();
  await show(shopper.getByRole('heading', { name: title }));
  const [list] = await (await shopper.request.get('/api/wishlists')).json();
  const [item] = (await (await shopper.request.get('/api/wishlists/' + list.id)).json()).items;
  assert.equal(item.url, original);
  assert.equal(item.priceMinor, 173500000);
  assert.match(item.imageKey, /^mysql\//u);

  await admin.goto('/admin');
  await admin.getByLabel('Nama pengguna').fill(credentials.username);
  await admin.getByLabel('Kata sandi').fill(password);
  await button(admin, 'Masuk').click();
  await admin.getByRole('link', { name: /^Notifikasi/u }).first().click();
  const inbox = await (await admin.request.get('/api/admin/notifications')).json();
  const productId = (await db.item.findUniqueOrThrow({ where: { id: item.id } })).productIdentityId;
  const notice = inbox.records.find(row => row.identityId === productId);
  assert.ok(notice);
  assert.equal(notice.targetPath, '/admin?section=products#product-' + productId);
  const event = admin.locator('li').filter({ has: admin.locator('a[href="' + notice.targetPath + '"]') });
  await event.getByRole('link', { name: 'Buka' }).click();
  const editor = dialog(admin, 'Edit produk');
  await show(editor.getByLabel('URL produk'));
  assert.equal(await editor.getByLabel('URL produk').inputValue(), original);
  await button(editor, 'Batal').click();
  const row = admin.locator('.aw-submission-list li').filter({ hasText: title });
  await show(row.getByText('Belum diganti'));
  await row.locator('img').evaluate(node => node.decode());
  await show(row.getByText(/1\.735\.000/u));
  assert.equal((await shopper.request.get(await row.locator('img').getAttribute('src'))).status(), 401);
  await axe();
  await screenshot('admin-products-before.png');

  await row.getByRole('button', { name: /^Edit/u }).click();
  const url = editor.getByLabel('URL produk');
  await show(url);
  assert.equal(await editor.locator('input').count(), 1);
  await screenshot('admin-product-editor.png');
  await url.fill('https://127.0.0.1/unsafe');
  assert.equal(await button(editor, 'Simpan perubahan').isDisabled(), true);
  assert.equal(await url.inputValue(), 'https://127.0.0.1/unsafe');
  assert.equal(await admin.getByText('Tautan produk berhasil diperbarui.').count(), 0);
  await url.fill('https://missing-destination.invalid/product');
  await button(editor, 'Simpan perubahan').click();
  await show(editor.getByRole('alert'));
  assert.equal(await url.inputValue(), 'https://missing-destination.invalid/product');
  assert.equal(await admin.getByText('Tautan produk berhasil diperbarui.').count(), 0);
  await url.fill(replacement);
  await button(editor, 'Simpan perubahan').click();
  await show(admin.getByText('Tautan produk berhasil diperbarui.'));
  await editor.waitFor({ state: 'hidden' });
  await show(row.getByText('Tautan diganti'));
  await screenshot('admin-products-replaced.png');
  await admin.getByRole('searchbox', { name: 'Cari produk' }).fill(title);
  await button(admin, 'Cari').click();
  await admin.getByLabel('Status tautan').selectOption('replacement');
  await show(row.getByText('Tautan diganti'));
  await admin.getByLabel('Status tautan').selectOption('');
  await show(row.getByText('Tautan diganti'));
  for (const obsolete of ['Tambahkan kandidat', 'Verifikasi dan setujui', 'Buka tautan asli', 'Tinjau tautan afiliasi']) {
    assert.equal(await admin.getByText(obsolete, { exact: true }).count(), 0);
  }

  await button(shopper, 'Bantu putuskan untuk ' + title).click();
  const chooser = dialog(shopper, title);
  await show(chooser.getByText(/komisi/u));
  const link = chooser.getByRole('link', { name: /^Beli produk/u });
  await show(link);
  assert.equal(await chooser.getByRole('link').count(), 1);
  assert.equal(await chooser.getByRole('link', { name: /^Buka link produk asli/u }).count(), 0);
  const activeHref = await link.getAttribute('href');
  const redirected = await shopper.request.get(activeHref, { maxRedirects: 0 });
  assert.equal(redirected.status(), 302);
  assert.equal(redirected.headers().location, replacement);

  await admin.setViewportSize({ width: 390, height: 844 });
  await row.getByRole('button', { name: /^Edit/u }).click();
  await show(url);
  assert.equal(await url.inputValue(), replacement);
  assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth), 390);
  await axe();
  await url.fill(original);
  await button(editor, 'Simpan perubahan').click();
  await show(row.getByText('Belum diganti'));
  await screenshot('admin-products-restored.png');
  const restored = await shopper.request.get(activeHref, { maxRedirects: 0 });
  assert.equal(restored.status(), 302);
  assert.equal(restored.headers().location, original);
  await shopper.keyboard.press('Escape');
  await chooser.waitFor({ state: 'hidden' });
  await button(shopper, 'Bantu putuskan untuk ' + title).click();
  await show(link);
  assert.equal(await chooser.getByRole('link').count(), 1);
  assert.equal(await link.getAttribute('href'), original);
  assert.equal(await chooser.getByText(/komisi/u).count(), 0);
  const savedItem = (await (await shopper.request.get('/api/wishlists/' + list.id)).json()).items[0];
  assert.equal(savedItem.url, original);
  console.log('PASS registered import, admin metadata, notification, replacement, disclosure, restoration, responsive layout, and accessibility');
} finally {
  const identity = await db.productIdentity.findFirst({ where: { canonicalUrl: original } });
  await db.user.deleteMany({ where: { password: { email } } });
  if (identity) {
    const identityId = identity.id;
    await db.affiliateAudit.deleteMany({ where: { identityId } });
    await db.adminNotification.deleteMany({ where: { identityId } });
    await db.affiliateMapping.deleteMany({ where: { identityId } });
    await db.productIdentity.delete({ where: { id: identityId } });
  }
  await db.adminSession.deleteMany({ where: { credentialScope: adminCredentialScope(credentials, secret) } });
  await browser.close();
  server.close();
  await db.$disconnect();
}
