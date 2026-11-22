import { afterEach, expect, it, vi } from 'vitest';
import * as mail from '../server/transactional-account-mail.js';

afterEach(() => vi.unstubAllGlobals());

const env = {
  AUTH_PUBLIC_ORIGIN: 'https://nanti.example.test',
  NANTI_ACCOUNT_MAIL_API_KEY: 'fixture-api-key',
  NANTI_ACCOUNT_MAIL_FROM: 'accounts@example.test',
};

it('requires a bare HTTPS origin and a complete mail configuration', () => {
  expect(mail.transactionalAccountMail({})).toBeNull();
  expect(() => mail.transactionalAccountMail({ ...env, AUTH_PUBLIC_ORIGIN: 'http://example.test' })).toThrow();
  expect(() => mail.transactionalAccountMail({ ...env, NANTI_ACCOUNT_MAIL_FROM: '' })).toThrow();
});

it('sends recovery links with tokens in the fragment and reports provider failures safely', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('private payload', { status: 502 }));
  vi.stubGlobal('fetch', fetch);
  const send = mail.transactionalAccountMail(env)!;
  await send('user@example.test', 'reset', 'fixture-token', true);
  const [endpoint, request] = fetch.mock.calls[0]!;
  expect(endpoint).toBe('https://api.resend.com/emails');
  const message = JSON.parse(request.body);
  expect(message.to).toEqual(['user@example.test']);
  const link = new URL(message.text.match(/https:\/\/\S+/)[0]);
  expect(link.searchParams.get('next')).toBe('creator');
  expect(link.searchParams.has('token')).toBe(false);
  expect(new URLSearchParams(link.hash.slice(1)).get('token')).toBe('fixture-token');
  await expect(send('user@example.test', 'verify', 'fixture-token', false)).rejects.toThrow(/^Account email could not be submitted\.$/);
});
