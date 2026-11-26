import { describe, expect, it, vi } from 'vitest';
import { createResilientResolver } from '../server/dns-resilience.js';

const hostname = 'www.tokopedia.com';
const addresses = ['23.46.152.213', '23.46.152.214'];

function dnsError(code: string) {
  return Object.assign(new Error(code), { code });
}

describe('DNS resilience', () => {
  it('uses primary DNS when available', async () => {
    const primary = vi.fn().mockResolvedValue(addresses);
    const fallback = vi.fn();

    const resolve = createResilientResolver(primary, fallback);

    expect(await resolve(
      hostname,
      new AbortController().signal,
    )).toEqual(addresses);

    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([
    'ESERVFAIL',
    'ETIMEOUT',
    'EAI_AGAIN',
    'ECONNREFUSED',
  ])('uses fallback after %s', async code => {
    const primary = vi.fn().mockRejectedValue(dnsError(code));
    const fallback = vi.fn().mockResolvedValue(addresses);

    const resolve = createResilientResolver(primary, fallback);

    expect(await resolve(
      hostname,
      new AbortController().signal,
    )).toEqual(addresses);

    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it.each([
    'ENOTFOUND',
    'ENODATA',
    'NANTI_DNS_UNSAFE',
  ])('does not fall back after %s', async code => {
    const primary = vi.fn().mockRejectedValue(dnsError(code));
    const fallback = vi.fn();

    const resolve = createResilientResolver(primary, fallback);

    await expect(resolve(
      hostname,
      new AbortController().signal,
    )).rejects.toMatchObject({ code });

    expect(fallback).not.toHaveBeenCalled();
  });

  it('preserves unsafe answers for downstream rejection', async () => {
    const primary = vi.fn().mockResolvedValue(['127.0.0.1']);
    const fallback = vi.fn();

    const resolve = createResilientResolver(primary, fallback);

    expect(await resolve(
      hostname,
      new AbortController().signal,
    )).toEqual(['127.0.0.1']);

    expect(fallback).not.toHaveBeenCalled();
  });

  it('does not fall back after cancellation', async () => {
    const controller = new AbortController();
    const reason = new DOMException('Cancelled', 'AbortError');

    const primary = vi.fn().mockImplementation(async () => {
      controller.abort(reason);
      throw dnsError('ETIMEOUT');
    });

    const fallback = vi.fn();
    const resolve = createResilientResolver(primary, fallback);

    await expect(resolve(
      hostname,
      controller.signal,
    )).rejects.toBe(reason);

    expect(fallback).not.toHaveBeenCalled();
  });

  it('stops after the fallback fails', async () => {
    const primary = vi.fn().mockRejectedValue(dnsError('ETIMEOUT'));
    const fallback = vi.fn().mockRejectedValue(dnsError('ESERVFAIL'));

    const resolve = createResilientResolver(primary, fallback);

    await expect(resolve(
      hostname,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'ESERVFAIL' });

    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
