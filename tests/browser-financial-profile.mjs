import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../dist/web/', import.meta.url));
const mime = { '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname.startsWith('/assets/')) {
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root)) { res.writeHead(404).end(); return; }
    try { res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); res.end(await readFile(file)); }
    catch { res.writeHead(404).end(); }
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(await readFile(join(root, 'index.html')));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseURL = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: process.env.NANTI_BROWSER_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-background-networking'], headless: true });
const page = await browser.newPage({ baseURL, viewport: { width: 1280, height: 900 }, locale: 'id-ID' });
page.setDefaultTimeout(7000);
const axePath = require.resolve('axe-core/axe.min.js');
const errors = [];
let profile = { income: null, expenses: null, debts: null, savings: null, readiness: null, additional: null,
  sectionUpdatedAt: {}, createdAt: null, updatedAt: null };
let failExpenseSave = true;
let failProfileLoad = true;
let financialLoads = 0;
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('nanti.language', 'id'));
await page.addInitScript({ path: axePath });
await page.route('**/api/account', route => route.fulfill({ status: 200, json: {
  available: [], account: { displayName: 'Arya'.repeat(25), email: 'long-account-name'.repeat(8) + '@example.test',
    providers: ['google'], recentlyVerified: true, import: null },
} }));
await page.route(/\/api\/account\/financial-profile(?:\/.*)?$/u, async route => {
  const request = route.request();
  if (request.method() === 'GET') {
    financialLoads++;
    if (failProfileLoad) {
      failProfileLoad = false;
      return route.fulfill({ status: 503, json: { error: 'Could not load profile.' } });
    }
    return route.fulfill({ status: 200, json: profile });
  }
  if (request.method() === 'DELETE') {
    profile = { income: null, expenses: null, debts: null, savings: null, readiness: null, additional: null,
      sectionUpdatedAt: {}, createdAt: null, updatedAt: null };
    return route.fulfill({ status: 204, body: '' });
  }
  const section = new URL(request.url()).pathname.split('/').at(-1);
  const data = request.postDataJSON();
  if (section === 'expenses' && failExpenseSave) {
    failExpenseSave = false;
    return route.fulfill({ status: 400, json: { error: 'Check the financial details you entered.' } });
  }
  const timestamp = '2026-11-26T12:00:00.000Z';
  profile = { ...profile, [section]: data, sectionUpdatedAt: { ...profile.sectionUpdatedAt, [section]: timestamp },
    createdAt: profile.createdAt ?? timestamp, updatedAt: timestamp };
  return route.fulfill({ status: 200, json: profile });
});

