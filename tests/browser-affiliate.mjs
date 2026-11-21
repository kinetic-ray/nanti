import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const baseURL = process.env.NANTI_BROWSER_BASE_URL ?? 'http://127.0.0.1:3000';
const username = process.env.NANTI_TEST_ADMIN_USERNAME;
const password = process.env.NANTI_TEST_ADMIN_PASSWORD;
const screenshots = process.env.NANTI_BROWSER_ARTIFACTS;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname) || !username || !password) {
  throw new Error('Use a local instance with an isolated database and set the test administrator credentials.');
}

const browser = await chromium.launch({
  executablePath: process.env.NANTI_BROWSER_PATH ??
    (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
  args: ['--disable-background-networking'], headless: true,
});
const createPage = () => browser.newPage({ baseURL, viewport: { width: 1365, height: 900 }, locale: 'en-US' });
const shopper = await createPage();
const admin = await createPage();
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const button = (root, name) => root.getByRole('button', { name, exact: true });
const modal = (root, name) => root.getByRole('dialog', { name, exact: true });
const show = (locator) => locator.waitFor({ state: 'visible' });
const step = async (name, work) => { await work(); console.log('PASS ' + name); };
const errors = [];
for (const page of [shopper, admin]) {
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript({ path: axePath });
}
if (screenshots) await mkdir(screenshots, { recursive: true });

async function axe(page, name) {
  const failures = await page.evaluate(async () => (await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
  })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })));
  assert.deepEqual(failures, [], name);
}

const article = String(randomInt(10_000_000, 99_999_999));
const original = `https://www.ikea.com/us/en/p/browser-fixture-${article}/`;
const candidate = `${original}?utm_source=isolated-browser-fixture`;
const title = `Fixture product ${article}`;
const headers = { 'X-Nanti-Request': '1', 'Content-Type': 'application/json' };
let wishlistId;
let activeHref;

async function addProduct(name, url) {
  await button(shopper, 'Tambah produk').click();
  const form = modal(shopper, 'Tambah produk');
  await button(form, 'Isi sendiri').click();
  await form.getByLabel('Nama produk', { exact: true }).fill(name);
  if (url) await form.getByLabel('Tempel tautan produk').fill(url);
  await button(form, 'Simpan produk').click();
  await show(shopper.getByRole('heading', { name, exact: true }));
}

