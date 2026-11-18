import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const baseURL = process.env.NANTI_BROWSER_BASE_URL ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('Run the MVP browser fixture with a local app and an isolated database.');
}
const artifacts = process.env.NANTI_BROWSER_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.NANTI_BROWSER_PATH ??
    (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
  args: ['--disable-background-networking'], headless: true,
});
const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
await context.addInitScript({ path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') });
const page = await context.newPage();
const errors = [];
let list;
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(8000);
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const modal = name => page.getByRole('dialog', { name, exact: true });
const visible = target => target.waitFor({ state: 'visible' });
const escape = () => page.keyboard.press('Escape');
const listing = 'https://shopee.co.id/item-i.12345.67890?utm_source=nanti-browser-fixture';

async function axis(width) {
  const results = await page.evaluate(async () => ({
    width: document.documentElement.scrollWidth,
    dialogOverflow: [...document.querySelectorAll('dialog[open]')].some(dialog => dialog.scrollWidth > dialog.clientWidth + 1),
    violations: (await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })),
  }));
  assert.equal(results.width, width);
  assert.equal(results.dialogOverflow, false);
  assert.deepEqual(results.violations, []);
}

async function add(name, price, url) {
  await button(page, 'Tambah produk').click();
  const form = modal('Tambah produk');
  if (url) {
    const field = form.getByLabel('Tempel tautan produk');
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
    await page.evaluate(value => navigator.clipboard.writeText(value), url);
    await field.focus();
    await page.keyboard.press('Control+V');
    await visible(form.getByText('Toko terdeteksi: Shopee', { exact: true }));
    assert.equal(await form.getByLabel('Nama produk').inputValue(), '');
    assert.equal(await field.inputValue(), url);
  } else {
    await button(form, 'Isi sendiri').click();
  }
  await form.getByLabel('Nama produk').fill(name);
  await form.getByLabel(/Harga satuan/).fill(price);
  await button(form, 'Simpan produk').click();
  await visible(page.getByRole('heading', { name, exact: true }));
}

