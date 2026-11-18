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

describe('Marketplace price metadata', () => {
  const target = new URL('https://www.tokopedia.com/shop/product');
  const fetchHtml = (fragment: string) => async () => new Response(
    '<html><head><meta property="og:title" content="Product">' + fragment + '</head></html>',
    { headers: { 'content-type': 'text/html' } },
  );
  it('imports a single published IDR offer', async () => {
    const json = JSON.stringify({ '@type': 'Product', url: target.href,
      offers: { '@type': 'Offer', price: '129000', priceCurrency: 'IDR' } });
    await expect(previewProductMetadata(target, fetchHtml(
      '<script type="application/ld+json">' + json + '</script>')))
      .resolves.toMatchObject({ title: 'Product', price: { priceMinor: 12900000, currency: 'IDR' } });
  });
  it('withholds conflicting prices and ignores unrelated listings', async () => {
    const json = JSON.stringify({ '@type': 'Product', url: 'https://www.tokopedia.com/other/item',
      offers: { '@type': 'Offer', price: '1', priceCurrency: 'IDR' } });
    const fragment = '<meta property="product:price:amount" content="100"><meta property="product:price:currency" content="IDR">' +
      '<script type="application/ld+json">' + json + '</script>';
    await expect(previewProductMetadata(target, fetchHtml(fragment)))
      .resolves.toMatchObject({ price: { priceMinor: 10000, currency: 'IDR' } });
    const conflict = '<meta property="product:price:amount" content="200"><meta property="product:price:currency" content="IDR">' +
      '<script type="application/ld+json">' + JSON.stringify({ '@type': 'Product',
        offers: { '@type': 'Offer', price: '300', priceCurrency: 'IDR' } }) + '</script>';
    await expect(previewProductMetadata(target, fetchHtml(conflict)))
      .resolves.toMatchObject({ price: null });
  });
});

describe('Optional Shopee provider', () => {
  it('uses a server-side API key and validates provider data', async () => {
    const previous = process.env.ZAPI_API_KEY;
    process.env.ZAPI_API_KEY = 'test-only-secret';
    try {
      const fetcher = vi.fn<typeof fetch>(async (input) => {
        expect(String(input)).toContain('api.zapi.ink/v1/marketplace:shopee/product');
        return new Response(JSON.stringify({ data: {
          name: 'Sample Shopee product',
          defaultImage: 'https://down-id.img.susercontent.com/file/sample',
          price: 125000,
        } }), { headers: { 'content-type': 'application/json' } });
      });
      await expect(previewProductMetadata(new URL('https://s.shopee.co.id/4LL2l34ZNP'), fetcher))
        .resolves.toMatchObject({ title: 'Sample Shopee product',
          image: 'https://down-id.img.susercontent.com/file/sample',
          price: { priceMinor: 12500000, currency: 'IDR' } });
      expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'test-only-secret' }),
      }));
    } finally {
      if (previous === undefined) delete process.env.ZAPI_API_KEY;
      else process.env.ZAPI_API_KEY = previous;
    }
  });
  it('falls back to public metadata if the provider rejects the request', async () => {
    const previous = process.env.ZAPI_API_KEY;
    process.env.ZAPI_API_KEY = 'test-only-secret';
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const fetcher = vi.fn<typeof fetch>(async (input) =>
        String(input).includes('api.zapi.ink') ?
          new Response(null, { status: 401 }) :
          new Response('<head><meta property="og:title" content="Fallback"></head>',
            { headers: { 'content-type': 'text/html' } }));
      await expect(previewProductMetadata(new URL('https://s.shopee.co.id/4LL2l34ZNP'), fetcher))
        .resolves.toMatchObject({ title: 'Fallback' });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(log.mock.calls)).not.toContain('test-only-secret');
    } finally {
      log.mockRestore();
      if (previous === undefined) delete process.env.ZAPI_API_KEY;
      else process.env.ZAPI_API_KEY = previous;
    }
  });
});
