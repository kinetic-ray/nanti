import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const baseURL = process.env.NANTI_BROWSER_BASE_URL ?? 'http://127.0.0.1:3000';
const screenshotDir = process.env.NANTI_WALKTHROUGH_SCREENSHOTS;
const browser = await chromium.launch({
  executablePath: process.env.NANTI_BROWSER_PATH ??
    (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
});

try {
  for (const [width, frameWidth, frameHeight] of [
    [320, 288, 576], [375, 343, 630], [768, 400, 672],
    [900, 400, 672], [1024, 400, 672], [1440, 400, 672],
  ]) {
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
    const indonesian = width <= 375;
    if (indonesian) await page.getByRole('button', { name: 'Ganti ke Bahasa Indonesia' }).click();
    const journey = page.locator('.creator-post-journey');
    await journey.waitFor();
    const guidance = journey.locator('.creator-journey-guidance');
    const hints = indonesian
      ? ['Ketuk nama atau foto profil kreator.', 'Ketuk tautan Nanti di bio kreator.', 'Ketik "sneakers" di kolom pencarian.']
      : ['Tap the creator’s name or profile picture.', 'Tap the Nanti link in the creator’s bio.', 'Type "sneakers" in the search field.'];
    const assertGuidance = async step => {
      const visible = guidance.locator('div:not([aria-hidden])');
      await visible.getByRole('heading', { level: 3 }).waitFor();
      assert.equal(await guidance.getByRole('heading', { level: 3 }).count(), 1);
      assert.equal(await visible.locator('.creator-journey-hint').textContent(), hints[step - 1]);
      assert.deepEqual(await guidance.getByRole('status').allTextContents(), [hints[step - 1]]);
    };
    await assertGuidance(1);
    const post = journey.locator('.creator-instagram-post');
    await post.waitFor();
    await post.locator('.creator-post-caption p').first().getByText(/sneakers/i).waitFor();
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
    await page.evaluate(() => document.fonts.ready);
    const stage = journey.locator('.creator-journey-stage');
    const capture = async step => {
      if (!screenshotDir || ![375, 1440].includes(width)) return;
      await mkdir(screenshotDir, { recursive: true });
      await stage.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
      await stage.screenshot({ path: join(screenshotDir, `walkthrough-${width}-step-${step}.png`) });
    };
    const stageBounds = () => stage.evaluate(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y: y + window.scrollY, width, height };
    });
    const reference = await stageBounds();
    assert.deepEqual([reference.width, reference.height], [frameWidth, frameHeight]);
    const frame = await stage.boundingBox();
    const instructions = await guidance.boundingBox();
    const stepper = await journey.locator('.creator-stepper').boundingBox();
    assert.ok(stepper.y + stepper.height <= Math.min(frame.y, instructions.y));
    if (width >= 900) {
      assert.ok(Math.abs(instructions.y + instructions.height / 2 - (frame.y + frame.height / 2)) < 1);
      assert.ok(instructions.x + instructions.width < frame.x);
    } else {
      assert.ok(instructions.y + instructions.height < frame.y);
      assert.ok(Math.abs(frame.x + frame.width / 2 - width / 2) < 1);
    }
    const postBounds = await post.boundingBox();
    assert.deepEqual([reference.width, reference.height], [postBounds.width, postBounds.height]);
    await post.getByRole('button', { name: indonesian ? 'Komentar' : 'Comment', exact: true }).press('Enter');
    assert.ok(await post.locator('.creator-post-comment-count').evaluate(node => node === document.activeElement));
    const account = post.locator('.creator-post-account');
    await account.locator('.creator-post-avatar').click();
    const profile = journey.getByRole('heading', { name: 'studio.sore', exact: true });
    await profile.waitFor();
    await assertGuidance(2);
    assert.deepEqual(await stageBounds(), reference);
    const profileScreen = journey.locator('.creator-instagram-profile');
    const profileBounds = await profileScreen.boundingBox();
    assert.deepEqual([profileBounds.width, profileBounds.height], [reference.width, reference.height]);
    assert.ok(await profile.evaluate(node => node === document.activeElement));
    await journey.getByText(indonesian ? 'Pengikut' : 'Followers', { exact: true }).waitFor();
    const back = profileScreen.getByRole('button', { name: indonesian ? 'Kembali ke postingan' : 'Back to post' });
    await back.press('Enter');
    await post.locator('.creator-post-account:focus').waitFor();
    await assertGuidance(1);
    await post.locator('.creator-caption-account').press('Enter');

    const profileScroll = profileScreen.locator('.creator-profile-scroll');
    assert.ok(await profileScroll.evaluate(node => node.scrollWidth === node.clientWidth));
    const grid = profileScreen.getByRole('list', { name: indonesian ? 'Postingan' : 'Posts' });
    assert.equal(await grid.getByRole('img').count(), 6);
    assert.equal(await grid.getByRole('img').first().getAttribute('src'), photoURL);
    assert.equal(await grid.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 3);
    const profileViolations = await page.evaluate(async () => (await window.axe.run('.creator-instagram-profile', {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations.map(({ id }) => id));
    assert.deepEqual(profileViolations, []);
    const bioLink = journey.getByRole('link', { name: indonesian ? 'Buka link di bio' : 'Open bio link' });
    assert.equal(await bioLink.getAttribute('href'), '/creator/demo');
    await page.keyboard.press('Tab');
    assert.ok(await profileScroll.evaluate(node => node === document.activeElement));
    await page.keyboard.press('Tab');
    assert.ok(await bioLink.evaluate(node => node === document.activeElement));
    await page.keyboard.press('Enter');

    const input = journey.getByRole('searchbox', { name: indonesian ? 'Cari produk' : 'Search products', exact: true });
    await input.waitFor();
    await assertGuidance(3);
    assert.deepEqual(await stageBounds(), reference);
    const storefrontBounds = await journey.locator('.creator-journey-panel').boundingBox();
    assert.deepEqual([storefrontBounds.width, storefrontBounds.height], [reference.width, reference.height]);
    assert.equal(await input.inputValue(), 'sneakers');
    assert.ok(await input.evaluate(node => node === document.activeElement));
    assert.equal(await journey.locator('.storefront-profile').count(), 0);
    assert.equal(await journey.locator('.storefront-kicker, .storefront-product-code').count(), 0);
    const product = journey.locator('.storefront-product');
    await product.getByRole('heading', { name: 'Classic canvas sneakers' }).waitFor();
    assert.ok(await journey.locator('.storefront-section-heading h3').evaluate(node => parseFloat(getComputedStyle(node).fontSize) <= 18));
    const panelBounds = await journey.locator('.creator-journey-panel').evaluate(node => ({
      client: node.clientWidth,
      content: node.scrollWidth,
    }));
    assert.equal(panelBounds.client, panelBounds.content);
    assert.equal(await product.locator('img').getAttribute('src'), photoURL);
    await product.getByText('Rp 399.000', { exact: true }).waitFor();
    const clear = journey.getByRole('button', { name: indonesian ? 'Hapus pencarian' : 'Clear search' });
    assert.equal(await clear.count(), 1);
    assert.ok(await input.evaluate(node => [...document.styleSheets].some(sheet => [...sheet.cssRules].some(rule =>
      rule.selectorText?.endsWith('::-webkit-search-cancel-button') &&
      node.matches(rule.selectorText.replace('::-webkit-search-cancel-button', '')) &&
      rule.style.display === 'none'))));
    const details = product.getByRole('button', { name: indonesian ? 'Lihat produk' : 'View product' });
    await details.press('Enter');
    const dialog = journey.getByRole('dialog', { name: 'Classic canvas sneakers' });
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.ok(await details.evaluate(node => node === document.activeElement));
    await clear.press('Enter');
    await journey.locator('#creator-walkthrough-search:focus').waitFor();
    assert.equal(await input.inputValue(), '');
    assert.equal(await clear.count(), 0);
    assert.equal(await product.count(), 6);
    const filters = journey.locator('.storefront-filters');
    assert.equal(await filters.evaluate(node => getComputedStyle(node).flexWrap), 'nowrap');
    const shopScroll = journey.locator('.creator-journey-shop .creator-profile-scroll');
    await shopScroll.evaluate(node => { node.scrollTop = node.scrollHeight; });
    assert.ok(await shopScroll.evaluate(node => node.scrollTop > 0 && node.scrollWidth === node.clientWidth));
    assert.equal(await journey.locator('.creator-journey-shop').evaluate(node => node.scrollTop), 0);
    await journey.getByRole('button', { name: indonesian ? 'Semua' : 'All', exact: true }).click();
    assert.ok(await product.count() > 1);
    assert.deepEqual(await stageBounds(), reference);
    const stylePicks = filters.getByRole('button', { name: 'Style picks' });
    await stylePicks.press('Enter');
    assert.equal(await stylePicks.getAttribute('aria-pressed'), 'true');
    if (width === 320) assert.ok(await filters.evaluate(node => node.scrollLeft > 0));
    const desk = journey.getByRole('button', { name: 'Desk setup', exact: true });
    await desk.click();
    assert.equal(await desk.getAttribute('aria-pressed'), 'true');
    await product.getByRole('heading', { name: 'Minimal desk lamp' }).waitFor();
    await input.fill('wrong');
    await journey.locator('.storefront-empty').waitFor();
    assert.deepEqual(await stageBounds(), reference);
    await input.fill(' prd-003 ');
    await product.getByRole('heading', { name: 'Classic canvas sneakers' }).waitFor();
    const storefront = indonesian ? 'Cari di etalase' : 'Search the storefront';
    assert.equal(await journey.locator('[aria-current="step"]').getAttribute('aria-label'), `3. ${storefront}`);
    assert.equal(await journey.locator('.creator-stepper button').count(), 3);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await journey.getByRole('button', { name: indonesian ? 'Kembali ke profil' : 'Back to profile' }).press('Enter');
    await profile.waitFor();
    assert.ok(await profile.evaluate(node => node === document.activeElement));
    await journey.getByRole('button', { name: indonesian ? '1. Lihat postingan' : '1. See the post' }).press('Enter');
    assert.deepEqual(await stageBounds(), reference);
    await capture(1);
    await journey.locator('.creator-stepper button').nth(1).click();
    await assertGuidance(2);
    await capture(2);
    await journey.getByRole('button', { name: `3. ${storefront}` }).press('Space');
    await assertGuidance(3);
    assert.equal(await input.inputValue(), 'sneakers');
    await capture(3);
    const violations = await page.evaluate(async () => (await window.axe.run('.creator-post-journey', {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
    assert.deepEqual(violations, []);
    await journey.getByRole('link', { name: indonesian ? 'Buka etalase demo' : 'Open demo storefront' }).click();
    await page.waitForURL('**/creator/demo');
    await page.locator('#creator-storefront-search').fill('PRD-003');
    await page.getByRole('heading', { name: 'Classic canvas sneakers' }).waitFor();
    if (width === 320) {
      let failPhoto;
      const pendingPhoto = new Promise(resolve => { failPhoto = resolve; });
      await page.route('https://images.unsplash.com/**', async route => {
        await pendingPhoto;
        await route.abort();
      });
      try {
        await page.goto('/creator');
        await journey.locator('.creator-stepper button').nth(2).click();
        await product.locator('.is-image-loading').waitFor();
        failPhoto();
        await product.getByText('Foto tidak tersedia', { exact: true }).waitFor();
        await product.getByRole('heading', { name: 'Classic canvas sneakers' }).waitFor();
      } finally {
        failPhoto();
        await page.unrouteAll({ behavior: 'wait' });
      }
    }
    console.log(`PASS navigation and walkthrough at ${width}px`);
    await page.close();
  }
} finally {
  await browser.close();
}
