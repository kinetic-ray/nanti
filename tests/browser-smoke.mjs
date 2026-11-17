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
    const tool = dialog('Cek kesiapan keuangan');
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
    assert.equal(await page.locator('.primary').first().evaluate((element) => getComputedStyle(element).transitionDuration.split(', ')[0]), '1e-05s');
    await button(page, 'Cek kesiapan beli wishlist').click();
    const tool = dialog('Cek kesiapan keuangan');
    await tool.getByText('Cek kesiapan tersimpan', { exact: true }).click();
    await shown(tool.getByText('Perlu dicek ulang', { exact: true }));
    await button(tool, 'Lihat hasil').click();
    await focusIs(tool.getByRole('heading', { name: 'Hasil sebelumnya', exact: true }));
    await shown(tool.getByText(/Jumlah berubah dari 2 menjadi 3/));
    await button(tool, 'Cek ulang hasilnya').click();
    assert.equal(await tool.getByLabel('Dana yang tersedia', { exact: true }).inputValue(), '');
    await button(tool, 'Cek ulang hasilnya').click();
    await shown(tool.getByRole('alert'));
    await budget(tool, '250000');
    await tool.getByRole('checkbox', { name: 'Data ini sesuai dengan kondisi saya saat ini.' }).check();
    await button(tool, 'Cek ulang hasilnya').click();
    await focusIs(tool.getByRole('heading', { name: 'Hasil sekarang', exact: true }));
    await shown(tool.getByText('Dana yang tersedia berbeda dari pengecekan sebelumnya.', { exact: true }));
    await axe('mobile timing dialog WCAG');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    if (screenshots) await page.screenshot({ path: join(screenshots, 'p25-timing-mobile.png') });
    await button(tool, 'Simpan cek kesiapan').click();
    await shown(tool.getByText('Cek kesiapan sudah disimpan.', { exact: true }));
    assert.equal(await button(tool, 'Lihat hasil').count(), 2);
    await closeTop();
  });
  await step('English selection persists and comparison rank updates', async () => {
    await button(page, 'English').click();
    await page.reload();
    await shown(button(page, 'Compare products'));
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await button(page, 'Compare products').click();
    const tool = dialog('Value Ranker');
    await tool.getByRole('checkbox', { name: 'Lamp A50' }).check();
    await tool.getByRole('checkbox', { name: 'Lamp B60' }).check();
    await button(tool, 'Choose criteria').click();
    await tool.getByLabel('Add a criterion').selectOption('Durability');
    await button(tool, 'Add criterion').click();
    await button(tool, 'Enter ratings').click();
    const ratings = tool.getByRole('spinbutton', { name: /Durability/ });
    await ratings.nth(0).fill('2');
    await ratings.nth(1).fill('8');
    await button(tool, 'See comparison').click();
    await shown(tool.getByText(/Tied for first/));
    await tool.getByLabel('Weight for Durability').fill('4');
    await shown(tool.getByText('Lamp B60 ranks first at these weights.', { exact: true }));
    await button(tool, 'Save comparison').click();
    await shown(tool.getByText('Comparison saved.', { exact: true }));
    if (screenshots) await page.screenshot({ path: join(screenshots, 'p25-comparison-mobile.png') });
    await closeTop();
  });
  await step('Impulse methodology, saved result, and keyboard focus', async () => {
    await button(page, 'Purchase tools for Lamp A50').click();
    const item = dialog('Lamp A50');
    await focusIs(item.getByRole('heading', { name: 'Lamp A50', exact: true }));
    await page.keyboard.press('Tab');
    await focusIs(button(item, 'Check buying impulse'));
    await page.keyboard.press('Enter');
    let tool = dialog('Impulse Guard');
    const research = button(tool, 'Research & Methodology');
    await research.click();
    const method = dialog('Research & Methodology');
    await focusIs(method.getByRole('heading', { name: 'Research & Methodology' }));
    await shown(method.getByText(/Version 1.1.0/));
    assert.ok(await method.getByRole('link').count() >= 4);
    await closeTop();
    await focusIs(research);
    for (let i = 0; i < 7; i++) {
      await tool.getByRole('radio', { name: 'No', exact: true }).check();
      await button(tool, i === 6 ? 'See result' : 'Next question').click();
    }
    await button(tool, 'Save assessment').click();
    await shown(tool.getByText('Assessment saved.', { exact: true }));
    await closeTop();
    await focusIs(button(item, 'Check buying impulse'));
    await button(item, 'Check buying impulse').click();
    tool = dialog('Impulse Guard');
    await tool.getByText('Saved assessments', { exact: true }).click();
    await button(tool, 'View result').click();
    await button(tool, 'Back to my check').click();
    await focusIs(tool.getByRole('heading', { name: 'Does this solve a specific need you can name?', exact: true }));
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
    await button(page, 'Saved comparisons').click();
    const tool = dialog('Value Ranker');
    await button(tool, 'View result').click();
    await shown(tool.getByText('Needs review', { exact: true }).first());
    await shown(tool.getByText(/Some products have been removed/));
    await closeTop();
    await button(page, 'Privacy and history').click();
    await button(dialog('Privacy and history'), 'Clear assessment data').click();
    const confirmation = dialog('Clear all assessment data?');
    await focusIs(button(confirmation, 'Cancel'));
    await button(confirmation, 'Clear assessment data').click();
    await shown(page.getByText('Assessment data cleared.', { exact: true }));
    await shown(page.getByRole('heading', { name: 'Lamp B60', exact: true }));
    await button(page, 'Saved comparisons').click();
    await shown(dialog('Value Ranker').getByText('No saved results here yet.'));
    await closeTop();
  });
  assert.deepEqual(errors, []);
} finally {
  if (wishlistId) await page.request.delete('/api/wishlists/' + wishlistId, {
    headers: { 'X-Nanti-Request': '1', 'Content-Type': 'application/json' }, data: {},
  }).catch(() => undefined);
  await browser.close();
}
