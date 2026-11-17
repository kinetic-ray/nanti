import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const baseURL = process.env.NANTI_BROWSER_BASE_URL ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('Run visual fixtures against a local app with an isolated database.');
}
const artifacts = process.env.NANTI_BROWSER_ARTIFACTS;
const reference = process.env.NANTI_VISUAL_REFERENCE === '1';
const sizes = [360, 390, 430, 768, 1280, 1440];
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
  }));
  assert.equal(layout.document, layout.viewport, label);
  assert.equal(layout.dialogs, true, label);
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
  await capture('home-390');
  if (!reference) await inspect('390px Indonesian home');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture('home-1440');
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
  await button('Cek alasan beli', detail).click();
  const impulse = dialog('Cek alasan beli');
  await visible(impulse);
  if (!reference) {
    await visible(impulse.getByRole('progressbar'));
    await inspect('390px first impulse question');
  }
  await capture('impulse-390');
  await page.keyboard.press('Escape');
  assert.equal(await button('Cek alasan beli', detail).evaluate(active => active === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await product.evaluate(active => active === document.activeElement), true);

  await button('Bandingkan produk').click();
  const comparison = dialog('Bandingkan pilihanmu');
  await visible(comparison);
  if (!reference) await inspect('390px comparison');
  await capture('comparison-390');
  await page.keyboard.press('Escape');

  await button('Cek kesiapan beli wishlist').click();
  const timing = dialog('Cek kesiapan keuangan');
  await visible(timing);
  await timing.getByLabel('Dana yang tersedia', { exact: true }).fill('200');
  await timing.getByLabel('Tagihan dan kebutuhan wajib', { exact: true }).fill('10');
  await timing.getByLabel('Dana cadangan', { exact: true }).fill('30');
  await button('Cek kesiapan beli', timing).click();
  await visible(timing.getByRole('heading', { name: 'Dana cukup', exact: true }));
  if (!reference) await inspect('390px timing result');
  await capture('timing-390');
  await button('Simpan cek kesiapan', timing).click();
  await visible(timing.getByText('Cek kesiapan sudah disimpan.', { exact: true }));
  await page.keyboard.press('Escape');

  const { items } = await (await api(`/wishlists/${first.id}`, 'GET')).json();
  const { id: itemId, ...changed } = items.find(item => item.name === 'TERTIAL');
  await api(`/wishlists/${first.id}/items/${itemId}`, 'PUT', { ...changed, quantity: 2 });
  await page.reload();
  await button('Cek kesiapan beli wishlist').click();
  await timing.getByText('Cek kesiapan tersimpan', { exact: true }).click();
  const reviewBadge = timing.getByText('Perlu dicek ulang', { exact: true });
  await visible(reviewBadge);
  await reviewBadge.scrollIntoViewIfNeeded();
  if (!reference) await inspect('390px saved timing history');
  await capture('history-390');
  await page.keyboard.press('Escape');

  if (!reference) {
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
    await page.setViewportSize({ width: 390, height: 850 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await inspect('200% text resizing', false);
    await button('Tambah produk').click();
    await visible(dialog('Tambah produk'));
    await inspect('200% text resizing in a form', false);
    await page.keyboard.press('Escape');
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
    await button('English').click();
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
