import { requireTestDatabaseUrl } from './test-database-url.mjs';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { adminCredentialScope, hashAdminPassword } from '../server/admin-credentials.ts';
import { prismaAffiliate } from '../server/prisma-affiliate.ts';
import { createApp } from '../server/app.ts';
import { connectDatabase } from '../server/database.ts';
import { createMysqlImageStorage } from '../server/mysql-image-storage.ts';
import { prismaAccounts, tokenHash } from '../server/prisma-accounts.ts';
import { prismaWishlists } from '../server/prisma-wishlists.ts';

const databaseUrl = requireTestDatabaseUrl();
const db = connectDatabase(databaseUrl);
const userId = randomUUID();
const token = randomBytes(32).toString('base64url');
const password = randomBytes(24).toString('base64url');
const secret = randomBytes(32).toString('hex');
const credentials = { username: 'studio-browser-' + userId.slice(0, 8), passwordHash: await hashAdminPassword(password) };
const creatorShopeeImage = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#7953b0' } })
  .webp().toBuffer();
const app = createApp({
  affiliate: prismaAffiliate(db), admin: credentials, recommendationsDb: db,
  repository: prismaWishlists(db), mysqlImages: createMysqlImageStorage(db),
  consumer: { accounts: prismaAccounts(db), providers: {} },
  preview: async () => null, secret, secureCookies: false,
  // The upstream retailer is controlled. The browser, Express routes, sessions,
  // database writes and anonymous storefront are the real implementations.
  lookupMetadata: async url => url.pathname.endsWith('/fixture') ? {
    title: 'Imported desk lamp', image: null, price: { priceMinor: 8900000, currency: 'IDR' },
  } : url.pathname === '/fixture-shopee-i.123.456' ? {
    title: 'Imported Shopee product', image: 'https://down-id.img.susercontent.com/file/fixture',
    productUrl: 'https://shopee.co.id/fixture-shopee-i.123.456',
    price: { priceMinor: 1200000, currency: 'IDR' },
  } : null,
  marketplaceImageRequest: async url => url.href === 'https://down-id.img.susercontent.com/file/fixture'
    ? new Response(Uint8Array.from(creatorShopeeImage), { headers: { 'content-type': 'image/webp' } })
    : new Response(null, { status: 404 }),
  webRoot: fileURLToPath(new URL('../dist/web/', import.meta.url)),
});
const server = createServer(app).listen(0, '127.0.0.1');
await once(server, 'listening');
const baseURL = 'http://127.0.0.1:' + server.address().port;
const axe = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const artifacts = process.env.NANTI_CREATOR_BROWSER_ARTIFACTS;
const errors = [];
if (artifacts) await mkdir(artifacts, { recursive: true });
async function audit(page, selector, description) {
  const violations = await page.evaluate(async context => (await window.axe.run(context,
    { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(({ id, nodes }) =>
      ({ id, elements: nodes.map(({ target }) => target) })), selector);
  assert.deepEqual(violations, [], description);
}
let browser;
try {
  await db.user.create({ data: { id: userId, displayName: 'Studio Browser', sessions: { create: {
    tokenHash: tokenHash(token), verifiedAt: new Date(), expiresAt: new Date(Date.now() + 300000),
  } } } });
  browser = await chromium.launch({
    executablePath: process.env.NANTI_BROWSER_PATH ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
  });
  const creator = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  await creator.addCookies([{ name: 'nanti-user', value: token, url: baseURL }]);
  await creator.addInitScript(() => localStorage.setItem('nanti.language', 'en'));
  await creator.addInitScript({ path: axe });
  const page = await creator.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', failure => errors.push(failure.message));
  const guest = await browser.newContext({ baseURL });
  await guest.addInitScript(() => localStorage.setItem('nanti.language', 'en'));
  await guest.addInitScript({ path: axe });
  const visitor = await guest.newPage();
  visitor.setDefaultTimeout(12000);
  visitor.on('pageerror', failure => errors.push(failure.message));
  const widths = [320, 360, 390, 768, 1024, 1440];
  const button = (root, name) => root.getByRole('button', { name, exact: true });
  const heading = (root, name) => root.getByRole('heading', { name, exact: true });
  const mobileToggle = button(page, 'Open navigation');
  async function creatorSection(label) {
    if (await mobileToggle.isVisible()) {
      await mobileToggle.click();
      await page.getByRole('dialog', { name: 'Workspace navigation' }).getByRole('link', { name: label, exact: true }).click();
    } else {
      await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: label, exact: true }).click();
    }
  }
  async function layout(root, label, width) {
    await root.setViewportSize({ width, height: 860 });
    assert.equal(await root.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label + ' overflows at ' + width);
    await audit(root, '.aw', label + ' accessibility at ' + width);
    if (artifacts) await root.screenshot({ path: join(artifacts, label + '-' + width + '.png'), fullPage: true });
  }

  const accessContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const access = await accessContext.newPage();
  await access.addInitScript(() => localStorage.setItem('nanti.language', 'en'));
  let accountChecks = 0;
  await access.route('**/api/account/creator', async route => {
    accountChecks += 1;
    if (accountChecks === 1) await new Promise(resolve => setTimeout(resolve, 7600));
    await route.fulfill({ json: { profile: null, continued: false } });
  });
  await access.goto('/creator/studio');
  await heading(access, 'Checking your creator account…').waitFor();
  assert.equal(await heading(access, 'Create a creator profile').count(), 0, 'onboarding waits for account status before showing its form heading');
  await access.getByText('This is taking longer than expected. You can retry or keep waiting.').waitFor({ timeout: 8000 });
  await button(access, 'Try again').click();
  await heading(access, 'Create a creator profile').waitFor();
  assert.equal(accountChecks, 2, 'the slow account check can be retried');
  await access.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  assert.equal(await access.evaluate(() => document.documentElement.classList.contains('session-suspended')), true);
  const restoredAccount = access.waitForResponse(response => response.url().endsWith('/api/account/creator'));
  await access.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await restoredAccount;
  await heading(access, 'Create a creator profile').waitFor();
  assert.equal(await heading(access, 'Checking your creator account…').count(), 0, 'restored onboarding shows one account state at a time');
  await access.waitForFunction(() => document.documentElement.classList.contains('session-suspended') === false);
  assert.equal(accountChecks, 3, 'restoring the creator workspace reloads its account state');
  await accessContext.close();

  await page.goto('/creator/studio');
  await page.getByLabel('Creator name').fill('Browser Storefront');
  await button(page, 'Create creator profile').click();
  await heading(page, 'Overview').waitFor();
  await mobileToggle.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Workspace navigation' });
  await drawer.waitFor();
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });
  assert.equal(await mobileToggle.evaluate(element => document.activeElement === element), true);
  await button(page, 'Account menu').click();
  const account = page.getByRole('link', { name: 'Account', exact: true });
  assert.equal(await account.getAttribute('href'), '/account');
  await page.keyboard.press('Escape');
  assert.equal(await account.isVisible(), false);

  await button(page, 'Add product').click();
  await heading(page, 'Add product').waitFor();
  assert.equal(await page.locator('#catalog-url').evaluate(element => document.activeElement === element), true);
  await layout(page, 'creator-editor', 320);
  await button(page, 'Import details').click();
  assert.equal(await page.locator('#catalog-url').getAttribute('aria-invalid'), 'true');
  await page.getByLabel('Product URL').fill('https://example.com/bag');
  await button(page, 'Import details').click();
  await page.getByText(/retailer details are unavailable/i).waitFor();
  await page.getByLabel('Product name').fill('Canvas tote');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    context.fillStyle = '#7953b0';
    context.fillRect(0, 0, 64, 64);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  await page.getByLabel('Upload photo').setInputFiles({ name: 'tote.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(image, 'base64') });
  await page.getByLabel('Price', { exact: true }).fill('125000.50');
  assert.equal(await page.getByLabel('Price', { exact: true }).inputValue(), '125,000.50');
  await button(page, 'Save draft').click();
  const tote = page.getByRole('row').filter({ hasText: 'Canvas tote' });
  await tote.getByText('Draft', { exact: true }).waitFor();

  await button(page, 'Add product').click();
  await page.getByLabel('Product URL').fill('https://www.tokopedia.com/desk/fixture');
  await button(page, 'Import details').click();
  await page.waitForFunction(() => document.querySelector('#catalog-product-name')?.value === 'Imported desk lamp');
  assert.equal(await page.getByLabel('Price', { exact: true }).inputValue(), '89,000');
  await button(page, 'Save draft').click();
  await page.getByRole('row').filter({ hasText: 'Imported desk lamp' }).waitFor();

  await button(page, 'Add product').click();
  await page.getByLabel('Product URL').fill('https://shopee.co.id/fixture-shopee-i.123.456');
  await button(page, 'Import details').click();
  await page.getByRole('img', { name: 'Product photo', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Product name').inputValue(), 'Imported Shopee product');
  assert.equal(await page.getByLabel('Price', { exact: true }).inputValue(), '12,000');
  await button(page, 'Save draft').click();
  const shopee = page.getByRole('row').filter({ hasText: 'Imported Shopee product' });
  await shopee.waitFor();

  await page.reload();
  await page.getByLabel('Status', { exact: true }).selectOption('published');
  await page.getByText('No products match your filters.').waitFor();
  await page.getByLabel('Status', { exact: true }).selectOption('all');
  await page.getByLabel('Source', { exact: true }).selectOption('shopee');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await shopee.waitFor();
  assert.equal(await shopee.locator('img').evaluate(async img => { await img.decode(); return img.naturalWidth; }), 64);
  await button(shopee, 'Edit Imported Shopee product').click();
  assert.equal(await page.getByLabel('Price', { exact: true }).inputValue(), '12,000');
  await button(page, 'Cancel').click();
  await page.getByLabel('Source', { exact: true }).selectOption('all');
  await tote.locator('img').waitFor();
  assert.equal(await tote.locator('img').evaluate(async img => { await img.decode(); return img.naturalWidth; }), 64);
  await page.getByRole('searchbox', { name: 'Search products', exact: true }).fill('canvas');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await button(tote, 'Edit Canvas tote').click();
  await page.getByLabel('Product name').fill('Canvas tote updated');
  await page.getByText('Optional product details').click();
  await page.getByLabel('Color', { exact: true }).fill('Natural');
  await page.getByLabel('Product type', { exact: true }).fill('Tote');
  await page.getByLabel('Collection (optional)').selectOption('new');
  await page.getByLabel('Collection name').fill('Everyday');
  await button(page, 'Save changes').click();
  await tote.getByText('Everyday', { exact: true }).waitFor();
  await page.getByRole('searchbox', { name: 'Search products', exact: true }).fill('');
  await page.getByLabel('Sort', { exact: true }).selectOption('name');
  assert.match(await page.locator('tbody tr').first().innerText(), /Canvas tote/u);
  await tote.getByRole('checkbox', { name: 'Select Canvas tote updated' }).check();
  await shopee.getByRole('checkbox', { name: 'Select Imported Shopee product' }).check();
  await button(page, 'Publish').click();
  await tote.getByText('Published', { exact: true }).waitFor();
  await shopee.getByText('Published', { exact: true }).waitFor();

  await page.setViewportSize({ width: 1440, height: 860 });
  const collapse = button(page, 'Collapse sidebar');
  await collapse.press('Enter');
  assert.equal(await page.locator('.aw').getAttribute('data-collapsed'), 'true');
  await page.reload();
  await button(page, 'Expand sidebar').press('Enter');
  assert.equal(await page.locator('.aw').getAttribute('data-collapsed'), 'false');

  for (const width of widths) await layout(page, 'creator-products', width);
  await creatorSection('Overview');
  await page.getByText('Recent product activity').waitFor();
  for (const width of widths) await layout(page, 'creator-overview', width);
  await creatorSection('Storefront');
  await button(page, 'Preview storefront').click();
  await heading(page, 'Storefront preview').waitFor();
  const preview = page.getByRole('searchbox', { name: 'Search products' });
  await preview.fill('Canvas');
  await heading(page, 'Canvas tote updated').waitFor();
  await button(page, 'Back to storefront settings').click();
  await layout(page, 'creator-storefront-settings', 1440);
  await page.getByLabel('Storefront name').fill('Updated Browser Storefront');
  await button(page, 'Save name').click();
  await page.getByText('Storefront name saved.').waitFor();
  await page.locator('.aw-account summary').getByText('Updated Browser Storefront').waitFor();
  await button(page, 'Publish storefront').click();
  const link = page.getByRole('link', { name: 'View live storefront' });
  await link.waitFor();
  const href = await link.getAttribute('href');
  assert.ok(href?.startsWith('/store/'));
  await visitor.goto(href);
  await heading(visitor, 'Updated Browser Storefront').waitFor();
  await heading(visitor, 'Canvas tote updated').waitFor();
  await visitor.getByText('Natural · Tote', { exact: true }).waitFor();
  assert.equal(await heading(visitor, 'Imported desk lamp').count(), 0);

  const viewProduct = button(visitor, 'View product Canvas tote updated');
  await viewProduct.click();
  const productDialog = visitor.getByRole('dialog', { name: 'Canvas tote updated' });
  await productDialog.waitFor();
  assert.equal(await productDialog.getByRole('link', { name: /Open retailer/ }).getAttribute('href'), 'https://example.com/bag');
  assert.equal(await productDialog.locator('img').evaluate(async img => { await img.decode(); return img.naturalWidth; }), 64);
  await visitor.keyboard.press('Escape');
  await productDialog.waitFor({ state: 'hidden' });
  assert.equal(await viewProduct.evaluate(element => element === document.activeElement), true);
  await creatorSection('Appearance');
  await button(page, 'See more styles').click();
  for (const [label, preset] of [
    ['Simple & Clear', 'simple'], ['Bold & Distinctive', 'bold'], ['Elegant & Polished', 'elegant'],
    ['Bright & Dynamic', 'dynamic'], ['Magazine Style', 'magazine'], ['Playful & Relaxed', 'playful'],
  ]) {
    await page.locator('.studio-layout-option').filter({ hasText: label }).click();
    assert.equal(await page.getByRole('dialog').count(), 0, 'layout changes apply without confirmation');
    await page.locator('.studio-preview-frame .storefront-layout-' + preset).waitFor();
  }
  await button(page, 'Warm').click();
  assert.equal(await page.getByRole('dialog').count(), 0, 'color changes apply without confirmation');
  await page.locator('.studio-preview-frame .storefront-theme-gallery').waitFor();
  for (const width of widths) await layout(page, 'creator-appearance', width);
  await button(page, 'Apply & save draft').click();
  await page.getByText('Design draft saved to your account. Your public storefront has not changed.').waitFor();
  await visitor.reload();
  await visitor.locator('.storefront-theme-editorial').waitFor();
  for (const width of [320, 1024, 1440]) await layout(page, 'creator-appearance', width);
  await creatorSection('Storefront');
  await button(page, 'Publish saved design').click();
  await page.getByText('Storefront published.').waitFor();
  await visitor.reload();
  await visitor.locator('.storefront-theme-gallery').waitFor();
  await audit(visitor, '.storefront', 'Gallery storefront accessibility');
  await creatorSection('Products');
  await button(tote, 'Unpublish Canvas tote updated').click();
  await tote.getByText('Draft', { exact: true }).waitFor();
  await button(tote, 'Publish Canvas tote updated').click();
  await tote.getByText('Published', { exact: true }).waitFor();

  assert.equal((await page.request.get('/api/admin/workspace/products')).status(), 401);
  await visitor.goto('/admin');
  await visitor.getByLabel('Nama pengguna').fill(credentials.username);
  await visitor.getByLabel('Kata sandi').fill(password);
  await button(visitor, 'Masuk').click();
  await heading(visitor, 'Ringkasan').waitFor();
  await visitor.getByText('Produk kreator', { exact: true }).waitFor();
  for (const width of widths) await layout(visitor, 'superadmin-overview', width);
  const nav = visitor.getByRole('navigation', { name: 'Navigasi ruang kerja' });
  const select = label => nav.getByRole('link', { name: label, exact: true }).click();
  await select('Etalase');
  await button(visitor, 'Kelola produk kreator').click();
  await visitor.getByRole('row').filter({ hasText: 'Canvas tote updated' }).waitFor();
  for (const width of widths) await layout(visitor, 'superadmin-products', width);
  await button(visitor, 'Ubah tautan Canvas tote updated').click();
  const changeLink = visitor.getByRole('dialog', { name: 'Ubah tautan produk' });
  await changeLink.getByLabel('Tautan produk baru').fill('https://example.com/updated-bag');
  await changeLink.getByLabel('Alasan perubahan').fill('Listing lama sudah ditutup.');
  await button(changeLink, 'Simpan tautan').click();
  await visitor.getByText('Tautan produk diperbarui.').waitFor();
  await button(visitor, 'Tarik produk Imported Shopee product').click();
  const pullProduct = visitor.getByRole('dialog', { name: 'Tarik publikasi produk?' });
  await pullProduct.getByLabel('Alasan perubahan').fill('Peninjauan produk.');
  await button(pullProduct, 'Tarik publikasi').click();
  await visitor.getByText('Publikasi produk ditarik.').waitFor();
  await select('Pengguna');
  const studioUser = visitor.getByRole('row').filter({ hasText: 'Studio Browser' });
  await studioUser.waitFor();
  await studioUser.getByRole('button', { name: 'Studio Browser', exact: true }).click();
  const userDetail = visitor.getByRole('dialog', { name: 'Detail pengguna' });
  await userDetail.getByText(/Browser Storefront.*@/u).waitFor();
  await visitor.getByRole('button', { name: 'Tutup', exact: true }).click();
  await select('Etalase');
  await button(visitor, 'Tarik etalase Updated Browser Storefront').click();
  const offline = visitor.getByRole('dialog', { name: 'Tarik publikasi etalase?' });
  await offline.getByLabel('Alasan perubahan').fill('Peninjauan etalase.');
  await button(offline, 'Tarik publikasi').click();
  await visitor.getByText('Publikasi etalase ditarik.').waitFor();
  await select('Aktivitas audit');
  await visitor.getByText(/Tautan produk diubah.*Canvas tote updated/u).waitFor();
  await visitor.getByText(/Publikasi etalase ditarik.*Updated Browser Storefront/u).waitFor();
  await layout(visitor, 'superadmin-audit', 1440);
  await select('Analitik');
  await visitor.getByText('Segera Hadir').waitFor();
  await select('Pengaturan');
  await heading(visitor, 'Pengaturan platform').waitFor();
  await heading(visitor, 'Kesiapan layanan').waitFor();
  const databaseCheck = visitor.getByRole('listitem').filter({ hasText: 'Koneksi database dikonfigurasi pada server.' });
  await databaseCheck.getByText('Dikonfigurasi', { exact: true }).waitFor();
  await button(visitor, 'Menu akun').click();
  await button(visitor, 'Keluar').click();
  await heading(visitor, 'Masuk sebagai Superadmin').waitFor();
  assert.equal((await visitor.request.get('/api/admin/workspace/audit')).status(), 401);

  await visitor.goto(href);
  await heading(visitor, 'Storefront unavailable').waitFor();
  await creatorSection('Storefront');
  await button(page, 'Publish storefront').click();
  await link.waitFor();
  await visitor.reload();
  await viewProduct.click();
  assert.equal(await productDialog.getByRole('link', { name: /Open retailer/ }).getAttribute('href'), 'https://example.com/updated-bag');
  await visitor.keyboard.press('Escape');
  await button(page, 'Unpublish storefront').click();
  await button(page.getByRole('dialog', { name: 'Unpublish storefront' }), 'Unpublish storefront').click();
  await page.getByText('Storefront unpublished.').waitFor();

  await creatorSection('Products');
  await button(tote, 'Delete Canvas tote updated').click();
  const deletion = page.getByRole('dialog', { name: 'Delete product?' });
  await button(deletion, 'Cancel').click();
  await tote.waitFor();
  await button(tote, 'Delete Canvas tote updated').click();
  await button(deletion, 'Delete product').click();
  await page.getByText('Product deleted.').waitFor();
  await tote.waitFor({ state: 'hidden' });

  const owner = await db.creatorProfile.findUniqueOrThrow({ where: { userId }, select: { id: true } });
  await db.creatorProduct.createMany({ data: Array.from({ length: 9 }, (_, index) => ({
    id: randomUUID(), profileId: owner.id, title: 'Pagination fixture ' + index,
    url: 'https://example.com/fixture-' + index, description: '', category: '',
  })) });
  await page.reload();
  await button(page, 'Next page').click();
  assert.equal(await page.locator('tbody tr').count(), 1);
  await button(page, 'Previous page').click();
  assert.equal(await page.locator('tbody tr').count(), 10);
  await creatorSection('Analytics');
  await page.getByText('Coming soon').waitFor();
  await button(page, 'Ganti ke Bahasa Indonesia').click();
  await page.getByText('Segera Hadir').waitFor();
  await page.getByRole('link', { name: 'Ringkasan', exact: true }).click();
  await heading(page, 'Ringkasan').waitFor();
  await layout(page, 'creator-overview-id', 1440);
  await button(page, 'Switch to English').click();
  await db.userSession.updateMany({ where: { userId }, data: { expiresAt: new Date(0) } });
  await page.reload();
  await page.getByRole('link', { name: 'Sign in to Nanti' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Creator and Superadmin workspaces passed on MySQL at 320, 375, 768, 1024 and 1440 px.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await db.workspaceAudit.deleteMany({ where: { actor: credentials.username } });
  await db.adminSession.deleteMany({ where: { credentialScope: adminCredentialScope(credentials, secret) } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
}
