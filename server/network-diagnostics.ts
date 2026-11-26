export function classifyNetworkError(error: unknown, redirected = false): string {
  const timeout = redirected ? 'destination_timeout' : 'timeout';

  if (!error || typeof error !== 'object') return 'request_error';

  const { name, code } = error as {
    name?: string;
    code?: string;
  };

  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    code === 'ETIMEDOUT' ||
    code === 'ABORT_ERR'
  ) return timeout;

  if (code === 'NANTI_DNS_UNSAFE') return 'dns_unsafe';

  if (code && [
    'ENOTFOUND',
    'EAI_AGAIN',
    'ENODATA',
    'ESERVFAIL',
    'EREFUSED',
    'ETIMEOUT',
  ].includes(code)) return 'dns_failure';

  if (typeof code === 'string' && (
    code.startsWith('ERR_TLS_') ||
    code.startsWith('ERR_SSL_') ||
    [
      'CERT_HAS_EXPIRED',
      'CERT_NOT_YET_VALID',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    ].includes(code)
  )) return 'tls_failure';

  if (code && [
    'ECONNRESET',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
  ].includes(code)) return 'connection_failure';

  return 'request_error';
}
