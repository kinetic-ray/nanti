import { resolve4 } from 'node:dns/promises';
import { request } from 'node:https';
import { expect, it, vi } from 'vitest';
import { extractTokopediaMetadata } from '../server/tokopedia-metadata.js';

vi.mock('node:dns/promises', () => ({ resolve4: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));

it('identifies the pinned Tokopedia HTTPS request as Nanti', async () => {
  vi.mocked(resolve4).mockResolvedValueOnce(['23.46.152.213']);
  // End the probe at the socket boundary. Extraction and fallback have their own fixtures.
  vi.mocked(request).mockImplementationOnce(() => { throw new Error('fixture socket closed'); });
  const listing = new URL('https://www.tokopedia.com/shop/lamp');
  await expect(extractTokopediaMetadata(listing.href)).resolves.toBeNull();
  expect(resolve4).toHaveBeenCalledWith(listing.hostname);
  expect(request).toHaveBeenCalledWith(listing, expect.objectContaining({
    agent: false,
    hostname: '23.46.152.213',
    servername: listing.hostname,
    signal: expect.any(AbortSignal),
    headers: {
      Host: listing.hostname,
      Accept: 'text/html',
      'Accept-Encoding': 'identity',
      'User-Agent': 'Nanti/1.0',
    },
  }), expect.any(Function));
});

it('validates Shopee DNS answers before opening a socket', async () => {
  const { previewProductMetadata } = await import('../server/product-preview.js');
  vi.mocked(request).mockClear();
  vi.mocked(resolve4).mockResolvedValueOnce(['23.46.152.213', '127.0.0.1']);
  const url = new URL('https://s.shopee.co.id/114aBAsydf');
  await expect(previewProductMetadata(url)).resolves.toBeNull();
  expect(resolve4).toHaveBeenCalledWith(url.hostname);
  expect(request).not.toHaveBeenCalled();
});

it('rejects a Tokopedia DNS response containing a non-public address before opening a socket', async () => {
  vi.mocked(request).mockClear();
  vi.mocked(resolve4).mockResolvedValueOnce(['23.46.152.213', '192.168.1.2']);
  const diagnostic = vi.fn();
  await expect(extractTokopediaMetadata('https://www.tokopedia.com/shop/lamp', undefined, diagnostic)).resolves.toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(diagnostic).toHaveBeenCalledWith('dns_unsafe', 'www.tokopedia.com', undefined);
});

it('ends a pending DNS lookup at the request deadline', async () => {
  const { requestPublicPage } = await import('../server/tokopedia-metadata.js');
  const controller = new AbortController();
  vi.mocked(request).mockClear();
  vi.mocked(resolve4).mockImplementationOnce(() => new Promise(() => {}));
  const response = requestPublicPage(new URL('https://shopee.co.id/'), controller.signal);
  controller.abort();
  await expect(response).rejects.toBe(controller.signal.reason);
  expect(request).not.toHaveBeenCalled();
});

it('fails over to a second validated address after a transient socket failure', async () => {
  const { requestPublicPage } = await import('../server/tokopedia-metadata.js');

  vi.mocked(request).mockClear();
  vi.mocked(resolve4).mockResolvedValueOnce([
    '23.46.152.213',
    '23.46.152.214',
  ]);

  vi.mocked(request)
    .mockImplementationOnce(() => {
      throw Object.assign(new Error('Connection reset'), {
        code: 'ECONNRESET',
      });
    })
    .mockImplementationOnce(() => {
      throw new Error('Second socket reached');
    });

  await expect(requestPublicPage(
    new URL('https://www.tokopedia.com/shop/lamp'),
    AbortSignal.timeout(5000),
  )).rejects.toThrow('Second socket reached');

  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenNthCalledWith(
    2,
    expect.any(URL),
    expect.objectContaining({
      hostname: '23.46.152.214',
      servername: 'www.tokopedia.com',
    }),
    expect.any(Function),
  );
});

it('does not retry a TLS certificate failure', async () => {
  const { requestPublicPage } = await import('../server/tokopedia-metadata.js');

  vi.mocked(request).mockClear();
  vi.mocked(resolve4).mockResolvedValueOnce([
    '23.46.152.213',
    '23.46.152.214',
  ]);

  vi.mocked(request).mockImplementationOnce(() => {
    throw Object.assign(new Error('Invalid certificate'), {
      code: 'CERT_HAS_EXPIRED',
    });
  });

  await expect(requestPublicPage(
    new URL('https://www.tokopedia.com/shop/lamp'),
    AbortSignal.timeout(5000),
  )).rejects.toThrow('Invalid certificate');

  expect(request).toHaveBeenCalledTimes(1);
});

it('fails over when the first address stalls before response headers', async () => {
  const { requestPublicPage } = await import('../server/tokopedia-metadata.js');
  const { EventEmitter } = await import('node:events');

  vi.useFakeTimers();

  try {
    vi.mocked(request).mockReset();
    vi.mocked(resolve4).mockResolvedValueOnce([
      '23.46.152.213',
      '23.46.152.214',
    ]);

    const socket = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn((error: Error) => {
        socket.emit('error', error);
      }),
    });

    vi.mocked(request)
      .mockImplementationOnce(() => socket as any)
      .mockImplementationOnce((_url, _options, callback) => {
        const incoming = {
          statusCode: 204,
          headers: {},
          destroy: vi.fn(),
        };

        queueMicrotask(() => (callback as Function)(incoming));

        return Object.assign(new EventEmitter(), {
          end: vi.fn(),
        }) as any;
      });

    const pending = requestPublicPage(
      new URL('https://www.tokopedia.com/shop/lamp'),
      new AbortController().signal,
    );

    await vi.advanceTimersByTimeAsync(2000);

    const response = await pending;

    expect(response.status).toBe(204);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it('does not fail over after receiving HTTP 403', async () => {
  const { requestPublicPage } = await import('../server/tokopedia-metadata.js');
  const { EventEmitter } = await import('node:events');

  vi.mocked(request).mockReset();
  vi.mocked(resolve4).mockResolvedValueOnce([
    '23.46.152.213',
    '23.46.152.214',
  ]);

  vi.mocked(request).mockImplementationOnce((_url, _options, callback) => {
    queueMicrotask(() => (callback as Function)({
      statusCode: 403,
      headers: {},
      destroy: vi.fn(),
    }));

    return Object.assign(new EventEmitter(), {
      end: vi.fn(),
    }) as any;
  });

  const response = await requestPublicPage(
    new URL('https://www.tokopedia.com/shop/lamp'),
    new AbortController().signal,
  );

  expect(response.status).toBe(403);
  expect(request).toHaveBeenCalledTimes(1);
});

it('does not fail over after global cancellation', async () => {
  const { requestPublicPage } = await import('../server/tokopedia-metadata.js');
  const controller = new AbortController();
  const reason = new DOMException('Cancelled', 'AbortError');

  vi.mocked(request).mockReset();
  vi.mocked(resolve4).mockResolvedValueOnce([
    '23.46.152.213',
    '23.46.152.214',
  ]);

  vi.mocked(request).mockImplementationOnce(() => {
    controller.abort(reason);
    throw Object.assign(new Error('Aborted'), {
      code: 'ECONNRESET',
    });
  });

  await expect(requestPublicPage(
    new URL('https://www.tokopedia.com/shop/lamp'),
    controller.signal,
  )).rejects.toBe(reason);

  expect(request).toHaveBeenCalledTimes(1);
});

it('keeps a valid response body readable after the attempt timer expires', async () => {
  const { requestPublicPage } = await import('../server/tokopedia-metadata.js');
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');

  vi.useFakeTimers();

  try {
    vi.mocked(request).mockReset();
    vi.mocked(resolve4).mockResolvedValueOnce([
      '23.46.152.213',
      '23.46.152.214',
    ]);

    const incoming = Object.assign(new PassThrough(), {
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
    });

    const socket = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn(),
    });

    vi.mocked(request).mockImplementationOnce((_url, _options, callback) => {
      queueMicrotask(() => (callback as Function)(incoming));
      return socket as any;
    });

    const response = await requestPublicPage(
      new URL('https://www.tokopedia.com/shop/lamp'),
      new AbortController().signal,
    );

    await vi.advanceTimersByTimeAsync(2500);

    incoming.end('<html>Valid product</html>');

    expect(await response.text()).toBe('<html>Valid product</html>');
    expect(socket.destroy).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
