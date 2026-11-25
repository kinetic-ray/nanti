import { requireTestDatabaseUrl } from './test-database-url.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

requireTestDatabaseUrl();

const baseURL = process.env.NANTI_BROWSER_BASE_URL ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('Run this fixture only against the disposable local MySQL browser server.');
}
const artifacts = process.env.NANTI_BROWSER_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.NANTI_BROWSER_PATH,
  args: ['--disable-background-networking'],
  headless: true,
});
const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
await context.addInitScript({ path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') });
const page = await context.newPage();
const listing = 'https://tokopedia.link/fixture-helmet?ref=e2e';
const imageUrl = 'https://images.tokopedia.net/fixtures/charger.jpg';
const previewPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=', 'base64');
let list;

try {
  await page.route(imageUrl, route => route.fulfill({ contentType: 'image/png', body: previewPng }));
  const readiness = await page.request.get('/api/health');
  assert.equal(readiness.ok(), true);
  assert.equal((await readiness.json()).status, 'ready');
  await page.goto('/');
  await page.getByRole('button', { name: 'Buat wishlist', exact: true }).click();
  const category = page.getByRole('dialog', { name: 'Kategori wishlist baru', exact: true });
  await category.getByLabel('Nama kategori wishlist').fill('Tokopedia import E2E fixture');
  await category.getByRole('button', { name: 'Simpan wishlist', exact: true }).click();
  await page.getByRole('heading', { name: 'Tokopedia import E2E fixture', exact: true }).waitFor();
  list = (await (await page.request.get('/api/wishlists')).json())
    .find(item => item.name === 'Tokopedia import E2E fixture');
  assert.ok(list?.id);

  await page.getByRole('button', { name: 'Tambah produk', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Tambah produk', exact: true });
  await form.getByLabel('Tempel tautan produk').fill(listing);
  await form.getByRole('button', { name: 'Cek link produk', exact: true }).click();
  await form.getByText('Charger INNERGIE 180W fixture', { exact: true }).waitFor();
  await form.locator('.import-preview img').evaluate(image => image.decode());
  assert.match(await form.getByLabel(/Harga satuan/u).inputValue(), /1[.,\s]?735[.,\s]?000/u);
  await form.getByText('Dari halaman toko · belum terverifikasi', { exact: true }).first().waitFor();
  if (artifacts) await page.screenshot({ path: join(artifacts, 'tokopedia-preview.png'), fullPage: true });
  await form.getByRole('button', { name: 'Simpan produk', exact: true }).click();

  const title = page.getByRole('heading', { name: 'Charger INNERGIE 180W fixture', exact: true });
  await title.waitFor();
  const saved = await (await page.request.get(`/api/wishlists/${list.id}`)).json();
  const item = saved.items.find(entry => entry.name === 'Charger INNERGIE 180W fixture');
  assert.ok(item?.id);
  assert.equal(item.priceMinor, 173_500_000);
  assert.match(item.imageKey, /^mysql\//u);
  assert.equal(item.url, listing);
  const row = page.locator('.products li').filter({ has: title });
  await row.getByText(/1\.735\.000/u).waitFor();
  const photo = row.locator('.product-media img');
  await photo.waitFor({ state: 'visible' });
  await photo.evaluate(image => image.decode());
  assert.equal(new URL(await photo.getAttribute('src'), baseURL).pathname,
    `/api/wishlists/${list.id}/items/${item.id}/uploaded-image`);
  if (artifacts) await page.screenshot({ path: join(artifacts, 'tokopedia-saved-wishlist.png'), fullPage: true });

  const storedPhoto = await page.request.get(await photo.getAttribute('src'));
  assert.equal(storedPhoto.status(), 200);
  assert.match(storedPhoto.headers()['content-type'] ?? '', /image\/jpeg/u);
  assert.equal(storedPhoto.headers()['cache-control'], 'private, no-store');
  const bytes = await storedPhoto.body();
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8]);

  const stranger = await browser.newContext({ baseURL });
  try {
    await stranger.request.post('/api/session', { headers: { 'X-Nanti-Request': '1' }, data: {} });
    assert.equal((await stranger.request.get(`/api/wishlists/${list.id}/items/${item.id}/uploaded-image`)).status(), 404);
  } finally {
    await stranger.close();
  }
  assert.deepEqual(await page.evaluate(async () => (await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
  })).violations.map(({ id }) => id)), []);
  console.log('PASS Tokopedia preview price, MySQL persistence, private JPEG reload, owner authorization, and wishlist rendering');
} catch (error) {
  if (artifacts) await page.screenshot({ path: join(artifacts, 'tokopedia-failure.png'), fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  if (list?.id) await page.request.delete(`/api/wishlists/${list.id}`, {
    headers: { 'X-Nanti-Request': '1' }, data: {},
  });
  await browser.close();
}
