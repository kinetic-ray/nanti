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
  const signInEntry = button(guest, 'Masuk');
  await signInEntry.press('Enter');
  const signIn = modal(guest, 'Masuk ke Nanti');
  await visible(signIn);
  const closeSignIn = button(signIn, 'Tutup');
  const googleSignIn = button(signIn, 'Lanjut dengan Google');
  const appleSignIn = signIn.getByRole('button', { name: /Lanjut dengan Apple/u });
  const emailField = signIn.getByLabel('Email', { exact: true });
  assert.equal(await signIn.getByRole('heading', { name: 'Masuk ke Nanti', exact: true })
    .evaluate(element => document.activeElement === element), true);
  assert.equal(await googleSignIn.isEnabled(), true);
  assert.equal(await appleSignIn.count(), 0);
  assert.equal(await signIn.getByLabel('Kata sandi', { exact: true }).isVisible(), true);
  assert.equal(await signIn.getByText('Simpan dulu. Putuskan nanti.', { exact: true }).isVisible(), false);
  await guest.keyboard.press('Tab');
  assert.equal(await closeSignIn.evaluate(element => document.activeElement === element), true);
  await guest.keyboard.press('Tab');
  assert.equal(await emailField.evaluate(element => document.activeElement === element), true);
  await guest.keyboard.press('Shift+Tab');
  assert.equal(await closeSignIn.evaluate(element => document.activeElement === element), true);
  await guest.keyboard.press('Shift+Tab');
  assert.equal(await signInEntry.evaluate(element => document.activeElement === element), false);
  await audit(guest, '360px Indonesian sign-in');
  await guest.keyboard.press('Escape');
  assert.equal(await signInEntry.evaluate(element => document.activeElement === element), true);
  await signInEntry.click();
  await closeSignIn.click();
  await signIn.waitFor({ state: 'hidden' });
  assert.equal(await signInEntry.evaluate(element => document.activeElement === element), true);
  await signInEntry.click();
  await button(signIn, 'Lanjut sebagai tamu').click();
  await signIn.waitFor({ state: 'hidden' });
  await button(guest, 'Buat kategori').click();
  const create = modal(guest, 'Kategori baru');
  await create.getByLabel('Nama kategori').fill('Wishlist tamu');
  await button(create, 'Simpan kategori').click();
  const list = guest.getByRole('heading', { name: 'Wishlist tamu', exact: true });
  await visible(list);
  await signInEntry.click();
  await button(signIn, 'Lanjut sebagai tamu').click();
  await signIn.waitFor({ state: 'hidden' });
  await visible(list);

  await signInEntry.click();
  await button(signIn, 'Lanjut dengan Google').click();
  const account = modal(guest, 'Akunmu');
  await visible(account.getByRole('heading', { name: 'Pindahkan data tamu', exact: true }));
  assert.equal(await list.isVisible(), false);
  await audit(guest, '360px Indonesian import');
  await button(account, 'Tutup').click();
  assert.equal(await list.isVisible(), false);
  await button(guest, 'Menu profil').click();
  await guest.getByRole('link', { name: 'Profil Saya' }).click();
  await button(account, 'Pindahkan data tamu').click();
  await visible(list);
  console.log('PASS 360px guest sign-in, keyboard recovery, confirmation, import and accessibility');

  const second = await device(390);
  const english = await open(second);
  await button(english, 'Switch to English').click();
  await button(english, 'Sign in').click();
  const englishSignIn = modal(english, 'Sign in to Nanti');
  await audit(english, '390px English sign-in');
  await english.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await englishSignIn.getByText('Save it now. Decide later.', { exact: true }).isVisible(), true);
  const signInBounds = await englishSignIn.boundingBox();
  assert.ok(signInBounds && signInBounds.width >= 850 && signInBounds.width <= 950);
  const emailBounds = await englishSignIn.getByLabel('Email', { exact: true }).boundingBox();
  assert.ok(emailBounds && emailBounds.width >= 350);
  await audit(english, '1280px English sign-in');
  await english.setViewportSize({ width: 390, height: 800 });
  await button(englishSignIn, 'Continue with Google').click();
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

  const adminPath = '/admin?view=accounts';
  const dashboard = await second.newPage();
  dashboard.on('pageerror', error => errors.push(error.message));
  await dashboard.goto(adminPath);
  await visible(button(dashboard, 'Continue with Google'));
  await audit(dashboard, '390px administrator sign-in');
  await button(dashboard, 'Continue with Google').press('Enter');
  await visible(dashboard.getByText('This account requires an administrator role.', { exact: false }));
  assert.equal(await dashboard.getByRole('heading', { name: 'Recent users' }).count(), 0);
  const identity = await db.authIdentity.findUniqueOrThrow({
    where: { provider_subjectHash: { provider: 'google', subjectHash: tokenHash(subject) } },
  });
  await db.user.update({ where: { id: identity.userId }, data: { role: 'admin' } });
  await dashboard.reload();
  await visible(dashboard.getByRole('heading', { name: 'Admin dashboard' }));
  await visible(dashboard.getByRole('heading', { name: 'Recent authentication activity' }));
  await audit(dashboard, '390px administrator dashboard');
  await dashboard.setViewportSize({ width: 1280, height: 800 });
  await audit(dashboard, '1280px administrator dashboard');
  await db.user.update({ where: { id: identity.userId }, data: { role: 'member' } });
  await button(dashboard, 'Refresh').click();
  await visible(dashboard.getByText('This account requires an administrator role.', { exact: false }));
  await button(dashboard, 'Sign out').click();
  await visible(button(dashboard, 'Continue with Google'));
  assert.equal(new URL(dashboard.url()).pathname, '/admin');
  console.log('PASS Google admin return, member denial, role revocation, logout and dashboard accessibility');

  await button(guest, 'Menu profil').click();
  await guest.getByRole('link', { name: 'Profil Saya' }).click();
  const creatorGuest = await second.newPage();
  await creatorGuest.goto('/creator/studio');
  await visible(creatorGuest.getByRole('link', { name: 'Sign in to Nanti' }));
  await creatorGuest.getByRole('link', { name: 'Sign in to Nanti' }).click();
  await visible(modal(creatorGuest, 'Sign in to Nanti'));
  await creatorGuest.close();
  const creator = await first.newPage();
  await creator.goto('/creator?onboard=1');
  await creator.getByLabel('Nama kreator').fill('Kreator fixture');
  await button(creator, 'Buat profil kreator').click();
  await visible(creator.getByRole('heading', { name: 'Bentuk etalasemu.' }));
  await creator.goto('/creator?onboard=1');
  await visible(creator.getByRole('heading', { name: 'Bentuk etalasemu.' }));
  assert.equal(new URL(creator.url()).pathname, '/creator/studio');
  await creator.close();
  console.log('PASS Creator guest gate, one-step setup and returning Studio access');

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
