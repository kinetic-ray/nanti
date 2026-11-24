import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { image, mutation, path, recommendationFixture } from './recommendation-workspace-fixture.ts';

const fixture = await recommendationFixture(process.env.TEST_DATABASE_URL);
const server = createServer(fixture.app).listen(0, '127.0.0.1');
await once(server, 'listening');
const baseURL = 'http://127.0.0.1:' + server.address().port;
const artifacts = process.env.NANTI_BROWSER_ARTIFACTS ?? 'test-results/browser/recommendations';
const png = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#7953b0' } }).png().toBuffer();
let browser;
let owner;

try {
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.NANTI_BROWSER_PATH });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(image, route => route.fulfill({ contentType: 'image/png', body: png }));
  const button = (name, within = page) => within.getByRole('button', { name, exact: true });
  const screenshot = name => page.screenshot({ path: join(artifacts, name + '.png'), fullPage: true });

  await page.goto('/admin');
  await page.getByLabel('Nama pengguna').fill(fixture.username);
  await page.getByLabel('Kata sandi').fill(fixture.password);
  await button('Masuk').click();
  await page.getByRole('link', { name: 'Rekomendasi', exact: true }).click();
  await page.getByRole('heading', { name: 'Rekomendasi', exact: true }).waitFor();
  await page.getByLabel('Cari produk').fill(fixture.title);
  await button('Cari').click();
  await page.getByText('Produk tidak ditemukan', { exact: true }).waitFor();
  await screenshot('recommendation-workspace');
  await page.getByLabel('Cari produk').fill('');
  await button('Cari').click();

  const add = button('Tambahkan saran produk');
  await add.focus();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('dialog');
  await editor.waitFor();
  assert.equal(await editor.getByLabel('Tautan produk').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  await editor.waitFor({ state: 'hidden' });
  assert.equal(await add.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  await editor.getByLabel('Tautan produk').fill(fixture.listing);
  await button('Ambil detail produk', editor).click();
  await editor.getByText(fixture.title, { exact: true }).waitFor();
  await editor.locator('img').evaluate(img => img.decode());
  await editor.getByText(/800\.000/u).waitFor();
  assert.equal(await editor.getByLabel('Kategori utama').evaluate(el => el === document.activeElement), true);
  await screenshot('recommendation-add-preview');
  await editor.getByLabel('Kategori utama').fill('sneakers');
  await editor.getByLabel('Gaya', { exact: true }).fill('Retro');
  await editor.getByLabel('Kegunaan', { exact: true }).fill('Sehari-hari');
  await editor.getByLabel('Karakteristik', { exact: true }).fill('white');
  await button('Simpan draf', editor).click();
  await page.getByText('Draf tersimpan.', { exact: true }).waitFor();
  const row = page.getByRole('row').filter({ hasText: fixture.title });
  await row.getByText('Draf', { exact: true }).waitFor();
  await page.getByLabel('Cari produk').fill(fixture.title);
  await button('Cari').click();
  await page.getByText('1 hasil', { exact: true }).waitFor();

  const response = await context.request.get(path + '?q=' + encodeURIComponent(fixture.title));
  assert.equal(response.status(), 200);
  const [{ id }] = (await response.json()).products;
  assert.equal((await context.request.post('/api/session', { headers: mutation, data: {} })).status(), 200);
  const wishlistResponse = await context.request.post('/api/wishlists', { headers: mutation, data: { name: fixture.title, currency: 'IDR' } });
  assert.equal(wishlistResponse.status(), 201);
  const { id: wishlistId } = await wishlistResponse.json();
  const wishlist = await fixture.db.wishlist.findUniqueOrThrow({ where: { id: wishlistId } });
  owner = wishlist.ownerId;
  const source = await fixture.db.item.create({ data: { wishlistId, ownerId: owner, name: fixture.title,
    url: fixture.source, priceMinor: 100000000, quantity: 1,
  } });
  async function candidate(present) {
    const result = await context.request.post('/api/recommendations/alternatives', { headers: mutation, data: {
      itemId: source.id, wishlistId,
      answers: { practicalNeed: true, alreadyHave: false, useOften: true, canWait: true, withoutDiscount: true, socialPressure: false },
      finances: { cashMinor: '50000000', billsMinor: '10000000', setAsideMinor: '10000000' },
    } });
    assert.equal(result.status(), 200);
    assert.equal((await result.json()).alternatives.some(match => match.product.id === id), present);
  }
  await candidate(false);

  const edit = button('Edit ' + fixture.title, row);
  await edit.click();
  await editor.getByLabel('Gaya', { exact: true }).fill('Modern');
  await screenshot('recommendation-editor');
  await button('Simpan perubahan', editor).click();
  await page.getByText('Perubahan tersimpan.', { exact: true }).waitFor();
  await edit.click();
  await button('Terbitkan', editor).click();
  await row.getByText('Terbit', { exact: true }).waitFor();
  await candidate(true);
  await screenshot('recommendation-published');

  await edit.click();
  await button('Arsipkan', editor).click();
  await row.getByText('Diarsipkan', { exact: true }).waitFor();
  await candidate(false);
  await edit.click();
  await button('Pulihkan sebagai draf', editor).click();
  await row.getByText('Draf', { exact: true }).waitFor();
  await page.reload();
  await row.getByText('Draf', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await edit.click();
  assert.equal(await editor.getByLabel('Gaya', { exact: true }).inputValue(), 'Modern');
  const box = await editor.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
  await page.keyboard.press('Escape');
  await editor.waitFor({ state: 'hidden' });
  assert.equal(await edit.evaluate(el => el === document.activeElement), true);
  assert.deepEqual(errors, []);
  console.log('Superadmin recommendation browser journey passed, including candidate lifecycle, reload, mobile and keyboard focus.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  if (owner) await fixture.db.dataOwner.deleteMany({ where: { id: owner } });
  await fixture.close();
}
