import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: process.env.NANTI_BROWSER_PATH ??
    (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
});
try {
  const page = await browser.newPage({ baseURL: process.env.NANTI_BROWSER_BASE_URL ?? 'http://127.0.0.1:4173' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('nanti.language', 'en'));
  let authenticated = true;
  let logoutRequests = 0;
  let pendingAccount;
  const profile = { id: 'creator', name: 'Creator fixture' };
  await page.route('**/api/**', async route => {
    switch (new URL(route.request().url()).pathname) {
      case '/api/account':
        await pendingAccount;
        return route.fulfill({ json: {
          available: [], account: authenticated ? { displayName: profile.name, providers: [], import: null } : null,
        } });
      case '/api/account/creator': return route.fulfill(authenticated ? { json: { profile, continued: true } }
        : { status: 401, json: { error: 'Sign in to continue.' } });
      case '/api/account/creator/design': return route.fulfill({ json: { design: null } });
      case '/api/account/creator/catalog': return route.fulfill({ json: { ...profile, products: [] } });
      case '/api/account/logout':
        logoutRequests++;
        return route.fulfill({ status: 204 });
      case '/api/session': return route.fulfill({ json: [] });
      case '/api/recommendations/notifications': return route.fulfill({ json: { notices: [] } });
      default: return route.fulfill({ json: {} });
    }
  });
  const dialogs = page.locator('dialog[open]');
  const noDialog = async () => assert.equal(await dialogs.count(), 0);
  const signedInHome = async () => {
    await page.waitForURL(url => url.pathname === '/');
    await page.getByRole('heading', { name: /save it now/i }).waitFor();
    await page.getByRole('button', { name: 'Profile menu' }).waitFor();
    await noDialog();
  };

  authenticated = false;
  await page.goto('/?auth=failed');
  await page.waitForFunction(() => location.search === '');
  await page.getByRole('heading', { name: /save it now/i }).waitFor();
  await noDialog();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialogs.waitFor();

  authenticated = true;
  await page.goto('/creator/studio');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  const session = Promise.withResolvers();
  pendingAccount = session.promise;
  await page.getByRole('link', { name: 'Back to wishlists', exact: true }).click();
  const loading = page.getByText('Preparing your account…', { exact: true });
  await loading.waitFor();
  await noDialog();
  session.resolve();
  pendingAccount = undefined;
  await signedInHome();
  assert.equal(await loading.count(), 0);
  await page.goBack();
  await page.waitForURL('**/creator/studio');
  await noDialog();
  await page.goForward();
  await signedInHome();
  await page.reload();
  await signedInHome();
  await Promise.all([
    page.waitForEvent('load'),
    page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))),
  ]);
  await signedInHome();
  assert.equal(logoutRequests, 0);

  authenticated = false;
  await page.reload();
  await page.getByRole('heading', { name: /save it now/i }).waitFor();
  await noDialog();
  assert.equal(await page.getByRole('button', { name: 'Profile menu' }).count(), 0);
  await page.goto('/creator/studio');
  await page.getByRole('link', { name: 'Sign in to Nanti' }).click();
  await page.getByRole('heading', { name: 'Sign in to Nanti', exact: true }).waitFor();
  await noDialog();
  assert.deepEqual(errors, []);
  console.log('PASS Creator return, history, reload, restored page, expired session, and explicit sign-in');
} finally {
  await browser.close();
}
