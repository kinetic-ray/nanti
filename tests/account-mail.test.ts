import { afterEach, expect, it, vi } from 'vitest';
import { accountMailUrl, resolveAccountMailOrigin } from '../server/account-mail-links.js';
import * as mail from '../server/transactional-account-mail.js';

afterEach(() => vi.unstubAllGlobals());

const env = {
  NODE_ENV: 'production',
  AUTH_PUBLIC_ORIGIN: 'https://nanti-liart.vercel.app',
  NANTI_ACCOUNT_MAIL_API_KEY: 'fixture-api-key',
  NANTI_ACCOUNT_MAIL_FROM: 'accounts@example.test',
};

it('requires a bare HTTPS origin and a complete mail configuration', () => {
  expect(mail.transactionalAccountMail({})).toBeNull();
  expect(() => mail.transactionalAccountMail({ ...env, AUTH_PUBLIC_ORIGIN: 'http://nanti-liart.vercel.app' })).toThrow();
  expect(() => mail.transactionalAccountMail({ RESEND_API_KEY: 'fixture-key', AUTH_PUBLIC_ORIGIN: 'https://example.test/path' })).toThrow();
});

it('uses only the canonical production origin and has no production fallback', () => {
  expect(resolveAccountMailOrigin(env).origin).toBe('https://nanti-liart.vercel.app');
  expect(() => resolveAccountMailOrigin({ NODE_ENV: 'production' })).toThrow(/canonical production origin/u);
  expect(() => resolveAccountMailOrigin({ NODE_ENV: 'production', AUTH_PUBLIC_ORIGIN: 'https://nanti.vercel.app' }))
    .toThrow(/canonical production origin/u);
  expect(() => accountMailUrl('verify', 'fixture-token', false, { NODE_ENV: 'production' })).toThrow();
});

it('sends recovery links with tokens in the fragment and reports provider failures safely', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('private payload', { status: 502 }));
  vi.stubGlobal('fetch', fetch);
  const send = mail.transactionalAccountMail(env)!;
  await send('user@example.test', 'reset', 'fixture-token', true);
  const [endpoint, request] = fetch.mock.calls[0]!;
  expect(endpoint).toBe('https://api.resend.com/emails');
  expect(request.headers.Authorization).toBe('Bearer fixture-api-key');
  const message = JSON.parse(request.body);
  expect(message.from).toBe('Nanti <accounts@example.test>');
  expect(message.to).toEqual(['user@example.test']);
  const link = new URL(message.text.match(/https:\/\/\S+/)[0]);
  expect(link.origin).toBe('https://nanti-liart.vercel.app');
  expect(link.pathname).toBe('/account');
  expect(link.searchParams.get('next')).toBe('creator');
  expect(link.searchParams.has('token')).toBe(false);
  expect(new URLSearchParams(link.hash.slice(1)).get('token')).toBe('fixture-token');
  await expect(send('user@example.test', 'verify', 'fixture-token', false)).rejects.toThrow(/^Account email could not be submitted\.$/);
  expect(fetch.mock.calls[1]![1].headers.Authorization).toBe('Bearer fixture-api-key');
  expect(fetch.mock.calls[1]![1].body).not.toContain('fixture-api-key');
});

it('centralizes verification, resend-verification, reset, and email-change links', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const send = mail.transactionalAccountMail(env)!;
  const requested: Array<'verify' | 'reset' | 'changeEmail'> = ['verify', 'verify', 'reset', 'changeEmail'];
  for (const [index, kind] of requested.entries()) await send('user@example.test', kind, `token-${index}`, false);

  for (const [index, kind] of requested.entries()) {
    const message = JSON.parse(fetch.mock.calls[index]![1].body);
    const raw = message.text.match(/https:\/\/\S+/)?.[0];
    expect(raw).toBeTruthy();
    const link = new URL(raw!);
    expect(link.origin).toBe('https://nanti-liart.vercel.app');
    expect(link.pathname).toBe('/account');
    expect(link.searchParams.get('recovery')).toBe(kind);
    expect(new URLSearchParams(link.hash.slice(1)).get('mode')).toBe(kind);
    expect(new URLSearchParams(link.hash.slice(1)).get('token')).toBe(`token-${index}`);
  }
});

it('keeps the localhost origin fallback limited to development', () => {
  const local = { NODE_ENV: 'development', NANTI_DEV_WEB_PORT: '5174' };
  expect(resolveAccountMailOrigin(local).origin).toBe('http://127.0.0.1:5174');
  const link = new URL(accountMailUrl('verify', 'fixture-token', false, local));
  expect(link.origin).toBe('http://127.0.0.1:5174');
});

it('accepts RESEND_API_KEY and defaults to the temporary Resend testing sender', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const config = { AUTH_PUBLIC_ORIGIN: env.AUTH_PUBLIC_ORIGIN, RESEND_API_KEY: 'resend-fixture-key' };
  expect(mail.accountMailConfigured(config)).toBe(true);
  await mail.transactionalAccountMail(config)!('user@example.test', 'verify', 'fixture-token', false);
  const request = fetch.mock.calls[0]![1];
  const message = JSON.parse(request.body);
  expect(request.headers.Authorization).toBe('Bearer resend-fixture-key');
  expect(message.from).toBe('Nanti <onboarding@resend.dev>');
  expect(message.to).toEqual(['user@example.test']);
  expect(request.body).not.toContain('resend-fixture-key');
});

it('prefers RESEND_API_KEY while retaining the legacy key and sender override', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const config = { ...env, RESEND_API_KEY: 'preferred-resend-key' };
  await mail.transactionalAccountMail(config)!('user@example.test', 'verify', 'fixture-token', false);
  expect(fetch.mock.calls[0]![1].headers.Authorization).toBe('Bearer preferred-resend-key');
  expect(JSON.parse(fetch.mock.calls[0]![1].body).from).toBe('Nanti <accounts@example.test>');
  expect(mail.accountMailConfigured({ ...env, RESEND_API_KEY: '' })).toBe(true);
  expect(mail.accountMailConfigured({})).toBe(false);
});
