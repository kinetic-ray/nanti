import { describe, expect, it, vi } from 'vitest';
import { previewProduct } from '../server/product-preview.js';

const link = new URL('https://www.ikea.com/us/en/p/example-product-12345678/?tracking=1#details');

describe('Product preview', () => {
  it('reads the supported product name and strips tracking from the outgoing request', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(
      '<head><meta content="Lamp &amp; Shade" property="og:title"></head>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    ));
    await expect(previewProduct(link, fetcher)).resolves.toBe('Lamp & Shade');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      new URL('https://www.ikea.com/us/en/p/example-product-12345678/'),
      expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }),
    );
  });

  it('skips unsupported hosts, paths and protocols without outgoing requests', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const url of ['https://example.com/us/en/p/x-12345678/',
      'http://www.ikea.com/us/en/p/x-12345678/', 'https://www.ikea.com/us/en/']) {
      await expect(previewProduct(new URL(url), fetcher)).resolves.toBeNull();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('falls back on redirects, an oversized document, missing metadata or a network failure', async () => {
    for (const response of [
      new Response(null, { status: 302, headers: { location: 'https://example.com/' } }),
      new Response('<head><title>Product</title></head>', { headers: { 'content-type': 'text/html' } }),
      new Response(`<head>${' '.repeat(524288)}<meta property="og:title" content="Too late"></head>`,
        { headers: { 'content-type': 'text/html' } }),
    ]) {
      await expect(previewProduct(link, async () => response)).resolves.toBeNull();
    }
    await expect(previewProduct(link, async () => { throw new Error('network'); })).resolves.toBeNull();
  });
});
