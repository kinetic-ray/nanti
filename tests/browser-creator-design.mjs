import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const axe = require.resolve('axe-core/axe.min.js');
const vite = await createServer({
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime'] },
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
await vite.listen();
const address = vite.httpServer.address();
if (!address || typeof address === 'string') throw new Error('Vite did not open a local test server.');
const baseURL = `http://127.0.0.1:${address.port}`;
let browser;

try {
  browser = await chromium.launch({ executablePath: process.env.NANTI_BROWSER_PATH ?? '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  let savedDesign;
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/account/creator/design', async route => {
    savedDesign = route.request().postDataJSON().design;
    await route.fulfill({ status: 204 });
  });
  await page.goto(baseURL + '/tests/fixtures/creator-design-studio.html');
  await page.addScriptTag({ path: axe });

  const button = name => page.getByRole('button', { name, exact: true });
  const layoutButton = name => page.locator('.studio-layout-option').filter({ hasText: name });
  assert.equal(await layoutButton('Elegan & Berkelas').getAttribute('aria-pressed'), 'true', 'version-1 drafts migrate to the matching layout');
  assert.equal(await page.locator('.studio-preview-frame .storefront-layout-elegant').count(), 1);
  assert.match(await page.locator('.studio-preview-frame .storefront').getAttribute('style'), /--sf-columns:\s*4/u, 'legacy advanced settings remain editable');

  await button('Switch to English').click();
  await button('See more styles').click();
  for (const [layout, preset] of [
    ['Simple & Clear', 'simple'], ['Bold & Distinctive', 'bold'], ['Elegant & Polished', 'elegant'],
    ['Bright & Dynamic', 'dynamic'], ['Magazine Style', 'magazine'], ['Playful & Relaxed', 'playful'],
  ]) {
    await layoutButton(layout).click();
    const decision = page.getByRole('dialog');
    if (await decision.isVisible().catch(() => false)) await button('Use style settings').click();
    await page.locator('.studio-preview-frame .storefront-layout-' + preset).waitFor();

    for (const [color, theme] of [['Rose', 'editorial'], ['Contrast', 'utility'], ['Warm', 'gallery']]) {
      await button(color).click();
      if (await decision.isVisible().catch(() => false)) await button('Use style settings').click();
      await page.locator('.studio-preview-frame .storefront-theme-' + theme).waitFor();
      for (const width of [360, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        if (width === 360) await button('Preview').click();
        const measurements = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
          preview: document.querySelector('.studio-preview-frame')?.getBoundingClientRect().width ?? 0,
        }));
        assert.ok(measurements.document <= width, `${layout} / ${color} overflows at ${width}px: ${JSON.stringify(measurements)}`);
        assert.ok(measurements.preview <= width, `${layout} / ${color} preview overflows at ${width}px`);
        if (width === 360) await button('Edit design').click();
      }
    }
  }

  await page.getByRole('button', { name: 'Customize details' }).click();
  await button('Reset design').click();
  await page.getByRole('dialog', { name: 'Reset design?' }).waitFor();
  await button('Cancel').click();
  await button('Reset design').click();
  await button('Reset design').last().click();
  await page.locator('.studio-preview-frame .storefront-layout-magazine').waitFor();
  await button('Undo').click();
  await page.locator('.studio-preview-frame .storefront-layout-elegant').waitFor();

  await button('Ganti ke Bahasa Indonesia').click();
  await button('← Pengaturan mudah').click();
  const violations = await page.evaluate(async () => (await window.axe.run('.studio', {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
  })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })));
  assert.deepEqual(violations, []);

  await layoutButton('Simpel & Rapi').click();
  const resetPreset = page.getByRole('dialog');
  if (await resetPreset.isVisible().catch(() => false)) await button('Pertahankan penyesuaian').click();
  await button('Terapkan & simpan draf').click();
  await page.getByText(/Draf tampilan disimpan di akunmu/u).waitFor();
  assert.equal(savedDesign.version, 2);
  assert.equal(savedDesign.layoutPreset, 'simple');
  assert.equal(savedDesign.colorPreset, 'gallery');
  assert.deepEqual(pageErrors, []);
  console.log('Creator design Studio passed legacy migration, 18 preset/color pairs at 360px and 1440px, reset/undo, save and axe checks.');
} finally {
  await browser?.close();
  await vite.close();
}
