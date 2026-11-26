import { requireTestDatabaseUrl } from './test-database-url.mjs';
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
import { prismaFinancialProfiles } from '../server/financial-profile.ts';
import { prismaIntelligence } from '../server/prisma-intelligence.ts';
import { prismaPrices } from '../server/prisma-prices.ts';
import { prismaWishlists } from '../server/prisma-wishlists.ts';

const databaseUrl = requireTestDatabaseUrl();
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
  consumer: { accounts: prismaAccounts(db), providers, financialProfiles: prismaFinancialProfiles(db) }, secret: randomBytes(32).toString('hex'),
  secureCookies: false, trustedProxy: 'loopback', preview: async () => null, webRoot: fileURLToPath(new URL('../dist/web/', import.meta.url)),
}));

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const errors = [];
const guestOwners = new Set();
let browser;
let deviceNumber = 0;
const button = (root, name) => root.getByRole('button', { name, exact: true });
const modal = (page, name) => page.getByRole('dialog', { name, exact: true });
const visible = locator => locator.waitFor({ state: 'visible' });

async function device(width) {
  const context = await browser.newContext({ baseURL, viewport: { width, height: 800 } });
  // Give each simulated device its own rate-limit bucket on the local fixture server.
  const address = `192.0.2.${++deviceNumber}`;
  await context.route(`${baseURL}/api/**`, route => route.continue({
    headers: { ...route.request().headers(), 'x-forwarded-for': address },
  }));
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
  await button(guest, 'Buat wishlist').click();
  const create = modal(guest, 'Kategori wishlist baru');
  await create.getByLabel('Nama kategori wishlist').fill('Wishlist tamu');
  await button(create, 'Simpan wishlist').click();
  const list = guest.getByRole('heading', { name: 'Wishlist tamu', exact: true });
  await visible(list);
  await signInEntry.click();
  await button(signIn, 'Lanjut sebagai tamu').click();
  await signIn.waitFor({ state: 'hidden' });
  await visible(list);

  await signInEntry.click();
  await button(signIn, 'Lanjut dengan Google').click();
  const account = guest.getByRole('main').filter({ has: guest.getByRole('heading', { name: 'Profil saya', exact: true }) });
  await visible(account.getByRole('heading', { name: 'Pindahkan data tamu', exact: true }));
  assert.equal(await list.isVisible(), false);
  await audit(guest, '360px Indonesian import');
  await account.getByRole('link', { name: 'Kembali ke wishlist', exact: true }).click();
  await visible(button(guest, 'Menu profil'));
  assert.equal(await list.isVisible(), false);
  await button(guest, 'Menu profil').click();
  await guest.getByRole('link', { name: 'Profil saya', exact: true }).click();
  await guest.waitForURL('**/account');
  assert.equal(await guest.locator('dialog[open]').count(), 0);
  await button(account, 'Pindahkan data tamu').click();
  await visible(list);
  console.log('PASS 360px guest sign-in, keyboard recovery, confirmation, import and accessibility');

  const accountIdentity = await db.authIdentity.findUniqueOrThrow({
    where: { provider_subjectHash: { provider: 'google', subjectHash: tokenHash(subject) } },
  });
  await db.creatorProfile.create({ data: { userId: accountIdentity.userId, name: 'Eligible browser creator' } });
  for (const mode of ['verify', 'reset']) {
    await guest.goto(`/account?recovery=${mode}#mode=${mode}&token=fixture`);
    const recovery = modal(guest, 'Akunmu');
    await visible(recovery.getByRole('button', { name: mode === 'reset' ? 'Simpan kata sandi baru' : 'Verifikasi email', exact: true }));
    await guest.waitForFunction(() => location.hash === '');
    await audit(guest, `360px signed-in ${mode}`);
    await recovery.getByRole('link', { name: 'Kembali ke akun', exact: true }).click();
    await visible(account.getByRole('link', { name: 'Creator Studio' }));
  }
  await account.getByRole('link', { name: 'Kembali ke wishlist', exact: true }).click();
  await account.waitFor({ state: 'hidden' });
  await db.creatorProfile.delete({ where: { userId: accountIdentity.userId } });
  console.log('PASS signed-in recovery links, fragment cleanup and accessibility');

  const passwordContext = await device(1280);
  const email = 'password-fixture@example.test';
  let resendRequests = 0;
  await passwordContext.route('**/api/account', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), emailDelivery: true } });
  });
  await passwordContext.route('**/api/account/password/*', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1);
    const data = route.request().postDataJSON();
    assert.equal(data.email, email);
    if (action === 'login') {
      const error = data.password === 'fixture-password' ? 'Verify your email before signing in.' :
        'Check your email, password, and email verification.';
      return route.fulfill({ status: 401, json: { error } });
    }
    if (action === 'resend' && ++resendRequests === 1) {
      return route.fulfill({ status: 503, json: { error: 'Email delivery is currently unavailable.' } });
    }
    assert.ok(['register', 'forgot', 'resend'].includes(action));
    await route.fulfill({ status: 202 });
  });
  const passwordPage = await open(passwordContext);
  await button(passwordPage, 'Masuk').click();
  const passwordDialog = modal(passwordPage, 'Selamat datang di Nanti');
  const resend = button(passwordDialog, 'Kirim ulang email verifikasi');
  const authModes = passwordDialog.getByRole('group', { name: 'Akses dengan email' });
  const passwordInput = passwordDialog.getByLabel('Kata sandi', { exact: true });
  const passwordEmail = passwordDialog.getByLabel('Email', { exact: true });
  const forgot = button(passwordDialog, 'Lupa kata sandi?');
  const signInShell = await passwordDialog.boundingBox();
  const promo = passwordDialog.locator('.account-editorial');
  const promoBounds = await promo.boundingBox();
  assert.equal(await resend.count(), 0);
  const [field, recovery, submit] = await Promise.all([
    passwordInput.boundingBox(), forgot.boundingBox(), button(passwordDialog, 'Masuk dengan email').boundingBox(),
  ]);
  assert.ok(recovery.y >= field.y + field.height && recovery.y + recovery.height <= submit.y);
  assert.ok(Math.abs(recovery.x + recovery.width - field.x - field.width) <= 1);
  await button(authModes, 'Buat akun').click();
  assert.deepEqual(await passwordDialog.boundingBox(), signInShell);
  assert.deepEqual(await promo.boundingBox(), promoBounds);
  assert.equal(await resend.count(), 0);
  await audit(passwordPage, '1280px registration');
  for (const width of [390, 320]) {
    await passwordPage.setViewportSize({ width, height: 480 });
    await audit(passwordPage, `${width}px registration`);
    await button(authModes, 'Masuk').click();
    await audit(passwordPage, `${width}px sign-in with email delivery`);
    await button(authModes, 'Buat akun').click();
  }
  await passwordPage.clock.install();
  await passwordEmail.fill(email);
  await passwordInput.fill('fixture-password');
  await button(passwordDialog.locator('form'), 'Buat akun').click();
  await visible(passwordDialog.getByRole('heading', { name: 'Cek email kamu' }));
  assert.equal(await resend.isDisabled(), true);
  await audit(passwordPage, '320px registration verification');
  await button(authModes, 'Masuk').click();
  await passwordEmail.fill(email);
  await passwordInput.fill('wrong-password');
  await button(passwordDialog, 'Masuk dengan email').click();
  await visible(passwordDialog.getByRole('alert'));
  assert.equal(await resend.count(), 0);
  await forgot.click();
  await passwordEmail.fill(email);
  await button(passwordDialog, 'Atur ulang kata sandi').click();
  await visible(passwordDialog.locator('.account-password').getByRole('status'));
  await button(passwordDialog, 'Kembali ke halaman masuk').click();
  await passwordPage.clock.fastForward(60_001);
  await passwordEmail.fill(email);
  await passwordInput.fill('fixture-password');
  await button(passwordDialog, 'Masuk dengan email').click();
  const verificationHeading = passwordDialog.getByRole('heading', { name: 'Cek email kamu' });
  await visible(verificationHeading);
  assert.equal(await verificationHeading.evaluate(element => document.activeElement === element), true);
  await resend.click();
  await visible(passwordDialog.getByRole('alert'));
  await resend.click();
  await visible(passwordDialog.locator('.account-password').getByRole('status').filter({ hasText: 'Tunggu satu menit' }));
  assert.equal(await resend.isDisabled(), true);
  assert.equal(resendRequests, 2);
  await passwordPage.clock.fastForward(60_001);
  assert.equal(await resend.isEnabled(), true);
  await button(authModes, 'Masuk').click();
  assert.equal(await passwordEmail.evaluate(element => document.activeElement === element), true);
  assert.equal(await resend.count(), 0);
  await passwordPage.keyboard.press('Escape');
  await passwordDialog.waitFor({ state: 'hidden' });
  await passwordContext.close();
  console.log('PASS desktop shell, 390px and 320px auth layouts, registration, recovery and verification resend states');

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
  const profile = english.getByRole('main').filter({ has: english.getByRole('heading', { name: 'My profile', exact: true }) });
  await button(profile, 'Edit').click();
  await profile.getByRole('textbox', { name: 'Display name', exact: true }).fill('Shared profile');
  await button(profile, 'Save name').click();
  await visible(profile.getByText('Display name saved.', { exact: true }));
  for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440]) {
    await english.setViewportSize({ width, height: 800 });
    await audit(english, `${width}px English account`);
  }
  await english.setViewportSize({ width: 390, height: 800 });
  const sibling = await open(second);
  await visible(sibling.getByRole('heading', { name: 'Wishlist tamu', exact: true }));
  await profile.getByRole('link', { name: 'Financial profile', exact: true }).click();
  await profile.getByRole('button', { name: /Savings target/ }).click();
  await profile.getByRole('textbox', { name: /save each month/i }).fill('1250000');
  await button(profile, 'Save').click();
  await visible(profile.getByText('Changes saved.', { exact: true }));
  await english.reload();
  await visible(profile.getByRole('button', { name: /Savings target.*1[.,]250[.,]000/ }));
  assert.equal((await db.financialProfile.findUniqueOrThrow({ where: { userId: accountIdentity.userId } })).savings.monthlyAmount, '1250000');
  await profile.getByRole('link', { name: 'Security', exact: true }).click();
  await visible(profile.getByText('Google', { exact: true }));
  assert.equal(await profile.getByText('Change password', { exact: true }).count(), 0);
  await profile.getByText('Active sessions', { exact: true }).click();
  await visible(profile.getByText('This session', { exact: true }));
  await button(profile, 'Sign out on this device').click();
  await english.waitForURL(url => url.pathname === '/');
  await visible(button(english, 'Sign in'));
  await english.goto('/account');
  await visible(modal(english, 'Sign in to Nanti'));
  assert.equal(await profile.count(), 0);
  await button(modal(english, 'Sign in to Nanti'), 'Continue as guest').click();
  await visible(button(english, 'Sign in'));
  await visible(button(sibling, 'Sign in'));
  assert.equal(await sibling.getByRole('heading', { name: 'Wishlist tamu', exact: true }).isVisible(), false);
  console.log('PASS 390px English persistence, cross-device access, profile editing, tab logout and accessibility');

  const adminPath = '/admin?view=accounts';
  const dashboard = await second.newPage();
  dashboard.on('pageerror', error => errors.push(error.message));
  await dashboard.goto(adminPath);
  await visible(button(dashboard, 'Lanjutkan dengan Google'));
  await audit(dashboard, '390px administrator sign-in');
  await button(dashboard, 'Lanjutkan dengan Google').press('Enter');
  await visible(dashboard.getByText('Akun ini memerlukan peran administrator.', { exact: false }));
  assert.equal(await dashboard.getByRole('heading', { name: 'Pengguna' }).count(), 0);
  const identity = await db.authIdentity.findUniqueOrThrow({
    where: { provider_subjectHash: { provider: 'google', subjectHash: tokenHash(subject) } },
  });
  await db.user.update({ where: { id: identity.userId }, data: { role: 'admin' } });
  await dashboard.reload();
  await visible(dashboard.getByRole('heading', { name: 'Ringkasan' }));
  await button(dashboard, 'Buka navigasi').click();
  await dashboard.getByRole('dialog', { name: 'Navigasi ruang kerja' })
    .getByRole('link', { name: 'Aktivitas masuk', exact: true }).click();
  await visible(dashboard.getByRole('heading', { name: 'Aktivitas masuk' }));
  await audit(dashboard, '390px administrator dashboard');
  await dashboard.setViewportSize({ width: 1280, height: 800 });
  await audit(dashboard, '1280px administrator dashboard');
  await db.user.update({ where: { id: identity.userId }, data: { role: 'member' } });
  await button(dashboard, 'Muat ulang').click();
  await visible(dashboard.getByText('Akun ini memerlukan peran administrator.', { exact: false }));
  await button(dashboard, 'Keluar').click();
  await visible(button(dashboard, 'Lanjutkan dengan Google'));
  assert.equal(new URL(dashboard.url()).pathname, '/admin');
  console.log('PASS Google admin return, member denial, role revocation, logout and dashboard accessibility');

  await button(guest, 'Menu profil').click();
  await guest.getByRole('link', { name: 'Creator Studio', exact: true }).click();
  await guest.waitForURL('**/creator/studio');
  await guest.goto('/account');
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
  await visible(creator.getByRole('heading', { name: 'Ringkasan' }));
  await creator.goto('/creator?onboard=1');
  await visible(creator.getByRole('heading', { name: 'Ringkasan' }));
  assert.equal(new URL(creator.url()).pathname, '/creator/studio');
  await creator.close();
  console.log('PASS Creator guest gate, one-step setup and returning Studio access');

  const recovered = await open(second);
  await recovered.goto('/account?next=financial-profile');
  await visible(modal(recovered, 'Sign in to Nanti'));
  await button(modal(recovered, 'Sign in to Nanti'), 'Continue with Google').click();
  await recovered.waitForURL('**/account?section=financial-profile');
  await visible(recovered.getByRole('button', { name: /Savings target.*1[.,]250[.,]000/ }));
  await account.getByRole('link', { name: 'Keamanan', exact: true }).click();
  const listed = guest.waitForResponse(response => new URL(response.url()).pathname === '/api/account/sessions');
  await account.getByText('Sesi aktif', { exact: true }).click();
  const sessionsResponse = await listed;
  assert.equal(sessionsResponse.status(), 200);
  const { sessions } = await sessionsResponse.json();
  assert.deepEqual(sessions.map(session => session.current).sort(), [false, true]);
  const revoke = button(account, 'Keluar dari sesi ini');
  await visible(revoke);
  assert.equal(await revoke.count(), 1);
  await revoke.click();
  await revoke.waitFor({ state: 'hidden' });
  await recovered.reload();
  await visible(modal(recovered, 'Sign in to Nanti'));
  assert.equal(await recovered.getByRole('heading', { name: 'Financial profile', exact: true }).count(), 0);
  assert.equal((await second.request.get('/api/account/financial-profile')).status(), 401);
  await recovered.close();
  console.log('PASS financial persistence, legacy return after sign-in and revoked-session access');
  await account.getByText('Hapus akun', { exact: true }).click();
  await account.getByRole('checkbox').check();
  await audit(guest, '360px deletion confirmation');
  await button(account, 'Hapus akun secara permanen').click();
  await visible(button(guest, 'Masuk'));
  assert.equal(await list.isVisible(), false);
  console.log('PASS 360px accessible account deletion');

  const workspaceEmail = `workspace-${randomUUID()}@example.test`;
  const originalPassword = 'local fixture password';
  const replacementPassword = 'local fixture replacement password';
  const passwords = prismaAccounts(db).passwords;
  await passwords.register(workspaceEmail, originalPassword);
  const credential = await db.passwordCredential.findUniqueOrThrow({ where: { email: workspaceEmail }, select: { userId: true } });
  const passwordDevice = await device(390);
  try {
    const verify = await passwords.issue(workspaceEmail, 'verify');
    assert.ok(verify);
    assert.ok(await passwords.consume(verify, 'verify', originalPassword));
    const page = await open(passwordDevice);
    await page.goto('/account');
    const signIn = modal(page, 'Masuk ke Nanti');
    await signIn.getByLabel('Email', { exact: true }).fill(workspaceEmail);
    await signIn.locator('input[name="password"]').fill(originalPassword);
    await signIn.locator('button[type="submit"]').click();
    await page.getByRole('heading', { name: 'Informasi akun', exact: true }).waitFor();
    await visible(page.getByText('Email terverifikasi', { exact: true }));
    await page.getByRole('link', { name: 'Keamanan', exact: true }).click();
    const change = page.locator('.account-security details').filter({ hasText: 'Ubah kata sandi' });
    await change.locator('summary').click();
    await change.getByRole('button', { name: 'Ubah kata sandi', exact: true }).click();
    await change.locator('input[name="currentPassword"]').fill(originalPassword);
    await change.locator('input[name="password"]').fill(replacementPassword);
    await change.locator('button[type="submit"]').click();
    await visible(signIn);
    assert.equal(await page.getByRole('heading', { name: 'Keamanan', exact: true }).count(), 0);
    await signIn.getByLabel('Email', { exact: true }).fill(workspaceEmail);
    await signIn.locator('input[name="password"]').fill(replacementPassword);
    await signIn.locator('button[type="submit"]').click();
    await page.getByRole('heading', { name: 'Informasi akun', exact: true }).waitFor();
  } finally {
    await passwordDevice.close();
    await db.user.delete({ where: { id: credential.userId } });
  }
  assert.deepEqual(errors, []);
  console.log('PASS verified password account, in-workspace password change and sign-in return');
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
