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
