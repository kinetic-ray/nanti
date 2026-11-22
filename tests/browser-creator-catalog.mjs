import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createApp } from '../server/app.ts';
import { connectDatabase } from '../server/database.ts';
import { prismaAccounts, tokenHash } from '../server/prisma-accounts.ts';
import { prismaWishlists } from '../server/prisma-wishlists.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname) ||
    !/_test$/u.test(new URL(databaseUrl).pathname)) {
  throw new Error('Set TEST_DATABASE_URL to a migrated local database whose name ends with _test.');
}
const db = connectDatabase(databaseUrl);
const userId = randomUUID();
const token = randomBytes(32).toString('base64url');
const app = createApp({
  repository: prismaWishlists(db), consumer: { accounts: prismaAccounts(db), providers: {} },
  preview: async () => null, secret: randomBytes(32).toString('hex'), secureCookies: false,
  // The upstream retailer is controlled. The browser, Express routes, sessions,
  // database writes and anonymous storefront are the real implementations.
  lookupMetadata: async url => url.pathname.endsWith('/fixture') ? {
    title: 'Imported desk lamp', image: null, price: { priceMinor: 8900000, currency: 'IDR' },
  } : null,
  webRoot: fileURLToPath(new URL('../dist/web/', import.meta.url)),
});
const server = createServer(app).listen(0, '127.0.0.1');
await once(server, 'listening');
const baseURL = 'http://127.0.0.1:' + server.address().port;
const axe = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const artifacts = process.env.NANTI_CREATOR_BROWSER_ARTIFACTS;
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
  page.on('pageerror', failure => console.error(failure));
  const guest = await browser.newContext({ baseURL });
  await guest.addInitScript(() => localStorage.setItem('nanti.language', 'en'));
  await guest.addInitScript({ path: axe });
  const visitor = await guest.newPage();
  visitor.setDefaultTimeout(12000);
  await page.goto('/creator/studio');
  await page.getByLabel('Creator name').fill('Browser Storefront');
  await page.getByRole('button', { name: 'Create creator profile' }).click();
  await page.getByRole('heading', { name: 'Make it yours.' }).waitFor();
  const account = page.getByRole('link', { name: 'Account', exact: true });
  assert.equal(await account.getAttribute('href'), '/account');
  assert.equal(await account.locator('.icon-person').count(), 1);
  await page.getByRole('button', { name: 'Publishing', exact: true }).click();
  await page.getByText('Your storefront is private').waitFor();
  await page.getByText('Add your first product to get started.').waitFor();
  await page.getByRole('button', { name: 'Manage products' }).click();
  await page.getByRole('button', { name: 'Add product' }).click();
  await audit(page, '.creator-workspace', 'Product editor accessibility at 390');
  if (artifacts) await page.screenshot({ path: join(artifacts, 'editor-390.png'), fullPage: true });
  await page.getByRole('button', { name: 'Import details' }).click();
  assert.equal(await page.locator('#catalog-url').getAttribute('aria-invalid'), 'true');
  await page.getByLabel('Product link').fill('https://example.com/bag');
  await page.getByRole('button', { name: 'Import details' }).click();
  await page.getByRole('status').getByText(/retailer details are unavailable/i).waitFor();
  await page.getByLabel('Product name').fill('Canvas tote');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    context.fillStyle = '#7953b0';
    context.fillRect(0, 0, 64, 64);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Product photo (optional)').setInputFiles({ name: 'tote.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  const tote = page.getByRole('listitem').filter({ hasText: 'Canvas tote' });
  await tote.getByText('Draft', { exact: true }).waitFor().catch(async failure => {
    const alert = await page.getByRole('alert').allTextContents();
    throw new Error('Draft save failed: ' + alert.join(' '), { cause: failure });
  });
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.getByLabel('Product link').fill('https://www.tokopedia.com/desk/fixture');
  await page.getByRole('button', { name: 'Import details' }).click();
  await page.waitForFunction(() => document.querySelector('#catalog-product-name')?.value === 'Imported desk lamp');
  assert.equal(await page.getByLabel('Price', { exact: true }).inputValue(), '89000');
  await page.getByLabel('Product photo (optional)').waitFor();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('heading', { name: 'Imported desk lamp' }).waitFor();
  await page.route('**/api/products/import/image?*', route => route.fulfill({
    contentType: 'image/png', body: Buffer.from(image, 'base64'),
  }));
  await page.route('**/api/products/import', route => route.fulfill({ json: {
    status: 'details_available', name: 'Complete fixture', price: { priceMinor: 1200000, currency: 'IDR' },
    imagePath: '/api/products/import/image?url=fixture',
  } }));
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.getByLabel('Product link').fill('https://example.com/complete');
  await page.getByRole('button', { name: 'Import details' }).click();
  await page.getByRole('img', { name: 'Product photo', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Product photo (optional)').count(), 0);
  assert.equal(await page.getByLabel('Product name').inputValue(), 'Complete fixture');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('heading', { name: 'Complete fixture' }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Products', exact: true }).click();
  await page.getByLabel('Status', { exact: true }).selectOption('published');
  await page.getByText('No products match your filters.').waitFor();
  await page.getByLabel('Status', { exact: true }).selectOption('all');
  await tote.locator('img').waitFor();
  assert.equal(await tote.locator('img').evaluate(async img => { await img.decode(); return img.naturalWidth; }), 64);
  await page.getByRole('searchbox', { name: 'Search products', exact: true }).fill('canvas');
  assert.equal(await page.locator('.catalog-card').count(), 1);
  await tote.getByRole('button', { name: 'Edit Canvas tote' }).click();
  await page.getByLabel('Product name').fill('Canvas tote updated');
  await page.getByText('Optional product details').click();
  await page.getByLabel('Color', { exact: true }).fill('Natural');
  await page.getByLabel('Product type', { exact: true }).fill('Tote');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Collection (optional)').selectOption('new');
  await page.getByLabel('Collection name').fill('Everyday');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await tote.getByText('Natural · Tote · Everyday', { exact: true }).waitFor();
  await tote.getByRole('button', { name: 'Publish Canvas tote updated' }).click();
  await tote.getByText('Published', { exact: true }).waitFor();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Studio overflows at ' + width);
    await audit(page, '.creator-workspace', 'Studio accessibility at ' + width);
    if (artifacts) await page.screenshot({ path: join(artifacts, 'studio-' + width + '.png'), fullPage: true });
  }
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.getByRole('searchbox', { name: 'Search products' });
  await preview.fill('Canvas');
  await page.getByRole('heading', { name: 'Canvas tote updated' }).waitFor();
  await page.getByRole('button', { name: 'Publishing', exact: true }).click();
  await audit(page, '.creator-workspace', 'Publishing accessibility');
  if (artifacts) await page.screenshot({ path: join(artifacts, 'publishing-1440.png'), fullPage: true });
  await page.getByLabel('Storefront name').fill('Updated Browser Storefront');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByText('Storefront name saved.').waitFor();
  await page.getByRole('button', { name: 'Publish storefront', exact: true }).click();
  const link = page.getByRole('link', { name: 'View live storefront' });
  await link.waitFor();
  const href = await link.getAttribute('href');
  assert.ok(href?.startsWith('/store/'));
  await visitor.goto(href);
  await visitor.getByRole('heading', { name: 'Updated Browser Storefront' }).waitFor();
  await visitor.getByRole('heading', { name: 'Canvas tote updated' }).waitFor();
  await visitor.getByText('Natural · Tote', { exact: true }).waitFor();
  assert.equal(await visitor.getByRole('heading', { name: 'Imported desk lamp' }).count(), 0);
  for (const width of [390, 768, 1440]) {
    await visitor.setViewportSize({ width, height: 844 });
    assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Storefront overflows at ' + width);
    await audit(visitor, '.storefront', 'Storefront accessibility at ' + width);
    if (artifacts) await visitor.screenshot({ path: join(artifacts, 'storefront-' + width + '.png'), fullPage: true });
  }
  const viewProduct = visitor.getByRole('button', { name: 'View product Canvas tote updated' });
  await viewProduct.click();
  const dialog = visitor.getByRole('dialog', { name: 'Canvas tote updated' });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('link', { name: /Open retailer/ }).getAttribute('href'), 'https://example.com/bag');
  assert.equal(await dialog.locator('img').evaluate(async img => { await img.decode(); return img.naturalWidth; }), 64);
  await visitor.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await viewProduct.evaluate(button => button === document.activeElement), true);
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Save design' }).click();
  await page.getByText('Draft saved to your account.').waitFor();
  await visitor.reload();
  await visitor.locator('.storefront-theme-editorial').waitFor();
  await page.getByRole('button', { name: 'Publishing', exact: true }).click();
  await page.getByRole('button', { name: 'Publish saved design' }).click();
  await page.getByText('Storefront published.').waitFor();
  await visitor.reload();
  await visitor.locator('.storefront-theme-gallery').waitFor();
  await audit(visitor, '.storefront', 'Gallery storefront accessibility');
  await page.getByRole('button', { name: 'Products', exact: true }).click();
  await tote.getByRole('button', { name: 'Unpublish Canvas tote updated' }).click();
  await tote.getByText('Draft', { exact: true }).waitFor();
  await visitor.reload();
  await visitor.getByText('No products yet.').waitFor();
  await page.getByRole('button', { name: 'Publishing', exact: true }).click();
  await page.getByRole('button', { name: 'Unpublish storefront' }).click();
  await page.getByRole('status').getByText('Storefront unpublished.').waitFor();
  await visitor.reload();
  await visitor.getByRole('heading', { name: 'Storefront unavailable' }).waitFor();
  await page.getByRole('button', { name: 'Products', exact: true }).click();
  await tote.getByRole('button', { name: 'Delete Canvas tote updated' }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete product?' });
  await deletion.getByRole('button', { name: 'Cancel' }).click();
  await tote.getByRole('heading', { name: 'Canvas tote updated' }).waitFor();
  await tote.getByRole('button', { name: 'Delete Canvas tote updated' }).click();
  await deletion.getByRole('button', { name: 'Delete product' }).click();
  await page.getByText('Product deleted.').waitFor();
  await db.userSession.updateMany({ where: { userId }, data: { expiresAt: new Date(0) } });
  await page.reload();
  await page.getByRole('link', { name: 'Sign in to Nanti' }).waitFor();
  console.log('Creator storefront journey passed on MySQL at 390, 768 and 1440 px.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
}
