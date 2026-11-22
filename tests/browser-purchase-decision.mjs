import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const fixturePath = '/purchase-decision-fixture.mjs';
const source = `
      import { createElement, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { GuidedPurchaseDecision } from './src/guided-purchase-decision.tsx';
      import './src/consumer.css';
      function Fixture() {
        const [open, setOpen] = useState(false);
        return open ? createElement(GuidedPurchaseDecision, {
          list: { currency: 'IDR' },
          item: { name: 'Tas uji', priceMinor: null, quantity: 1 },
          close: () => setOpen(false),
        }) : createElement('button', { onClick: () => setOpen(true) }, 'Bantu putuskan beli');
      }
      createRoot(document.getElementById('root')).render(createElement(Fixture));
    `;
const server = await createServer({
  plugins: [{
    name: 'nanti-purchase-decision-test',
    resolveId(id) {
      if (id === fixturePath) return process.cwd() + fixturePath;
    },
    load(id) {
      if (id === process.cwd() + fixturePath) return source;
    },
  }],
  server: { host: '127.0.0.1', port: 0, hmr: false },
  clearScreen: false,
});
let browser;
try {
  await server.listen();
  const { port } = server.httpServer.address();
  const baseURL = 'http://127.0.0.1:' + port;
  browser = await chromium.launch({
    executablePath: process.env.NANTI_BROWSER_PATH ??
      (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
    args: ['--disable-background-networking'], headless: true,
  });
  const page = await browser.newPage({ baseURL, viewport: { width: 390, height: 800 }, locale: 'id-ID' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(8000);
  await page.route('**/purchase-decision-fixture', async route => route.fulfill({
    contentType: 'text/html',
    body: await server.transformIndexHtml('/purchase-decision-fixture', `<!doctype html>
      <html lang="id"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body class="consumer"><div id="root"></div><script type="module" src="/purchase-decision-fixture.mjs"></script></body></html>`),
  }));
  const dialog = page.getByRole('dialog', { name: 'Bantu putuskan beli', exact: true });
  const button = (scope, name) => scope.getByRole('button', { name, exact: true });
  async function assess(answers, budget, result, reason, gap) {
    await button(page, 'Bantu putuskan beli').click();
    for (const answer of answers) await button(dialog, answer ? 'Ya' : 'Tidak').click();
    for (const [name, value] of Object.entries(budget)) await dialog.getByLabel(name).fill(value);
    await button(dialog, 'Lihat hasil').click();
    await dialog.getByRole('heading', { name: result, exact: true }).waitFor();
    await dialog.getByText(reason, { exact: true }).waitFor();
    await dialog.getByText(gap).waitFor();
    await button(dialog, 'Selesai').click();
  }

  await page.goto('/purchase-decision-fixture');
  await assess([false, true, false, true, false, true], {
    'Perkiraan harga barang': '250000', 'Uang yang kamu punya': '1.500.000,00',
    'Pengeluaran yang harus dibayar': '200000', 'Uang yang ingin kamu sisihkan': '300000',
  }, 'Tunda dulu pembeliannya', 'Ada tanda impulsif / FOMO', /Harga barang tercakup/);
  await assess([true, false, true, false, true, false], {
    'Perkiraan harga barang': '500.000', 'Uang yang kamu punya': '600000',
    'Pengeluaran yang harus dibayar': '200000', 'Uang yang ingin kamu sisihkan': '100000',
  }, 'Butuh dana tambahan, tunda dulu', 'Kebutuhan cukup jelas', /Uang aman untuk belanja kurang .*200\.000/);
  assert.deepEqual(errors, []);
  console.log('PASS guided purchase: FOMO with funds and genuine need with a funding gap');
} finally {
  await browser?.close();
  await server.close();
}
