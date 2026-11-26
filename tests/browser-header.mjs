import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const browser = await chromium.launch({
  executablePath: process.env.NANTI_BROWSER_PATH ??
    (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
});

try {
  const recovery = await browser.newPage();
  recovery.setDefaultTimeout(8000);
  try {
    await recovery.addInitScript(() => localStorage.setItem('nanti.language', 'en'));
    const unavailable = { status: 503, json: {
      error: 'Could not reach Nanti. Try again.',
    } };
    let sessionDown = true;
    let accountDown = true;
    await recovery.route('**/api/session', route => route.fulfill(sessionDown ? unavailable : { json: [] }));
    await recovery.route('**/api/recommendations/notifications', route => route.fulfill({ json: { notices: [] } }));
    await recovery.route('**/api/account', route => route.fulfill(accountDown ? unavailable : {
      json: { account: null, available: ['google'] },
    }));
    await recovery.goto(process.env.NANTI_BROWSER_BASE_URL ?? 'http://127.0.0.1:4173');
    await recovery.getByText('Could not reach Nanti. Try again.', { exact: true }).waitFor({ timeout: 4000 });
    sessionDown = false;
    await recovery.getByRole('button', { name: 'Try again', exact: true }).click();
    await recovery.getByRole('button', { name: 'Sign in', exact: true }).click();
    const dialog = recovery.getByRole('dialog');
    await dialog.getByText('Could not load your account. Try again.').waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Continue with Google' }).count(), 0);
    accountDown = false;
    await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
    await dialog.getByRole('button', { name: 'Continue with Google' }).waitFor();
    await dialog.getByLabel('Email', { exact: true }).waitFor();
    await dialog.getByLabel('Password', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Continue as guest' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await recovery.getByRole('heading', { name: /save it now/i }).waitFor();
    console.log('PASS session and account initialization failure, retry and guest continuation');
  } finally {
    await recovery.close();
  }

  for (const [width, height, account] of [
    [320, 568, null],
    [320, 568, { displayName: 'Sore Studio', email: 'sore@example.com', canAccessCreatorStudio: true }],
    [768, 700, { displayName: 'Sore Studio', email: 'sore@example.com' }],
    [1440, 900, { displayName: 'Sore Studio', email: 'sore@example.com', avatarUrl: 'https://lh3.googleusercontent.com/avatar' }],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    await page.addInitScript({ path: axePath });
    page.setDefaultTimeout(8000);
    await page.addInitScript(() => localStorage.setItem('nanti.language', 'en'));
    await page.route('**/api/session', route => route.fulfill({ json: [] }));
    let signedIn = Boolean(account);
    let logoutRequests = 0;
    await page.route('**/api/account', route => route.fulfill({ json: {
      account: signedIn ? { providers: [], recentlyVerified: false, import: null, ...account } : null, available: [],
    } }));
    await page.route('**/api/account/logout', route => {
      assert.equal(route.request().method(), 'POST');
      logoutRequests++;
      signedIn = false;
      return route.fulfill({ status: 204 });
    });
    const notice = {
      id: 'notice-1', readAt: null, request: { productName: 'Original product' },
      product: { title: 'Alternative product', url: 'https://example.com/product', priceMinor: 2500, currency: 'IDR' },
    };
    let notices = [];
    await page.route('**/api/recommendations/notifications', route => route.fulfill({ json: { notices } }));
    await page.route('**/api/recommendations/notifications/notice-1/read', route => {
      assert.equal(route.request().method(), 'PATCH');
      return route.fulfill({ status: 204 });
    });
    await page.route('https://lh3.googleusercontent.com/avatar', route => route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#5335aa"/></svg>',
    }));
    await page.goto(process.env.NANTI_BROWSER_BASE_URL ?? 'http://127.0.0.1:4173');
    await page.getByRole('heading', { name: /save it now/i }).waitFor();
    const header = page.locator('.masthead');
    assert.doesNotMatch(await header.textContent(), /alternative updates|kabar alternatif/i);
    const inbox = page.getByRole('region', { name: 'Alternative updates' });
    const inboxHeading = inbox.getByRole('heading', { name: 'Alternative updates' });
    const closeInbox = inbox.getByRole('button', { name: 'Close alternative updates' });
    await inbox.getByText('No alternative updates yet.').waitFor();
    assert.equal(await inbox.getByRole('list').count(), 0);
    assert.equal(await inbox.getByRole('button').count(), 1);
    assert.equal(await closeInbox.locator('.icon-close[aria-hidden="true"]').count(), 1);
    assert.equal(await inboxHeading.getByRole('button').count(), 0);

    const heroBounds = await page.locator('.home-hero').boundingBox();
    const inboxBounds = await inbox.boundingBox();
    const headingBounds = await inboxHeading.boundingBox();
    const closeBounds = await closeInbox.boundingBox();
    assert.ok(inboxBounds.y >= heroBounds.y + heroBounds.height);
    assert.ok(inboxBounds.height < 90, 'The empty state should stay compact');
    assert.ok(inboxBounds.x >= 0 && inboxBounds.x + inboxBounds.width <= width);
    assert.ok(closeBounds.x >= headingBounds.x + headingBounds.width);
    assert.ok(closeBounds.y - inboxBounds.y < 16);
    assert.ok(inboxBounds.x + inboxBounds.width - closeBounds.x - closeBounds.width < 16);
    assert.ok(closeBounds.width >= 44 && closeBounds.height >= 44);
    const inboxViolations = await page.evaluate(async () => (await window.axe.run('.recommendation-inbox', {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations.map(({ id }) => id));
    assert.deepEqual(inboxViolations, []);
    await closeInbox.press('Enter');
    const reopenInbox = page.getByRole('button', { name: 'Show alternative updates' });
    await inbox.waitFor({ state: 'hidden' });
    assert.ok(await reopenInbox.evaluate(el => el === document.activeElement));
    notices = [notice];
    await reopenInbox.press('Enter');
    await inbox.getByRole('heading', { name: 'Alternative product' }).waitFor();
    assert.ok(await inboxHeading.evaluate(el => el === document.activeElement));
    const markRead = inbox.getByRole('button', { name: 'Mark as read' });
    await markRead.press('Enter');
    await markRead.waitFor({ state: 'hidden' });
    const productLink = inbox.getByRole('link', { name: /View product/ });
    assert.ok(await productLink.evaluate(el => el === document.activeElement));

    const nav = header.getByRole('button', { name: 'Open menu' });
    const profile = header.getByRole('button', { name: 'Profile menu' });
    const mainMenu = header.getByRole('navigation');
    assert.equal(await profile.count(), Number(Boolean(account)));
    assert.equal(await header.getByRole('button', { name: 'Sign in' }).count(), Number(!account));
    for (const button of await header.getByRole('button').all()) {
      const { width, height } = await button.boundingBox();
      assert.deepEqual([width, height], [44, 44]);
      assert.equal(await button.evaluate(el => getComputedStyle(el).borderRadius), '12px');
    }
    await nav.press('Enter');
    await mainMenu.waitFor();
    assert.doesNotMatch(await mainMenu.textContent(), /alternative updates|kabar alternatif/i);
    if (!account && process.env.NANTI_HEADER_SCREENSHOTS) {
      await page.screenshot({ path: join(process.env.NANTI_HEADER_SCREENSHOTS, 'nanti-header-guest.png') });
    }
    assert.deepEqual((await mainMenu.getByRole('link').allTextContents()).map(text => text.trim()), ['Creator']);
    assert.equal(await nav.evaluate(el => getComputedStyle(el).borderRadius), '12px');
    await page.keyboard.press('Tab');
    assert.ok(await mainMenu.evaluate(el => el.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    assert.ok(await nav.evaluate(el => el === document.activeElement));
    if (account) {
      await nav.click();
      await profile.click();
      assert.equal(await mainMenu.isVisible(), false);
      const panel = page.locator('#masthead-profile');
      const bounds = await panel.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.ok(bounds.y + bounds.height <= height);
      assert.equal(await panel.getByText(account.email).count(), 1);
      assert.equal(await panel.getByRole('link', { name: 'My profile' }).getAttribute('href'), '/account');
      assert.deepEqual(await panel.locator('a, button').allTextContents(), ['My profile', 'Creator Studio', 'Sign out']);
      assert.equal(await panel.locator('a svg, button svg').count(), 3);
      assert.equal(await panel.getByRole('link', { name: 'Creator Studio' }).getAttribute('href'), '/creator/studio');
      if (account.avatarUrl) {
        await panel.locator('img').evaluate(img => img.decode());
      } else assert.equal(await panel.getByText('SS', { exact: true }).count(), 1);
      const violations = await page.evaluate(async () => (await window.axe.run('.masthead', {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })).violations.map(({ id }) => id));
      assert.deepEqual(violations, []);
      if (process.env.NANTI_HEADER_SCREENSHOTS) {
        await page.screenshot({ path: join(process.env.NANTI_HEADER_SCREENSHOTS, 'nanti-header-' + width + '.png') });
      }
      await header.locator('.brand').click();
      assert.equal(await panel.isVisible(), false);
      await profile.press('Enter');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Escape');
      assert.ok(await profile.evaluate(el => el === document.activeElement));
      await profile.click();
      await panel.getByRole('link', { name: 'My profile', exact: true }).click();
      await page.getByRole('heading', { name: 'Account information', exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/account');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal(await panel.isVisible(), false);
      await profile.click();
      await panel.getByRole('button', { name: 'Sign out', exact: true }).click();
      await header.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
      assert.equal(logoutRequests, 1);
      assert.equal(new URL(page.url()).pathname, '/');
    } else {
      await header.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('dialog').waitFor();
      await page.keyboard.press('Escape');
      assert.ok(await header.getByRole('button', { name: 'Sign in' }).evaluate(el => el === document.activeElement));
    }
    console.log(`PASS header at ${width}px (${account ? 'signed in' : 'guest'})`);
    await page.close();
  }
} finally {
  await browser.close();
}