try {
  await step('Original and missing purchase destinations in Indonesian', async () => {
    await shopper.goto('/');
    assert.equal(await shopper.locator('html').getAttribute('lang'), 'id');
    await button(shopper, 'Buat wishlist').click();
    await modal(shopper, 'Wishlist baru').getByLabel('Nama wishlist').fill('Browser affiliate QA');
    await button(modal(shopper, 'Wishlist baru'), 'Simpan wishlist').click();
    await show(shopper.getByRole('heading', { name: 'Browser affiliate QA' }));
    wishlistId = (await (await shopper.request.get('/api/wishlists')).json())[0].id;
    await addProduct(title, original);
    await addProduct('Item without a link');
    await button(shopper, `Bantu putuskan untuk ${title}`).click();
    let details = modal(shopper, title);
    const link = details.getByRole('link', { name: /^Beli produk/u });
    await show(link);
    assert.equal(await link.getAttribute('href'), original);
    assert.equal(await details.getByText(/komisi/u).count(), 0);
    await shopper.keyboard.press('Escape');
    await button(shopper, 'Bantu putuskan untuk Item without a link').click();
    details = modal(shopper, 'Item without a link');
    assert.equal(await button(details, 'Beli produk').isDisabled(), true);
    await show(details.getByText('Tambahkan link produk untuk memakai tombol ini.'));
    await shopper.keyboard.press('Escape');
  });

  await step('Separate administrator sign-in and explicit verification', async () => {
    await admin.goto('/admin');
    await admin.getByLabel('Username').fill(username);
    await admin.getByLabel('Password').fill(password);
    await button(admin, 'Sign in').click();
    await show(admin.getByRole('heading', { name: 'Affiliate opportunities' }));
    assert.equal(await admin.locator('html').getAttribute('lang'), 'en');
    await admin.getByRole('button', { name: new RegExp('IKEA article ' + article, 'u') }).click();
    await admin.getByLabel('Candidate affiliate URL').fill(candidate);
    await button(admin, 'Add candidate').click();
    await show(admin.getByText('Candidate saved for review.'));
    await button(admin, 'Verify and approve').click();
    const review = modal(admin, 'Verify and approve');
    await review.getByLabel('Verified product title').fill(title);
    await review.getByLabel('Color').fill('White');
    await review.getByLabel('Model').fill('Browser fixture');
    await review.getByLabel('Verification notes').fill('Isolated automated fixture confirming the same article and variant.');
    await review.getByRole('checkbox', { name: /I checked both listings/u }).check();
    await button(review, 'Verify and approve').click();
    await show(admin.getByText('Active verified mapping'));
    await show(admin.getByText('Verification and change history'));
    await axe(admin, 'desktop admin');
    if (screenshots) await admin.screenshot({ path: join(screenshots, 'affiliate-admin-desktop.png') });
  });

  await step('Disclosed affiliate purchase on mobile in both languages', async () => {
    await shopper.setViewportSize({ width: 390, height: 844 });
    await button(shopper, `Bantu putuskan untuk ${title}`).click();
    let details = modal(shopper, title);
    await show(details.getByText('Tautan ini bisa memberi Nanti komisi, tanpa biaya tambahan dari Nanti.'));
    let buy = details.getByRole('link', { name: /^Beli produk/u });
    assert.match((await buy.getAttribute('rel')) ?? '', /sponsored.*noopener.*noreferrer/u);
    assert.equal(await details.getByRole('link', { name: /^Buka link produk asli/u }).getAttribute('href'), original);
    activeHref = await buy.getAttribute('href');
    assert.match(activeHref, /^\/api\/wishlists\//u);
    const redirect = await shopper.request.get(activeHref, { maxRedirects: 0 });
    assert.equal(redirect.status(), 302);
    assert.equal(redirect.headers().location, candidate);
    assert.equal(await shopper.evaluate(() => document.documentElement.scrollWidth), 390);
    await axe(shopper, 'mobile Indonesian product');
    if (screenshots) await shopper.screenshot({ path: join(screenshots, 'affiliate-buy-mobile.png') });
    await shopper.keyboard.press('Escape');
    await button(shopper, 'Switch to English').click();
    await button(shopper, `Purchase tools for ${title}`).click();
    details = modal(shopper, title);
    buy = details.getByRole('link', { name: /^Buy product/u });
    await show(buy);
    await show(details.getByText('Nanti may earn a commission through this link, at no additional charge from Nanti.'));
    await show(details.getByRole('link', { name: /^Open original listing/u }));
    await shopper.keyboard.press('Escape');
  });

  await step('Revocation, immediate fallback, mobile inbox, and sign-out', async () => {
    await button(admin, 'Revoke').click();
    const review = modal(admin, 'Revoke');
    await review.getByLabel('Reason').fill('Isolated browser test finished.');
    await button(review, 'Revoke').click();
    await show(admin.getByText('Original listing only'));
    const fallback = await shopper.request.get(activeHref, { maxRedirects: 0 });
    assert.equal(fallback.status(), 302);
    assert.equal(fallback.headers().location, original);
    await button(shopper, `Purchase tools for ${title}`).click();
    const details = modal(shopper, title);
    const buy = details.getByRole('link', { name: /^Buy product/u });
    await show(buy);
    assert.equal(await buy.getAttribute('href'), original);
    assert.equal(await details.getByText(/commission/u).count(), 0);

    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.getByRole('button', { name: /^Inbox/u }).click();
    const event = admin.getByRole('listitem').filter({ hasText: 'Mapping revoked' });
    await show(event);
    const recordLink = event.getByRole('link', { name: 'Open product' });
    const recordHash = await recordLink.getAttribute('href');
    assert.match(recordHash, /^#opportunity-/u);
    await recordLink.click();
    await show(admin.getByRole('heading', { name: title, exact: true }));
    assert.equal(new URL(admin.url()).hash, recordHash);
    await admin.reload();
    await show(admin.getByRole('heading', { name: title, exact: true }));
    await admin.getByRole('button', { name: /^Inbox/u }).click();
    await button(event, 'Mark read').click();
    await show(button(event, 'Mark unread'));
    await button(event, 'Dismiss').click();
    await event.waitFor({ state: 'hidden' });
    assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth), 390);
    await axe(admin, 'mobile admin inbox');
    await button(admin, 'Sign out').click();
    await show(admin.getByRole('heading', { name: 'Administrator sign-in' }));
    assert.equal((await admin.request.get('/api/admin/notifications')).status(), 401);
  });
  assert.deepEqual(errors, []);
} finally {
  if (wishlistId) await shopper.request.delete(`/api/wishlists/${wishlistId}`, { headers, data: {} }).catch(() => undefined);
  await browser.close();
}
