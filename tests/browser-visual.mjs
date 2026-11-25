import { requireTestDatabaseUrl } from './test-database-url.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

if (process.env.DATABASE_URL !== requireTestDatabaseUrl()) {
  throw new Error('Use the same local DATABASE_URL and TEST_DATABASE_URL for the browser server.');
}

const baseURL = process.env.NANTI_BROWSER_BASE_URL ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('Run visual fixtures against a local app with an isolated database.');
}
const artifacts = process.env.NANTI_BROWSER_ARTIFACTS;
const reference = process.env.NANTI_VISUAL_REFERENCE === '1';
const sizes = [320, 360, 390, 430, 768, 1280, 1440];
const axe = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const products = [
  { name: 'TERTIAL', priceMinor: 1999, slug: 'tertial-work-lamp-dark-gray-20355434' },
  { name: 'SKÅDIS', priceMinor: 2499, slug: 'skadis-pegboard-white-00320803' },
  { name: 'ALEX', priceMinor: 6999, slug: 'alex-drawer-unit-white-60586908' },
];
const mutation = { 'X-Nanti-Request': '1', 'Content-Type': 'application/json' };
const browser = await chromium.launch({
  executablePath: process.env.NANTI_BROWSER_PATH ??
    (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
  args: ['--disable-background-networking'], headless: true,
});
const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 850 } });
const page = await context.newPage();
const errors = [];
const lists = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(8000);
await page.addInitScript({ path: axe });
if (artifacts) await mkdir(artifacts, { recursive: true });

const button = (name, parent = page) => parent.getByRole('button', { name, exact: true });
const dialog = name => page.getByRole('dialog', { name, exact: true });
const visible = locator => locator.waitFor({ state: 'visible' });

async function api(path, method, data) {
  const response = await context.request.fetch('/api' + path, { method, headers: mutation, data });
  assert.equal(response.ok(), true, await response.text());
  return response;
}

async function capture(name) {
  if (!artifacts) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(artifacts, name + '.png'), fullPage: true, animations: 'disabled' });
}

async function inspect(label, full = true) {
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    dialogs: [...document.querySelectorAll('dialog[open]')].every(element => element.scrollWidth <= element.clientWidth + 1),
    bodies: [...document.querySelectorAll('dialog[open] > .dialog-content')].every(element => element.scrollWidth <= element.clientWidth + 1),
  }));
  assert.equal(layout.document, layout.viewport, label);
  assert.equal(layout.dialogs, true, label);
  assert.equal(layout.bodies, true, label);
  if (!full) return;
  const failures = await page.evaluate(async () => (await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
  })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => node.target) })));
  assert.deepEqual(failures, [], label);
}

