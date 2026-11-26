import { describe, expect, it } from 'vitest';
import { classifyNetworkError } from '../server/network-diagnostics.js';

describe('Marketplace network diagnostics', () => {
  it.each([
    ['ENOTFOUND', 'dns_failure'],
    ['EAI_AGAIN', 'dns_failure'],
    ['NANTI_DNS_UNSAFE', 'dns_unsafe'],
    ['ECONNRESET', 'connection_failure'],
    ['ECONNREFUSED', 'connection_failure'],
    ['ENETUNREACH', 'connection_failure'],
    ['CERT_HAS_EXPIRED', 'tls_failure'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_failure'],
    ['ETIMEDOUT', 'timeout'],
    ['UNKNOWN_ERROR', 'request_error'],
  ])('classifies %s as %s', (code, expected) => {
    const error = Object.assign(new Error('fixture'), { code });
    expect(classifyNetworkError(error)).toBe(expected);
  });

  it('preserves destination timeout diagnostics', () => {
    expect(classifyNetworkError(
      new DOMException('Timed out', 'TimeoutError'),
      true,
    )).toBe('destination_timeout');
  });

  it('does not expose sensitive error messages', () => {
    expect(classifyNetworkError(
      new Error('https://example.com/?secret=private'),
    )).toBe('request_error');
  });
});
