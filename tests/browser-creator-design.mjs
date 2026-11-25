import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const axe = require.resolve('axe-core/axe.min.js');
const screenshots = process.env.NANTI_CREATOR_DESIGN_SCREENSHOTS;
if (screenshots) await mkdir(screenshots, { recursive: true });
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
  assert.equal(await page.locator('.studio-preview-frame .storefront-product').count(), 6, 'the preview should show enough products to review grid rhythm');

  const button = name => page.getByRole('button', { name, exact: true });
  const layoutButton = name => page.locator('.studio-layout-option').filter({ hasText: name });
  assert.equal(await layoutButton('Elegan & Berkelas').getAttribute('aria-pressed'), 'true', 'version-1 drafts migrate to the matching layout');
  assert.equal(await page.locator('.studio-preview-frame .storefront-layout-elegant').count(), 1);
  assert.match(await page.locator('.studio-preview-frame .storefront').getAttribute('style'), /--sf-columns:\s*4/u, 'legacy advanced settings remain editable');

  if (screenshots) {
    await page.screenshot({ path: join(screenshots, 'before-elegant-gallery-390.png'), fullPage: true });
    await button('Lihat hasil').click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await button('Desktop').click();
    await page.screenshot({ path: join(screenshots, 'before-elegant-gallery-1440.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
  }

  await button('Switch to English').click();
  await button('See more styles').click();
  const layouts = [
    ['Simple & Clear', 'simple'], ['Bold & Distinctive', 'bold'], ['Elegant & Polished', 'elegant'],
    ['Bright & Dynamic', 'dynamic'], ['Magazine Style', 'magazine'], ['Playful & Relaxed', 'playful'],
  ];
  const colors = [['Rose', 'editorial'], ['Contrast', 'utility'], ['Warm', 'gallery']];
  const widths = [320, 360, 390, 768, 1024, 1440];
  for (const [color, theme] of colors) {
      await button(color).click();
      assert.equal(await page.getByRole('dialog').count(), 0, 'color changes apply without confirmation');
      await page.locator('.studio-preview-frame .storefront-theme-' + theme).waitFor({ state: 'attached' });
      for (const [layout, preset] of layouts) {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await layoutButton(layout).click();
        assert.equal(await page.getByRole('dialog').count(), 0, 'layout changes apply without confirmation');
        const storefront = page.locator('.studio-preview-frame .storefront-layout-' + preset);
        await storefront.waitFor({ state: 'attached' });
        assert.equal(await layoutButton(layout).getAttribute('aria-pressed'), 'true');
        assert.equal(await storefront.locator('.storefront-product').count(), 6);
        assert.match(await storefront.getAttribute('style'), /--sf-accent:\s*#123456/u, 'custom colors survive layout changes');
        for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        if (width <= 1104) {
          if (await button('Preview').isVisible()) await button('Preview').click();
          await button('Desktop').click();
        }
        const measurements = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
          preview: document.querySelector('.studio-preview-frame')?.getBoundingClientRect().width ?? 0,
        }));
        assert.ok(measurements.document <= width, `${layout} / ${color} overflows at ${width}px: ${JSON.stringify(measurements)}`);
        assert.ok(measurements.preview > 0 && measurements.preview <= width, `${layout} / ${color} preview overflows at ${width}px`);
        if (screenshots && [390, 1440].includes(width)) {
          await page.screenshot({ path: join(screenshots, `after-${preset}-${theme}-${width}.png`), fullPage: true });
        }
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
  })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target, failureSummary, html }) => ({ target, failureSummary, html })) })));
  assert.deepEqual(violations, []);

  await layoutButton('Simpel & Rapi').click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await button('Terapkan & simpan draf').click();
  await page.getByText(/Draf tampilan disimpan di akunmu/u).waitFor();
  assert.equal(savedDesign.version, 2);
  assert.equal(savedDesign.layoutPreset, 'simple');
  assert.equal(savedDesign.colorPreset, 'gallery');
  assert.deepEqual(pageErrors, []);
  console.log('Creator design Studio passed legacy migration, 18 preset/color pairs at 320, 360, 390, 768, 1024 and 1440px, reset/undo, save and axe checks.');
} finally {
  await browser?.close();
  await vite.close();
}