const button = name => page.getByRole('button', { name, exact: true });
const close = () => browser.close().finally(() => new Promise(resolve => server.close(resolve)));
try {
  await page.goto('/account');
  const workspace = page.getByRole('main');
  const info = workspace.getByRole('link', { name: 'Informasi akun', exact: true });
  const financial = workspace.getByRole('link', { name: 'Profil finansial', exact: true });
  const security = workspace.getByRole('link', { name: 'Keamanan', exact: true });
  await workspace.getByRole('heading', { name: 'Informasi akun', exact: true }).waitFor();
  assert.equal(await info.getAttribute('aria-current'), 'page');
  await security.click();
  await workspace.getByRole('heading', { name: 'Keamanan', exact: true }).waitFor();
  assert.equal(await security.getAttribute('aria-current'), 'page');
  assert.equal(financialLoads, 0);
  await financial.click();
  await workspace.getByRole('heading', { name: 'Profil finansial', exact: true }).waitFor();
  await page.waitForURL('**/account?section=financial-profile');
  await workspace.getByRole('alert').filter({ hasText: 'Profil finansial belum bisa dimuat' }).waitFor();
  await button('Coba lagi').click();
  await page.getByText('Belum bisa dihitung', { exact: true }).waitFor();
  await page.goBack();
  await workspace.getByRole('heading', { name: 'Keamanan', exact: true }).waitFor();
  await page.goForward();
  await workspace.getByRole('heading', { name: 'Profil finansial', exact: true }).waitFor();
  assert.equal(financialLoads, 2);
  await page.goto('/account/financial-profile');
  await page.waitForURL('**/account?section=financial-profile');
  await workspace.getByRole('heading', { name: 'Profil finansial', exact: true }).waitFor();
  assert.equal(await financial.getAttribute('aria-current'), 'page');
  await page.getByText('Belum bisa dihitung', { exact: true }).waitFor();
  assert.equal(await page.getByText('Belum bisa dihitung', { exact: true }).isVisible(), true);
  assert.equal(await page.locator('.fp-accordion-trigger[aria-expanded="true"]').count(), 0);
  assert.equal(await page.locator('.fp-additional > h3 button').getAttribute('aria-expanded'), 'false');
  console.log('PASS direct route and empty profile remain unfilled');

  await page.getByRole('button', { name: /Penghasilan/ }).click();
  const incomeRows = page.locator('.fp-edit-row');
  await incomeRows.nth(0).locator('input[inputmode="numeric"]').fill('6.000.000');
  await incomeRows.nth(1).getByRole('button', { name: 'Hapus Penghasilan tambahan' }).click();
  await page.getByRole('combobox', { name: 'Penghasilanmu biasanya…' }).selectOption('steady');
  await page.getByRole('checkbox', { name: 'Jumlah ini sudah mencakup seluruh penghasilan bulananmu.' }).check();
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Perubahan tersimpan.' }).waitFor();
  assert.equal(profile.income.items[0].monthlyNet, '6000000');
  const incomeTotal = page.locator('.fp-accordion-item').filter({ hasText: 'Penghasilan' }).locator('.fp-parent-value');
  const incomeTotalText = (await incomeTotal.innerText()).replace(/\s/gu, '');
  console.log(`Income parent total: ${incomeTotalText}`);
  assert.equal(incomeTotalText, 'Rp6.000.000');
  console.log('PASS income fields, stability, and Rupiah total');

  await page.getByRole('button', { name: /Kebutuhan/ }).click();
  const expenseRows = page.locator('.fp-expense-row');
  await expenseRows.first().locator('input[inputmode="numeric"]').fill('1.200.000');
  const expenseCount = await expenseRows.count();
  await button('Tambah kebutuhan').click();
  assert.equal(await expenseRows.count(), expenseCount + 1);
  await expenseRows.last().locator('input:not([inputmode])').fill('Buku sekolah');
  await expenseRows.last().locator('input[inputmode="numeric"]').fill('250000');
  await expenseRows.last().getByRole('button', { name: 'Hapus Buku sekolah', exact: true }).click();
  assert.equal(await expenseRows.count(), expenseCount);
  await page.getByRole('checkbox', { name: /Aku sudah mencatat semua kebutuhan rutinku/ }).check();
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Perubahan belum tersimpan.' }).waitFor();
  assert.equal(await expenseRows.first().locator('input[inputmode="numeric"]').inputValue(), '1.200.000');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Perubahan tersimpan.' }).waitFor();
  assert.equal(profile.expenses.confirmed, true);
  console.log('PASS failed save preserves the entered expense and retry succeeds');

  await page.getByRole('button', { name: /Cicilan/ }).click();
  await page.getByRole('button', { name: 'Tidak ada cicilan', exact: true }).click();
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await page.getByRole('button', { name: /Rp\s*0/ }).waitFor();
  assert.equal(profile.debts.status, 'none');

  await page.getByRole('button', { name: /Target tabungan/ }).click();
  await page.getByRole('textbox', { name: /Uang yang ingin ditabung setiap bulan/ }).fill('1.000.000');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Perubahan tersimpan.' }).waitFor();
  assert.equal(profile.savings.monthlyAmount, '1000000');
  console.log(`Budget inputs: ${JSON.stringify({ income: profile.income, expenses: profile.expenses, debts: profile.debts, savings: profile.savings })}`);
  assert.equal((await page.locator('.fp-summary > strong').innerText()).replace(/\s/gu, ''), 'Rp3.800.000');
  console.log('PASS budget calculation and explicit zero installments');

  await page.reload();
  await page.locator('.fp-summary > strong').filter({ hasText: /3\.800\.000/ }).waitFor();
  await button('Menu profil').click();
  const menu = page.locator('#masthead-profile');
  const actions = menu.locator('a, button');
  assert.deepEqual(await actions.allTextContents(), ['Profil saya', 'Creator Studio', 'Keluar']);
  assert.equal(await actions.locator('svg').count(), 3);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Profil saya');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Creator Studio');
  await page.keyboard.press('Escape');
  assert.equal(await button('Menu profil').evaluate(trigger => trigger === document.activeElement), true);
  console.log('PASS profile menu keyboard navigation and focus return');

  const axeFailures = await page.evaluate(async () => (await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
  })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
  assert.deepEqual(axeFailures, []);
  for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: width < 769 ? 850 : 900 });
    const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth, page: document.querySelector('.fp-page')?.scrollWidth }));
    assert.equal(layout.document, layout.viewport, `${width}px document overflow`);
    assert.ok((layout.page ?? 0) <= layout.viewport, `${width}px profile overflow`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS WCAG scan, eight responsive widths, and no browser errors');
} finally {
  await close();
}
