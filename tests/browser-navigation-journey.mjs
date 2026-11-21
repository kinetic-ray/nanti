import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const baseURL = process.env.NANTI_BROWSER_BASE_URL ?? 'http://127.0.0.1:3000';
const browser = await chromium.launch({
  executablePath: process.env.NANTI_BROWSER_PATH ??
    (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
});

try {
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ baseURL, viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await page.addInitScript({ path: require.resolve('axe-core/axe.min.js') });
    await page.route('**/api/session', route => route.fulfill({ json: [] }));
    await page.route('**/api/account', route => route.fulfill({ json: { account: null } }));
    await page.route('**/api/prices/alerts', route => route.fulfill({ json: { alerts: [], unread: 0 } }));
    await page.goto('/');
    const controls = page.locator('.masthead-controls');
    await controls.waitFor();
    assert.deepEqual(await controls.locator(':scope > *').evaluateAll(nodes => nodes.map(node =>
      [...node.classList].find(name => ['price-alert-entry', 'language-switch', 'masthead-action', 'masthead-menu'].includes(name)))),
    ['price-alert-entry', 'language-switch', 'masthead-action', 'masthead-menu']);
    const toggle = controls.locator('.masthead-menu-toggle');
    const panel = controls.locator('.masthead-menu-panel');
    const controlRadius = await toggle.evaluate(node => getComputedStyle(node).borderRadius);
    for (const control of [controls.locator('.price-alert-entry'), controls.locator('.language-switch'), controls.locator('.masthead-action'), toggle]) {
      const { width: w, height: h } = await control.boundingBox();
      assert.deepEqual([w, h], [44, 44]);
      assert.equal(await control.evaluate(node => getComputedStyle(node).borderRadius), controlRadius);
    }
    await toggle.press('Enter');
    await panel.waitFor();
    const bounds = await panel.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.keyboard.press('Tab');
    assert.ok(await panel.evaluate(node => node.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    assert.ok(await toggle.evaluate(node => node === document.activeElement));
    await toggle.click();
    await controls.getByRole('button', { name: 'Switch to English' }).click();
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await controls.getByRole('button', { name: 'Price alerts' }).click();
    const alerts = page.getByRole('dialog', { name: 'Price alerts' });
    await alerts.waitFor();
    await page.keyboard.press('Escape');
    await alerts.waitFor({ state: 'hidden' });

    await page.goto('/creator');
    const indonesian = width === 375;
    if (indonesian) await page.getByRole('button', { name: 'Ganti ke Bahasa Indonesia' }).click();
    const journey = page.locator('.creator-post-journey');
    await journey.waitFor();
    const post = journey.locator('.creator-instagram-post');
    await post.waitFor();
    await post.getByText(/sneakers/i).waitFor();
    assert.equal(await post.getByRole('link').count(), 0);
    const like = post.getByRole('button', { name: indonesian ? 'Suka' : 'Like', exact: true });
    const save = post.getByRole('button', { name: indonesian ? 'Simpan postingan' : 'Save post', exact: true });
    await like.press('Space');
    assert.equal(await like.getAttribute('aria-pressed'), 'true');
    await save.press('Enter');
    assert.equal(await save.getAttribute('aria-pressed'), 'true');
    const photo = post.getByRole('img');
    await photo.scrollIntoViewIfNeeded();
    assert.ok(await photo.evaluate(async image => { await image.decode(); return image.naturalWidth > 0; }));
    const photoURL = await photo.getAttribute('src');
    await post.getByRole('button', { name: 'studio.sore' }).press('Enter');
    const profile = journey.getByRole('heading', { name: 'studio.sore', exact: true });
    await profile.waitFor();
    assert.ok(await profile.evaluate(node => node === document.activeElement));
    await journey.getByText(indonesian ? 'Pengikut' : 'Followers', { exact: true }).waitFor();
    await journey.getByRole('link', { name: indonesian ? 'Buka link di bio' : 'Open bio link' }).press('Enter');

    const input = journey.getByRole('searchbox', { name: indonesian ? 'Cari produk' : 'Search products', exact: true });
    await input.waitFor();
    assert.equal(await input.inputValue(), 'sneakers');
    assert.ok(await input.evaluate(node => node === document.activeElement));
    assert.equal(await journey.locator('.storefront-profile').count(), 0);
    assert.equal(await journey.locator('.storefront-kicker, .storefront-product-code').count(), 0);
    const product = journey.locator('.storefront-product');
    await product.getByRole('heading', { name: 'Classic canvas sneakers' }).waitFor();
    assert.equal(await product.locator('img').getAttribute('src'), photoURL);
    await product.getByText('Rp 399.000', { exact: true }).waitFor();
    const desk = journey.getByRole('button', { name: 'Desk setup', exact: true });
    await desk.click();
    assert.equal(await desk.getAttribute('aria-pressed'), 'true');
    await product.getByRole('heading', { name: 'Minimal desk lamp' }).waitFor();
    await input.fill('wrong');
    await journey.locator('.storefront-empty').waitFor();
    await input.fill(' prd-003 ');
    await product.getByRole('heading', { name: 'Classic canvas sneakers' }).waitFor();
    const storefront = indonesian ? 'Cari di etalase' : 'Search the storefront';
    assert.equal(await journey.locator('[aria-current="step"]').getAttribute('aria-label'), `3. ${storefront}`);
    assert.equal(await journey.locator('.creator-stepper button').count(), 3);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await journey.getByRole('button', { name: indonesian ? '1. Lihat postingan' : '1. See the post' }).press('Enter');
    await journey.getByRole('button', { name: `3. ${storefront}` }).press('Space');
    assert.equal(await input.inputValue(), 'sneakers');
    const violations = await page.evaluate(async () => (await window.axe.run('.creator-post-journey', {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
    assert.deepEqual(violations, []);
    await journey.getByRole('link', { name: indonesian ? 'Buka etalase demo' : 'Open demo storefront' }).click();
    await page.waitForURL('**/creator/demo');
    await page.locator('#creator-storefront-search').fill('PRD-003');
    await page.getByRole('heading', { name: 'Classic canvas sneakers' }).waitFor();
    console.log(`PASS navigation and walkthrough at ${width}px`);
    await page.close();
  }
} finally {
  await browser.close();
}
