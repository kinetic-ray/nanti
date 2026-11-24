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
    await modal(shopper, 'Kategori wishlist baru').getByLabel('Nama kategori wishlist').fill('Browser affiliate QA');
    await button(modal(shopper, 'Kategori wishlist baru'), 'Simpan wishlist').click();
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
    await admin.getByLabel('Nama pengguna').fill(username);
    await admin.getByLabel('Kata sandi').fill(password);
    await button(admin, 'Masuk').click();
    await admin.getByRole('link', { name: 'Produk', exact: true }).click();
    await show(admin.getByRole('heading', { name: 'Produk yang disimpan pengguna' }));
    await show(admin.getByText(`IKEA · ${article}`, { exact: true }));
    const submittedProduct = admin.locator('.aw-submission-list li').filter({ hasText: `IKEA · ${article}` });
    await show(submittedProduct.getByText('Menunggu tinjauan', { exact: true }));
    await show(admin.getByRole('link', { name: /Notifikasi, \d+ belum dibaca/u }));
    assert.equal(await admin.getByText(title, { exact: true }).count(), 0);
    await admin.getByRole('link', { name: 'Tautan afiliasi', exact: true }).click();
    await show(admin.getByRole('heading', { name: 'Peluang afiliasi' }));
    assert.equal(await admin.locator('html').getAttribute('lang'), 'id');
    await admin.getByRole('button', { name: new RegExp('IKEA artikel ' + article, 'u') }).click();
    await admin.getByLabel('URL kandidat afiliasi').fill(candidate);
    await button(admin, 'Tambahkan kandidat').click();
    await show(admin.getByText('Kandidat disimpan untuk ditinjau.'));
    await button(admin, 'Verifikasi dan setujui').click();
    const review = modal(admin, 'Verifikasi dan setujui');
    await review.getByLabel('Nama produk terverifikasi').fill(title);
    await review.getByLabel('Warna').fill('White');
    await review.getByLabel('Model').fill('Browser fixture');
    await review.getByLabel('Catatan verifikasi').fill('Isolated automated fixture confirming the same article and variant.');
    await review.getByRole('checkbox', { name: /Saya sudah memeriksa kedua listing/u }).check();
    await button(review, 'Verifikasi dan setujui').click();
    await show(admin.getByText('Pemetaan terverifikasi aktif'));
    await show(admin.getByText('Riwayat verifikasi dan perubahan'));
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
    await button(admin, 'Cabut').click();
    const review = modal(admin, 'Cabut');
    await review.getByLabel('Alasan').fill('Isolated browser test finished.');
    await button(review, 'Cabut').click();
    await show(admin.getByText('Tautan asli saja'));
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
    await admin.getByRole('button', { name: /^Kotak masuk/u }).click();
    const event = admin.getByRole('listitem').filter({ hasText: 'Pemetaan dicabut' }).filter({ hasText: title });
    await show(event);
    await button(admin, 'Tandai semua dibaca').click();
    await show(admin.getByRole('link', { name: 'Notifikasi', exact: true }));
    const recordLink = event.getByRole('link', { name: 'Buka' });
    const recordPath = await recordLink.getAttribute('href');
    const recordTarget = new URL(recordPath, baseURL);
    assert.equal(recordTarget.pathname, '/admin');
    assert.equal(recordTarget.search, '?section=links');
    assert.match(recordTarget.hash, /^#opportunity-/u);
    const targetNavigation = admin.waitForURL(recordTarget.href, { waitUntil: 'domcontentloaded' });
    await recordLink.click();
    await targetNavigation;
    await show(admin.getByRole('heading', { name: `IKEA artikel ${article}`, exact: true }));
    assert.equal(new URL(admin.url()).hash, recordTarget.hash);
    await admin.reload();
    await show(admin.getByRole('heading', { name: `IKEA artikel ${article}`, exact: true }));
    await button(admin, 'Pulihkan tautan').click();
    const restore = modal(admin, 'Pulihkan tautan');
    await restore.getByLabel('Catatan verifikasi').fill('Rechecked the same article and variant before restoring the direct affiliate link.');
    await restore.getByRole('checkbox', { name: /Saya sudah memeriksa kedua listing/u }).check();
    await button(restore, 'Pulihkan tautan').click();
    await show(admin.getByText('Pemetaan terverifikasi aktif'));
    const restored = await shopper.request.get(activeHref, { maxRedirects: 0 });
    assert.equal(restored.status(), 302);
    assert.equal(restored.headers().location, candidate);
    await button(admin, 'Nonaktifkan').click();
    const disable = modal(admin, 'Nonaktifkan');
    await disable.getByLabel('Alasan').fill('Restore flow browser test complete.');
    await button(disable, 'Nonaktifkan').click();
    await show(admin.getByText('Tautan asli saja'));
    await admin.getByRole('button', { name: /^Kotak masuk/u }).click();
    await button(event, 'Tandai belum dibaca').click();
    await show(button(event, 'Tandai sudah dibaca'));
    await button(event, 'Tandai sudah dibaca').click();
    await show(button(event, 'Tandai belum dibaca'));
    await button(event, 'Singkirkan').click();
    await event.waitFor({ state: 'hidden' });
    assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth), 390);
    await axe(admin, 'mobile admin inbox');
    await button(admin, 'Menu akun').click();
    await button(admin, 'Keluar').click();
    await show(admin.getByRole('heading', { name: 'Masuk sebagai Superadmin' }));
    assert.equal((await admin.request.get('/api/admin/notifications')).status(), 401);
  });
  assert.deepEqual(errors, []);
} finally {
  if (wishlistId) await shopper.request.delete(`/api/wishlists/${wishlistId}`, { headers, data: {} }).catch(() => undefined);
  await browser.close();
}
