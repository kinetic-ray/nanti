import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const baseURL = process.env.NANTI_BROWSER_BASE_URL ?? 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('Run this fixture against a local Nanti instance using an isolated test database.');
}
const screenshots = process.env.NANTI_BROWSER_ARTIFACTS;
if (screenshots) await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.NANTI_BROWSER_PATH ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
  args: ['--disable-background-networking'],
  headless: true,
});
const axePath = require.resolve('axe-core/axe.min.js');
const page = await browser.newPage({ baseURL, viewport: { width: 1365, height: 900 }, locale: 'en-US' });
page.setDefaultTimeout(6500);
const errors = [];
let wishlistId;
let secondList;
page.on('pageerror', (error) => errors.push(String(error)));
const button = (role, name) => role.getByRole('button', { name, exact: true });
const dialog = (name) => page.getByRole('dialog', { name, exact: true });
const shown = (locator) => locator.waitFor({ state: 'visible' });
const step = async (label, work) => { await work(); console.log('PASS ' + label); };
async function focusIs(locator) {
  await locator.evaluate((element) => new Promise((resolve, reject) => {
    let attempts = 0;
    function check() {
      if (document.activeElement === element) return resolve();
      if (++attempts >= 45) return reject(new Error('Expected focus on ' + element.outerHTML + ' but got ' + document.activeElement?.outerHTML));
      requestAnimationFrame(check);
    }
    check();
  }));
}
async function axe(label) {

  const failures = await page.evaluate(async () => {
    const report = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
    return report.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
  });
  assert.deepEqual(failures, [], label);
}
async function product(name, price, quantity) {
  await button(page, 'Tambah produk').click();
  const form = dialog('Tambah produk');
  await button(form, 'Isi sendiri').click();
  await form.getByLabel('Nama produk').fill(name);
  if (price) await form.getByLabel(/Harga satuan/).fill(price);
  await form.getByLabel('Jumlah', { exact: true }).fill(String(quantity));
  await button(form, 'Simpan produk').click();
  await shown(page.getByRole('heading', { name, exact: true }));
}
async function budget(form, available) {
  await form.getByLabel('Dana yang tersedia', { exact: true }).fill(available);
  await form.getByLabel('Tagihan dan kebutuhan wajib', { exact: true }).fill('0');
  await form.getByLabel('Dana cadangan', { exact: true }).fill('0');
}
async function closeTop() { await page.keyboard.press('Escape'); }
async function editLamp() {
  await button(page, 'Edit Lamp A50').click();
  const form = dialog('Edit produk');
  await form.getByLabel(/Harga satuan/).fill('60000,25');
  await form.getByLabel('Jumlah', { exact: true }).fill('3');
  await button(form, 'Simpan produk').click();
  await shown(page.getByText('Jumlah 3', { exact: false }));
}
try {
  await page.addInitScript({ path: axePath });
  await page.goto('/');
  await step('Indonesian default, Phase 1 CRUD, exact Indonesian currency', async () => {
    assert.equal(await page.locator('html').getAttribute('lang'), 'id');
    await button(page, 'Buat wishlist').click();
    const form = dialog('Wishlist baru');
    await form.getByLabel('Nama wishlist').fill('Rencana kamar');
    assert.equal(await form.getByLabel('Mata uang').inputValue(), 'IDR');
    await button(form, 'Simpan wishlist').click();
    await shown(page.getByRole('heading', { name: 'Rencana kamar', exact: true }));
    const fixture = await page.request.get('/api/wishlists');
    wishlistId = (await fixture.json())[0].id;
    await product('Lamp A50', '50000,25', 2);
    await product('Lamp B60', '90000', 1);
    await product('Cover', null, 1);
    await shown(page.getByText(/100\.000,50/));
    await axe('desktop wishlist WCAG');
    if (screenshots) await page.screenshot({ path: join(screenshots, 'p25-desktop.png') });
  });
  await step('Composite timing with exclusive alternatives, optional unpriced item, and private save', async () => {
    await button(page, 'Cek kesiapan beli wishlist').click();
    const tool = dialog('Cek kesiapan beli');
    await tool.locator('summary').getByText('Cek lebih detail', { exact: true }).click();
    await tool.getByText(/Pilih yang ingin dibeli/).click();
    const line = (name) => tool.locator('.plan-line').filter({ hasText: name });
    await line('Lamp A50').getByLabel('Grup pilihan').selectOption('1');
    await line('Lamp B60').getByLabel('Grup pilihan').selectOption('1');
    assert.equal(await tool.getByRole('checkbox', { name: 'Sertakan Lamp B60' }).isChecked(), false);
    await line('Cover').getByRole('checkbox', { name: 'Produk opsional' }).check();
    assert.equal(await tool.getByRole('checkbox', { name: 'Sertakan Cover' }).isChecked(), false);
    await budget(tool, '100000,50');
    await button(tool, 'Cek kesiapan beli').click();
    await focusIs(tool.getByRole('heading', { name: 'Dana cukup', exact: true }));
    await button(tool, 'Simpan cek kesiapan').click();
    await shown(tool.getByText('Cek kesiapan sudah disimpan.', { exact: true }));
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).sort()), ['nanti.language']);
    await closeTop();
  });
  await step('Saved freshness and confirmed recalculation on mobile', async () => {
    await editLamp();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    const primary = page.locator('.primary').first();
    assert.deepEqual(await primary.evaluate(element => {
      const style = getComputedStyle(element);
      return [style.transitionProperty, style.transitionDuration, style.transform];
    }), ['none', '0s', 'none']);
    await button(page, 'Cek kesiapan beli wishlist').click();
    const tool = dialog('Cek kesiapan beli');
    await tool.locator('summary').getByText('Keputusan sebelumnya', { exact: true }).click();
    await shown(tool.getByText('Perlu dicek ulang', { exact: true }));
    await button(tool, 'Lihat keputusan').click();
    await focusIs(tool.getByRole('heading', { name: 'Keputusan sebelumnya', exact: true }));
    await shown(tool.getByText(/Jumlah berubah dari 2 menjadi 3/));
    await button(tool, 'Cek lagi').click();
    assert.equal(await tool.getByLabel('Dana yang tersedia', { exact: true }).inputValue(), '');
    await button(tool, 'Cek lagi').click();
    await shown(tool.getByRole('alert'));
    await budget(tool, '250000');
    await tool.getByRole('checkbox', { name: 'Data ini sesuai dengan kondisi saya saat ini.' }).check();
    await button(tool, 'Cek lagi').click();
    await focusIs(tool.getByRole('heading', { name: 'Hasil sekarang', exact: true }));
    await shown(tool.getByText('Dana yang tersedia berbeda dari pengecekan sebelumnya.', { exact: true }));
    await axe('mobile timing dialog WCAG');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    if (screenshots) await page.screenshot({ path: join(screenshots, 'p25-timing-mobile.png') });
    await button(tool, 'Simpan cek kesiapan').click();
    await shown(tool.getByText('Cek kesiapan sudah disimpan.', { exact: true }));
    assert.equal(await button(tool, 'Lihat keputusan').count(), 2);
    await closeTop();
  });
  await step('English selection persists and priorities rank products across owned wishlists', async () => {
    const headers = { 'X-Nanti-Request': '1', 'Content-Type': 'application/json' };
    const listResponse = await page.request.post('/api/wishlists', { headers, data: { name: 'Work', currency: 'USD' } });
    assert.equal(listResponse.ok(), true);
    secondList = await listResponse.json();
    assert.equal((await page.request.post(`/api/wishlists/${secondList.id}/items`, { headers,
      data: { name: 'Desk', url: null, priceMinor: 9000, quantity: 1 },
    })).ok(), true);
    await button(page, 'English').click();
    await page.reload();
    await shown(button(page, 'Compare priorities'));
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await button(page, 'Compare priorities').click();
    const tool = dialog('Compare priorities');
    await tool.getByRole('checkbox', { name: 'Lamp A50' }).check();
    await tool.getByLabel('Wishlist', { exact: true }).selectOption(secondList.id);
    await tool.getByRole('checkbox', { name: 'Desk' }).check();
    await button(tool, 'Set priorities').click();
    for (const [name, values] of [['Lamp A50', ['2', '0', '2', '0']], ['Desk', ['1', '2', '0', '1']]]) {
      const group = tool.getByRole('group', { name, exact: true });
      const fields = group.getByRole('combobox');
      for (const [index, value] of values.entries()) await fields.nth(index).selectOption(value);
    }
    await tool.getByLabel('What matters most?').selectOption('urgency');
    await button(tool, 'See priorities').click();
    await shown(tool.getByText('1. Desk', { exact: true }));
    await shown(tool.getByText('Give your budget a closer look before buying.', { exact: true }));
    await button(tool, 'Save decision').click();
    await shown(tool.getByText('Decision saved.', { exact: true }));
    if (screenshots) await page.screenshot({ path: join(screenshots, 'p25-comparison-mobile.png') });
    await closeTop();
  });
  await step('Impulse methodology, saved result, and keyboard focus', async () => {
    await button(page, 'Purchase tools for Lamp A50').click();
    const item = dialog('Lamp A50');
    await focusIs(item.getByRole('heading', { name: 'Lamp A50', exact: true }));
    await page.keyboard.press('Tab');
    await focusIs(button(item, 'Check buying reasons'));
    await page.keyboard.press('Enter');
    let tool = dialog('Check buying reasons');
    const research = button(tool, 'Research & Methodology');
    await research.click();
    const method = dialog('Research & Methodology');
    await focusIs(method.getByRole('heading', { name: 'Research & Methodology' }));
    await shown(method.getByText(/Version 2.0.0/));
    assert.ok(await method.getByRole('link').count() >= 4);
    await closeTop();
    await focusIs(research);
    for (let i = 0; i < 4; i++) await button(tool, 'No').click();
    await tool.getByRole('radio', { name: /^3 days/ }).check();
    await shown(tool.getByText(/^Check again on /));
    await button(tool, 'Save and check later').click();
    await shown(tool.getByText('Decision saved.', { exact: true }));
    await closeTop();
    await focusIs(button(item, 'Check buying reasons'));
    await button(item, 'Check buying reasons').click();
    tool = dialog('Check buying reasons');
    await button(tool, 'View previous decision').click();
    await shown(tool.getByText(/^You planned to check again on /));
    await button(tool, 'Check again').click();
    await focusIs(tool.getByRole('heading', { name: 'Would you still want this at full price?', exact: true }));
    await tool.locator('summary').getByText('Previous decisions', { exact: true }).click();
    await button(tool, 'Delete').click();
    await focusIs(button(tool, 'Cancel'));
    await button(tool, 'Cancel').click();
    await focusIs(button(tool, 'Delete'));
    await closeTop();
    await closeTop();
  });
  await step('Comparison history survives a shrinking wishlist and private data can be cleared', async () => {
    for (const name of ['Cover', 'Lamp A50']) {
      await button(page, 'Remove ' + name).click();
      await button(dialog('Remove product?'), 'Remove product').click();
      await page.getByRole('heading', { name, exact: true }).waitFor({ state: 'hidden' });
    }
    await button(page, 'Compare priorities').click();
    const tool = dialog('Compare priorities');
    await tool.locator('summary').getByText('Previous decisions', { exact: true }).click();
    await button(tool, 'View decision').click();
    await shown(tool.getByText('Needs review', { exact: true }).first());
    await shown(tool.getByText('The items in this check have changed.', { exact: true }));
    await closeTop();
    await button(page, 'Privacy and history').click();
    await button(dialog('Privacy and history'), 'Clear assessment data').click();
    const confirmation = dialog('Clear all assessment data?');
    await focusIs(button(confirmation, 'Cancel'));
    await button(confirmation, 'Clear assessment data').click();
    await shown(page.getByText('Assessment data cleared.', { exact: true }));
    await shown(page.getByRole('heading', { name: 'Lamp B60', exact: true }));
    await button(page, 'Compare priorities').click();
    await tool.locator('summary').getByText('Previous decisions', { exact: true }).click();
    await shown(tool.getByText('No saved results here yet.'));
    await closeTop();
  });
  assert.deepEqual(errors, []);
} finally {
  for (const id of [wishlistId, secondList?.id].filter(Boolean)) await page.request.delete('/api/wishlists/' + id, {
    headers: { 'X-Nanti-Request': '1', 'Content-Type': 'application/json' }, data: {},
  }).catch(() => undefined);
  await browser.close();
}
