import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { chromium } from 'playwright-core';
import { createApp } from '../server/app.ts';
import { connectDatabase } from '../server/database.ts';
import { configureOAuth } from '../server/oauth-providers.ts';
import { prismaAccounts, tokenHash } from '../server/prisma-accounts.ts';
import { prismaIntelligence } from '../server/prisma-intelligence.ts';
import { prismaPrices } from '../server/prisma-prices.ts';
import { prismaWishlists } from '../server/prisma-wishlists.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname) ||
    !/_test$/u.test(new URL(databaseUrl).pathname)) {
  throw new Error('Set TEST_DATABASE_URL to a migrated local database whose name ends with _test.');
}
const db = connectDatabase(databaseUrl);
const key = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(key.publicKey), kid: 'browser-fixture', alg: 'RS256' };
const subject = randomUUID();
const server = createServer().listen(0, '127.0.0.1');
await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}`;
const codes = new Map();
const providers = await configureOAuth({
  AUTH_PUBLIC_ORIGIN: baseURL, AUTH_GOOGLE_CLIENT_ID: 'browser-fixture', AUTH_GOOGLE_CLIENT_SECRET: 'fixture',
}, false, async (_url, options) => {
  if (options.method === 'GET') return Response.json({ keys: [jwk] });
  const form = new URLSearchParams(options.body);
  const nonce = codes.get(form.get('code'));
  if (!nonce) return Response.json({ error: 'invalid_grant' }, { status: 400 });
  codes.delete(form.get('code'));
  const idToken = await new SignJWT({ nonce, name: 'Browser fixture' }).setIssuedAt().setExpirationTime('4m')
    .setSubject(subject).setIssuer('https://accounts.google.com').setAudience('browser-fixture')
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(key.privateKey);
  return Response.json({ id_token: idToken, access_token: 'fixture', token_type: 'Bearer' });
});
server.on('request', createApp({
  repository: prismaWishlists(db), intelligence: prismaIntelligence(db), prices: prismaPrices(db),
  consumer: { accounts: prismaAccounts(db), providers }, secret: randomBytes(32).toString('hex'),
  secureCookies: false, preview: async () => null, webRoot: fileURLToPath(new URL('../dist/web/', import.meta.url)),
}));

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const errors = [];
const guestOwners = new Set();
let browser;
const button = (root, name) => root.getByRole('button', { name, exact: true });
const modal = (page, name) => page.getByRole('dialog', { name, exact: true });
const visible = locator => locator.waitFor({ state: 'visible' });

async function device(width) {
  const context = await browser.newContext({ baseURL, viewport: { width, height: 800 } });
  await context.addInitScript({ path: axePath });
  await context.route('https://accounts.google.com/**', async route => {
    const authorization = new URL(route.request().url());
    const code = randomUUID();
    codes.set(code, authorization.searchParams.get('nonce'));
    const callback = new URL(authorization.searchParams.get('redirect_uri'));
    assert.equal(callback.href, baseURL + '/api/account/google/callback');
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', authorization.searchParams.get('state'));
    await route.fulfill({ status: 302, headers: { location: callback.href } });
  });
  return context;
}

async function open(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/session' && response.ok()),
    page.goto('/'),
  ]);
  const owner = (await context.cookies()).find(cookie => cookie.name === 'nanti');
  if (owner) guestOwners.add(decodeURIComponent(owner.value).slice(2).split('.')[0]);
  return page;
}

async function audit(page, label) {
  const results = await page.evaluate(async () => ({
    width: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    dialog: [...document.querySelectorAll('dialog[open]')].every(dialog => dialog.scrollWidth <= dialog.clientWidth + 1),
    violations: (await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => node.target) })),
  }));
  assert.equal(results.page, results.width, label);
  assert.equal(results.dialog, true, label);
  assert.deepEqual(results.violations, [], label);
}

try {
  browser = await chromium.launch({
    executablePath: process.env.NANTI_BROWSER_PATH ??
      (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
    args: ['--disable-background-networking'], headless: true,
  });
  const first = await device(360);
  const guest = await open(first);
  await button(guest, 'Masuk').focus();
  await guest.keyboard.press('Enter');
  const signIn = modal(guest, 'Masuk ke Nanti');
  await visible(signIn);
  assert.equal(await signIn.getByRole('heading').evaluate(element => document.activeElement === element), true);
  await audit(guest, '360px Indonesian sign-in');
  await guest.keyboard.press('Escape');
  assert.equal(await button(guest, 'Masuk').evaluate(element => document.activeElement === element), true);
  await button(guest, 'Buat wishlist').click();
  const create = modal(guest, 'Wishlist baru');
  await create.getByLabel('Nama wishlist').fill('Wishlist tamu');
  await button(create, 'Simpan wishlist').click();
  const list = guest.getByRole('heading', { name: 'Wishlist tamu', exact: true });
  await visible(list);
  await button(guest, 'Masuk').click();
  await button(signIn, 'Lanjut dengan Google').click();
  const account = modal(guest, 'Akunmu');
  await visible(account.getByRole('heading', { name: 'Pindahkan data tamu', exact: true }));
  assert.equal(await list.isVisible(), false);
  await audit(guest, '360px Indonesian import');
  await button(account, 'Tutup').click();
  assert.equal(await list.isVisible(), false);
  await button(guest, 'Akun').click();
  await button(account, 'Pindahkan data tamu').click();
  await visible(list);
  console.log('PASS 360px guest sign-in, keyboard recovery, confirmation, import and accessibility');

  const second = await device(390);
  const english = await open(second);
  await english.getByRole('button', { name: 'English', exact: true }).click();
  await button(english, 'Sign in').click();
  await audit(english, '390px English sign-in');
  await button(modal(english, 'Sign in to Nanti'), 'Continue with Google').click();
  await visible(english.getByRole('heading', { name: 'Wishlist tamu', exact: true }));
  assert.equal(await english.locator('html').getAttribute('lang'), 'en');
  await english.goto('/account');
  const profile = modal(english, 'Your account');
  await profile.getByLabel('Display name').fill('Shared profile');
  await button(profile, 'Save name').click();
  await visible(profile.getByText('Display name saved.', { exact: true }));
  for (const width of [320, 360, 390, 430, 768, 1280, 1440]) {
    await english.setViewportSize({ width, height: 800 });
    await audit(english, `${width}px English account`);
  }
  await english.setViewportSize({ width: 390, height: 800 });
  const sibling = await open(second);
  await visible(sibling.getByRole('heading', { name: 'Wishlist tamu', exact: true }));
  await button(profile, 'Sign out on this device').click();
  await visible(button(english, 'Sign in'));
  await visible(button(sibling, 'Sign in'));
  assert.equal(await sibling.getByRole('heading', { name: 'Wishlist tamu', exact: true }).isVisible(), false);
  console.log('PASS 390px English persistence, cross-device access, profile editing, tab logout and accessibility');

  await button(guest, 'Akun').click();
  await account.getByText('Hapus akun', { exact: true }).click();
  await account.getByRole('checkbox').check();
  await audit(guest, '360px deletion confirmation');
  await button(account, 'Hapus akun secara permanen').click();
  await visible(button(guest, 'Masuk'));
  assert.equal(await list.isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS 360px accessible account deletion');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  const remaining = await db.authIdentity.findUnique({
    where: { provider_subjectHash: { provider: 'google', subjectHash: tokenHash(subject) } },
  });
  if (remaining) await db.user.deleteMany({ where: { id: remaining.userId } });
  await db.dataOwner.deleteMany({ where: { id: { in: [...guestOwners] }, userId: null } });
  await db.$disconnect();
}