try {
  await page.goto('/');
  const create = button('Buat wishlist');
  await visible(create);
  for (const width of sizes) {
    await page.setViewportSize({ width, height: width < 769 ? 850 : 960 });
    await capture(`home-${width}`);
    if (!reference) await inspect(`${width}px Indonesian home`);
    if (!reference && width === 320) {
      const compact = await page.locator('.masthead').evaluate(header => {
        const brand = header.querySelector('.brand-group').getBoundingClientRect();
        const controls = header.querySelector('.masthead-controls').getBoundingClientRect();
        return Math.abs((brand.top + brand.height / 2) - (controls.top + controls.height / 2)) < 1;
      });
      assert.equal(compact, true, '320px navigation fits in one row at default text size');
    }
  }
  await page.setViewportSize({ width: 390, height: 850 });
  await page.route('**/api/account', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), available: ['google', 'apple'] } });
  }, { times: 1 });
  await button('Masuk').focus();
  await page.keyboard.press('Enter');
  const account = dialog('Masuk ke Nanti');
  await visible(account);
  await visible(button('Lanjut dengan Apple', account));
  await capture('sign-in-390');
  if (!reference) {
    assert.equal(await account.getByRole('heading').evaluate(heading => heading === document.activeElement), true);
    await inspect('390px sign-in');
  }
  await page.keyboard.press('Escape');
  assert.equal(await button('Masuk').evaluate(trigger => trigger === document.activeElement), true);

  for (const [name, currency] of [['Sudut kerja', 'USD'], ['Upgrade kamar', 'IDR']]) {
    lists.push(await (await api('/wishlists', 'POST', { name, currency })).json());
  }
  const [first, second] = lists;
  for (const { name, priceMinor, slug } of products) {
    await api(`/wishlists/${first.id}/items`, 'POST', {
      name, priceMinor, quantity: 1, url: `https://www.ikea.com/us/en/p/${slug}/`,
    });
  }
  await page.reload();
  await visible(page.getByRole('heading', { name: 'TERTIAL', exact: true }));
  const loadedPhotos = await page.locator('.products img').evaluateAll(async images => {
    await Promise.race([
      Promise.all(images.map(image => image.decode().catch(() => undefined))),
      new Promise(resolve => setTimeout(resolve, 7500)),
    ]);
    return images.filter(image => image.complete && image.naturalWidth > 0).length;
  });
  for (const width of sizes) {
    await page.setViewportSize({ width, height: width < 769 ? 850 : 960 });
    if (!reference) await inspect(`${width}px wishlist`);
    await capture(`wishlist-${width}`);
  }
  console.log(`PASS render at ${sizes.join(', ')}px (${loadedPhotos}/${products.length} retailer photos available)`);

  await page.setViewportSize({ width: 390, height: 850 });
  const product = button('Bantu putuskan untuk TERTIAL');
  await product.focus();
  await page.keyboard.press('Enter');
  const detail = dialog('TERTIAL');
  await visible(detail);
  await detail.getByRole('link', { name: /^Beli produk/u }).waitFor();
  if (!reference) await inspect('390px product detail');
  await capture('product-390');
  async function buyingReflection() {
    await button('Bantu putuskan beli', detail).click();
    const decision = dialog('Bantu putuskan beli');
    await visible(decision);
    await button('Lanjutkan dengan analisis terbatas', decision).click();
    await decision.locator('.guided-reasons summary').click();
    await visible(decision.locator('.guided-reasons fieldset').first());
    assert.equal(await decision.locator('.guided-reasons fieldset').count(), 6);
    return decision;
  }
  const decision = await buyingReflection();
  if (!reference) await inspect('390px buying reflection');
  await capture('impulse-390');
  await button('Selesai', decision).click();
  await visible(detail);
  await page.keyboard.press('Escape');
  assert.equal(await product.evaluate(active => active === document.activeElement), true);

  await button('Bandingkan prioritas').click();
  const comparison = dialog('Bandingkan prioritas');
  await visible(comparison);
  if (!reference) await inspect('390px comparison');
  await capture('comparison-390');
  await page.keyboard.press('Escape');

  await button('Cek kesiapan beli wishlist').click();
  const timing = dialog('Cek kesiapan beli');
  await visible(timing);
  assert.equal(await timing.getByLabel('Dana yang tersedia', { exact: true }).isVisible(), false);
  await button('Agak mepet', timing).click();
  await visible(timing.getByRole('heading', { name: 'Anggarannya agak mepet', exact: true }));
  if (!reference) await inspect('390px timing result');
  await capture('timing-390');
  await button('Simpan keputusan', timing).click();
  await visible(timing.getByText('Keputusan sudah disimpan.', { exact: true }));
  await page.keyboard.press('Escape');

  const { items } = await (await api(`/wishlists/${first.id}`, 'GET')).json();
  const { id: itemId, ...changed } = items.find(item => item.name === 'TERTIAL');
  await api(`/wishlists/${first.id}/items/${itemId}`, 'PUT', { ...changed, quantity: 2 });
  await page.reload();
  await button('Cek kesiapan beli wishlist').click();
  await timing.locator('summary').filter({ hasText: /^Keputusan sebelumnya$/u }).click();
  const reviewBadge = timing.getByText('Perlu dicek ulang', { exact: true });
  await visible(reviewBadge);
  await reviewBadge.scrollIntoViewIfNeeded();
  if (!reference) await inspect('390px saved timing history');
  await capture('history-390');
  await page.keyboard.press('Escape');

  if (!reference) {
    for (const width of sizes) {
      await page.setViewportSize({ width, height: width < 769 ? 800 : 960 });
      await button('Tambah produk').click();
      const add = dialog('Tambah produk');
      await visible(add);
      await inspect(`${width}px URL import`);
      if (width === 320) await capture('import-320');
      await button('Isi sendiri', add).click();
      await visible(add.getByLabel('Nama produk'));
      await inspect(`${width}px manual entry`, false);
      await button('Batal', add).click();
      await add.waitFor({ state: 'hidden' });

      await button('Bandingkan prioritas').click();
      await comparison.getByRole('checkbox', { name: 'TERTIAL' }).check();
      await button('Tentukan prioritas', comparison).click();
      const ratings = comparison.getByRole('group', { name: 'TERTIAL' }).getByRole('combobox');
      for (let index = 0; index < 4; index++) await ratings.nth(index).selectOption('2');
      await button('Lihat prioritas', comparison).click();
      await visible(comparison.getByRole('heading', { name: 'Pertimbanganmu' }));
      await inspect(`${width}px one-item priority result`);
      await page.keyboard.press('Escape');

      await product.click();
      await inspect(`${width}px product detail`, false);
      const reflection = await buyingReflection();
      await inspect(`${width}px buying reasons`, false);
      await button('Selesai', reflection).click();
      await button('Riwayat dan notifikasi harga', detail).click();
      await visible(dialog('Riwayat dan notifikasi harga'));
      await inspect(`${width}px price history`, false);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      await button('Notifikasi harga').click();
      await visible(dialog('Notifikasi harga'));
      await inspect(`${width}px target alerts`, false);
      await page.keyboard.press('Escape');

      await button('Cek kesiapan beli wishlist').click();
      await visible(button('Belum yakin', timing));
      await inspect(`${width}px readiness question`, false);
      await timing.locator('summary').filter({ hasText: /^Keputusan sebelumnya$/u }).click();
      await visible(timing.getByText('Perlu dicek ulang', { exact: true }));
      await inspect(`${width}px decision history`, false);
      await page.keyboard.press('Escape');

      await button('Masuk').click();
      await visible(account);
      await inspect(`${width}px sign in`, false);
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 390, height: 850 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduce = await product.evaluate(element => ({
      requested: matchMedia('(prefers-reduced-motion: reduce)').matches,
      seconds: parseFloat(getComputedStyle(element).transitionDuration),
    }));
    assert.equal(reduce.requested, true);
    assert.ok(reduce.seconds <= .01);
    const primary = await button('Tambah produk').boundingBox();
    assert.ok(primary && primary.height >= 44 && primary.width >= 44);
    assert.ok(primary.y + primary.height <= 850);

    await page.setViewportSize({ width: 320, height: 850 });
    await inspect('320px WCAG reflow', false);
    await page.setViewportSize({ width: 320, height: 380 });
    await button('Tambah produk').click();
    const smallImport = dialog('Tambah produk');
    await button('Isi sendiri', smallImport).click();
    const smallBody = smallImport.locator('.dialog-content');
    assert.equal(await page.locator('html').evaluate(html => getComputedStyle(html).overflowY), 'hidden');
    assert.equal(await smallBody.evaluate(body => body.scrollHeight > body.clientHeight), true);
    const save = button('Simpan produk', smallImport);
    await save.focus();
    const focused = await save.boundingBox();
    assert.ok(focused && focused.y >= 0 && focused.y + focused.height <= 380);
    for (let index = 0; index < 7; index++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement === document.body ||
        Boolean(document.activeElement.closest('dialog[open]'))), true);
    }
    await capture('import-short-viewport');
    await page.keyboard.press('Escape');
    await visible(smallImport);
    await button('Batal', smallImport).click();
    await smallImport.waitFor({ state: 'hidden' });
    assert.equal(await button('Tambah produk').evaluate(trigger => trigger === document.activeElement), true);
    await page.setViewportSize({ width: 390, height: 850 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await inspect('200% text resizing', false);
    await button('Tambah produk').click();
    await visible(dialog('Tambah produk'));
    await inspect('200% text resizing in a form', false);
    await button('Batal', dialog('Tambah produk')).click();
    await dialog('Tambah produk').waitFor({ state: 'hidden' });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });

    const picker = page.locator('.collection-picker select');
    await picker.selectOption(second.id);
    await visible(page.getByRole('heading', { name: second.name, exact: true }));
    const collectionPath = `**/api/wishlists/${first.id}`;
    await page.route(collectionPath, route => route.fulfill({
      status: 503, json: { error: 'Something went wrong. Try again.' },
    }), { times: 1 });
    await picker.selectOption(first.id);
    await visible(page.getByRole('alert'));
    await button('Coba lagi').click();
    await visible(page.getByRole('heading', { name: 'TERTIAL', exact: true }));
    await button('Switch to English').click();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await inspect('390px English wishlist');
    const mediaPath = `**/api/wishlists/${first.id}/items/${itemId}/image`;
    await page.route(mediaPath, route => route.fulfill({ status: 404 }), { times: 1 });
    const imageFailure = page.waitForResponse(response => response.url().endsWith(`/items/${itemId}/image`) && response.status() === 404);
    await page.reload();
    await imageFailure;
    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'TERTIAL', exact: true }) });
    await visible(card.locator('.product-media span'));
    await card.locator('.product-media img').waitFor({ state: 'detached' });
    console.log('PASS WCAG 2.2 axe checks, keyboard focus return, reduced motion, 320px reflow, 200% text, touch target, error recovery and image fallback');
  }
  assert.deepEqual(errors, []);
} finally {
  for (const { id } of lists) await api(`/wishlists/${id}`, 'DELETE', {});
  await browser.close();
}
