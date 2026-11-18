import { describe, expect, it, vi } from 'vitest';
import { previewProduct, previewProductMetadata } from '../server/product-preview.js';

const link = new URL('https://www.ikea.com/us/en/p/example-product-12345678/?tracking=1#details');

describe('Product preview', () => {
  it('reads a single published price with currency, and withholds conflicting or aggregate offers', async () => {
    const head = (fragment: string) => async () => new Response(`<head>
      <meta property="og:title" content="Chair">
      <meta property="og:image" content="https://www.ikea.com/us/en/images/products/example_1.jpg">
      ${fragment}</head>`, { headers: { 'content-type': 'text/html' } });
    const offer = (price: string, type = 'Offer') => `<script type="application/ld+json">{
      "@type":"Product","offers":{"@type":"${type}","price":"${price}","priceCurrency":"USD"}
    }</script>`;
    const tags = '<meta property="product:price:amount" content="23.49"><meta property="product:price:currency" content="USD">';
    await expect(previewProductMetadata(link, head(offer('23.49') + tags))).resolves.toMatchObject({
      title: 'Chair', image: expect.stringContaining('example_1.jpg'), price: { priceMinor: 2349, currency: 'USD' },
    });
    await expect(previewProductMetadata(link, head(offer('25.00') + tags))).resolves.toMatchObject({ price: null });
    await expect(previewProductMetadata(link, head(offer('23.49', 'AggregateOffer')))).resolves.toMatchObject({ price: null });
  });
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


describe('Marketplace shortlink redirects', () => {
  it('follows an allowlisted Shopee redirect to a www product page and extracts metadata', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const target = String(url);
      if (target.startsWith('https://s.shopee.co.id/')) return new Response(null, {
        status: 302, headers: { location: 'https://www.shopee.co.id/example-i.123.456' },
      });
      return new Response('<html><head><meta property="og:title" content="Example product"><meta property="og:image" content="https://cf.shopee.co.id/file/test"></head></html>',
        { headers: { 'content-type': 'text/html' } });
    });
    await expect(previewProductMetadata(new URL('https://s.shopee.co.id/abcd'), fetcher))
      .resolves.toMatchObject({ title: 'Example product', image: 'https://cf.shopee.co.id/file/test', price: null });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects redirects outside marketplace allowlists without fetching destination', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, {
      status: 302, headers: { location: 'https://example.com/redirect' },
    }));
    await expect(previewProductMetadata(new URL('https://s.shopee.co.id/abcd'), fetcher)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe('Tokopedia redirect diagnostics', () => {
  it('identifies destination timeout without exposing the affiliate URL', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const fetcher = vi.fn<typeof fetch>(async (url) => {
        if (new URL(String(url)).hostname === 'tk.tokopedia.com') return new Response(null, {
          status: 302, headers: { location: 'https://www.tokopedia.com/example/product?affiliate=secret' },
        });
        throw new DOMException('The operation timed out', 'TimeoutError');
      });
      await expect(previewProductMetadata(new URL('https://tk.tokopedia.com/ZSp76BWQL/'), fetcher))
        .resolves.toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledWith('[product-import]', {
        merchant: 'tokopedia', host: 'www.tokopedia.com', reason: 'destination_timeout',
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
    } finally { log.mockRestore(); }
  });
});
