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