try {
  const readiness = await page.request.get('/api/health');
  assert.equal(readiness.ok(), true);
  assert.equal((await readiness.json()).status, 'ready');
  await page.goto('/');
  await button(page, 'Buat wishlist').click();
  const wishlist = modal('Wishlist baru');
  await wishlist.getByLabel('Nama wishlist').fill('MVP browser fixture');
  await button(wishlist, 'Simpan wishlist').click();
  await visible(page.getByRole('heading', { name: 'MVP browser fixture', exact: true }));
  list = (await (await page.request.get('/api/wishlists')).json()).find(entry => entry.name === 'MVP browser fixture');
  await add('Lampu manual', '60000,50');
  await add('Lampu dari Shopee', '100000,25', listing);
  const ikea = 'https://www.ikea.com/us/en/p/fixture-light-12345678/';
  const imagePath = '/api/products/import/image?url=' + encodeURIComponent(ikea);
  await page.route('**/api/products/import', route => route.fulfill({ json: {
    merchant: 'ikea', hostname: 'www.ikea.com', originalUrl: ikea, name: 'Lampu fixture IKEA',
    status: 'details_available', price: { priceMinor: 1500050, currency: 'IDR' }, imagePath,
  } }), { times: 1 });
  await page.route('**/api/products/import/image?*', route => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=', 'base64'),
  }), { times: 1 });
  await page.setViewportSize({ width: 390, height: 800 });
  await button(page, 'Tambah produk').click();
  const imported = modal('Tambah produk');
  await imported.getByLabel('Tempel tautan produk').fill(ikea);
  await button(imported, 'Cek link produk').click();
  await visible(imported.getByText('Lampu fixture IKEA', { exact: true }));
  const photo = imported.locator('.import-preview img');
  await photo.evaluate(image => image.decode());
  assert.equal(await imported.getByLabel('Nama produk').inputValue(), 'Lampu fixture IKEA');
  assert.equal(await imported.getByLabel(/Harga satuan/).inputValue(), '15000,50');
  await visible(imported.getByText('Dari halaman toko · belum terverifikasi', { exact: true }).first());
  await axis(390);
  if (artifacts) await page.screenshot({ path: join(artifacts, 'import-review-390.png') });
  await button(imported, 'Simpan produk').click();
  await visible(page.getByRole('heading', { name: 'Lampu fixture IKEA', exact: true }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await button(page, 'Edit Lampu manual').click();
  const edit = modal('Edit produk');
  await edit.getByLabel('Jumlah', { exact: true }).fill('2');
  await button(edit, 'Simpan produk').click();
  await visible(page.getByText(/Jumlah 2/));
  await axis(1280);
  console.log('PASS desktop startup, guest wishlist, manual and assisted link entry, quantity edit');

  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await button(page, 'Cek kesiapan beli wishlist').click();
  const timing = modal('Cek kesiapan beli');
  assert.equal(await timing.getByLabel('Dana yang tersedia', { exact: true }).isVisible(), false);
  await button(timing, 'Aman').click();
  await visible(timing.getByRole('heading', { name: 'Kebutuhan penting masih aman', exact: true }));
  await visible(timing.getByText('Hasil ini mengikuti jawabanmu. Nanti belum menghitung anggaranmu.', { exact: true }));
  await button(timing, 'Simpan keputusan').click();
  await visible(timing.getByText('Keputusan sudah disimpan.', { exact: true }));
  await escape();

  await button(page, 'Bantu putuskan untuk Lampu dari Shopee').click();
  const item = modal('Lampu dari Shopee');
  await button(item, 'Riwayat dan notifikasi harga').click();
  const prices = modal('Riwayat dan notifikasi harga');
  await visible(prices.getByText('Catat harga lain untuk melihat perubahannya.', { exact: true }));
  assert.equal(await prices.locator('.price-chart').count(), 0);
  await button(prices, 'Atur target harga').click();
  await prices.getByLabel('Target harga satuan (IDR)').fill('90000,50');
  await button(prices, 'Simpan target harga').click();
  await visible(prices.getByText('Target harga tersimpan.', { exact: true }));
  await button(prices, 'Catat harga').click();
  await prices.getByLabel('Harga satuan baru (IDR)').fill('85000,25');
  await prices.getByLabel('Sumber harga').selectOption('imported_unverified');
  await button(prices, 'Simpan catatan harga').click();
  await visible(prices.getByText('Harga sudah dicatat.', { exact: true }));
  await visible(prices.getByText('2 catatan harga terakhir', { exact: true }));
  assert.equal(await prices.locator('.price-log li').count(), 2);
  assert.ok(await prices.locator('.price-chart-bars span').last().evaluate(bar => parseFloat(getComputedStyle(bar).height) > 0));
  await axis(360);
  if (artifacts) {
    await prices.locator('.price-chart').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(artifacts, 'price-history-360.png') });
  }
  await escape();
  await context.route('https://shopee.co.id/**', route => route.fulfill({
    contentType: 'text/html', body: '<title>Original listing navigation fixture</title>',
  }));
  const [opened] = await Promise.all([
    page.waitForEvent('popup'),
    item.getByRole('link', { name: /^Beli produk/u }).click(),
  ]);
  await opened.waitForLoadState();
  assert.equal(opened.url(), listing);
  await opened.close();
  await escape();

  await page.setViewportSize({ width: 390, height: 844 });
  await visible(page.locator('.price-alert-entry > span:nth-child(2)'));
  await button(page, 'Notifikasi harga').click();
  const alerts = modal('Notifikasi harga');
  await visible(alerts.getByText(/^Target tercapai di/u));
  await visible(alerts.getByText(/^Disalin dari toko · belum terverifikasi/u));
  await axis(390);
  if (artifacts) await page.screenshot({ path: join(artifacts, 'price-alert-390.png') });
  await button(alerts, 'Tandai semua sudah dibaca').click();
  await alerts.getByText('Belum dibaca', { exact: true }).waitFor({ state: 'hidden' });
  await escape();
  await button(page, 'Cek kesiapan beli wishlist').click();
  await timing.locator('summary').filter({ hasText: /^Keputusan sebelumnya$/u }).click();
  await visible(timing.getByText('Perlu dicek ulang', { exact: true }));
  await escape();
  console.log('PASS mobile price entry, truthful provenance, target alert, original link fallback and assessment freshness');

  const { items } = await (await page.request.get(`/api/wishlists/${list.id}`)).json();
  const product = items.find(entry => entry.name === 'Lampu dari Shopee');
  const path = `/api/wishlists/${list.id}/items/${product.id}/prices`;
  const stranger = await browser.newContext({ baseURL });
  await stranger.request.post('/api/session', { headers: { 'X-Nanti-Request': '1' }, data: {} });
  assert.equal((await stranger.request.get(path)).status(), 404);
  assert.deepEqual(await (await stranger.request.get('/api/prices/alerts')).json(), { alerts: [], unread: 0 });
  await stranger.close();

  await button(page, 'English').click();
  await page.reload();
  await visible(button(page, 'Price alerts'));
  const stored = await (await page.request.get(path)).json();
  assert.equal(stored.currentMinor, 8_500_025);
  assert.equal(stored.target.priceMinor, 9_000_050);
  assert.equal(stored.observations.length, 2);
  await button(page, 'Sign in').click();
  const account = modal('Sign in to Nanti');
  await button(account, 'Continue as guest').click();
  await visible(page.getByRole('heading', { name: 'MVP browser fixture', exact: true }));
  assert.deepEqual(errors, []);
  console.log('PASS persistent history and target after refresh, English localization, guest account page and browser isolation');
} finally {
  if (list) await page.request.delete(`/api/wishlists/${list.id}`, { headers: { 'X-Nanti-Request': '1' }, data: {} });
  await browser.close();
}
