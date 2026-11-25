import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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
    await expect(previewProductMetadata(link, head(offer('23.49', 'AggregateOffer') + tags))).resolves.toMatchObject({ price: null });
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
      return new Response('<html><head><link rel="canonical" href="https://shopee.co.id/product/123/456"><meta property="og:title" content="Example product"><meta property="og:image" content="https://cf.shopee.co.id/file/test"></head></html>',
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
  it('normalizes a high Tokopedia PDP selling price to minor units despite stale social price tags', async () => {
    const target = new URL('https://www.tokopedia.com/lenovo-authorized-surabaya/charger-innergie-by-delta-180w-gaming-adaptor-laptop-universal-t18');
    const body = readFileSync(new URL('./fixtures/tokopedia/live-single.html', import.meta.url), 'utf8')
      .replace('content="1735000"', 'content="999"')
      .replace('"value":1735000', '"value":12500000')
      .replace('"priceFmt":"Rp1.735.000"', '"priceFmt":"Rp12.500.000"');
    await expect(previewProductMetadata(target, async () => new Response(body,
      { headers: { 'content-type': 'text/html' } }))).resolves.toMatchObject({
      title: expect.stringMatching(/Charger INNERGIE/),
      price: { priceMinor: 1250000000, currency: 'IDR' },
    });
  });
  it('withholds conflicting prices and rejects a page with only unrelated listing metadata', async () => {
    const json = JSON.stringify({ '@type': 'Product', url: 'https://www.tokopedia.com/other/item',
      offers: { '@type': 'Offer', price: '1', priceCurrency: 'IDR' } });
    const fragment = '<meta property="product:price:amount" content="100"><meta property="product:price:currency" content="IDR">' +
      '<script type="application/ld+json">' + json + '</script>';
    await expect(previewProductMetadata(target, fetchHtml(fragment)))
      .resolves.toBeNull();
    const conflict = '<meta property="product:price:amount" content="200"><meta property="product:price:currency" content="IDR">' +
      '<script type="application/ld+json">' + JSON.stringify({ '@type': 'Product', url: target.href,
        offers: { '@type': 'Offer', price: '300', priceCurrency: 'IDR' } }) + '</script>';
    await expect(previewProductMetadata(target, fetchHtml(conflict)))
      .resolves.toMatchObject({ price: null });
  });
});


describe('Marketplace preview fallback coverage', () => {
  const target = new URL('https://www.tokopedia.com/shop/product');
  const html = (head: string) => async () => new Response('<html><head>' + head + '</head></html>',
    { headers: { 'content-type': 'text/html' } });

  it('uses a safe secondary image when the primary Open Graph image is disallowed', async () => {
    const result = await previewProductMetadata(target, html(
      '<link rel="canonical" href="/shop/product"><meta property="og:title" content="Lamp">' +
      '<meta property="og:image" content="https://example.com/unsafe.jpg">' +
      '<meta property="og:image:secure_url" content="https://images.tokopedia.net/img/lamp.jpg">',
    ));
    expect(result).toMatchObject({ title: 'Lamp', image: 'https://images.tokopedia.net/img/lamp.jpg' });
  });

  it('reads an ImageObject and a single Offer in an array from Product JSON-LD', async () => {
    const json = JSON.stringify({ '@type': 'Product', url: target.href, name: 'Reading Lamp',
      image: [{ '@type': 'ImageObject', url: 'https://images.tokopedia.net/img/lamp.jpg' }],
      offers: [{ '@type': 'Offer', price: '95000', priceCurrency: 'IDR' }] });
    await expect(previewProductMetadata(target, html(
      '<script type="application/ld+json">' + json + '</script>',
    ))).resolves.toMatchObject({
      title: 'Reading Lamp', image: 'https://images.tokopedia.net/img/lamp.jpg',
      price: { priceMinor: 9500000, currency: 'IDR' },
    });
  });

  it('does not guess a price from multiple variant offers', async () => {
    const json = JSON.stringify({ '@type': 'Product', url: target.href, name: 'Lamp',
      offers: [{ '@type': 'Offer', price: '10', priceCurrency: 'IDR' },
        { '@type': 'Offer', price: '20', priceCurrency: 'IDR' }] });
    await expect(previewProductMetadata(target, html(
      '<script type="application/ld+json">' + json + '</script>',
    ))).resolves.toMatchObject({ title: 'Lamp', price: null });
  });
});


describe('Safe import diagnostics', () => {
  it('reports an HTTP block without leaking the product link or affiliate query', async () => {
    const report = vi.fn();
    const target = new URL('https://s.shopee.co.id/8AXmF9lYur?affiliate=private');
    await expect(previewProductMetadata(target, async () => new Response(null, { status: 403 }), report))
      .resolves.toBeNull();
    expect(report).toHaveBeenCalledWith('access_blocked', 's.shopee.co.id', 403);
    expect(JSON.stringify(report.mock.calls)).not.toContain('affiliate');
    expect(JSON.stringify(report.mock.calls)).not.toContain('8AXmF9lYur');
  });
  it('reports missing public metadata without guessing a product title', async () => {
    const report = vi.fn();
    await expect(previewProductMetadata(new URL('https://www.shopee.co.id/example-i.123.456'),
      async () => new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html' } }), report))
      .resolves.toBeNull();
    expect(report).toHaveBeenCalledWith('metadata_missing', 'www.shopee.co.id', 200);
  });
});


describe('Precise IKEA diagnostics', () => {
  const product = new URL('https://www.ikea.com/us/en/p/lamp-12345678/');
  it('identifies an unsupported IKEA URL before attempting a network call', async () => {
    const report = vi.fn();
    const fetcher = vi.fn();
    await expect(previewProductMetadata(new URL('https://www.ikea.co.id/en/products/lamp'), fetcher, report))
      .resolves.toBeNull();
    expect(report).toHaveBeenCalledWith('adapter_disabled', 'www.ikea.co.id');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports a blocked IKEA response with its status', async () => {
    const report = vi.fn();
    await expect(previewProductMetadata(product, async () => new Response(null, { status: 403 }), report))
      .resolves.toBeNull();
    expect(report).toHaveBeenCalledWith('http_failure', 'www.ikea.com', 403);
  });
  it('reports missing IKEA metadata on an otherwise successful HTML response', async () => {
    const report = vi.fn();
    await expect(previewProductMetadata(product, async () =>
      new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html' } }), report))
      .resolves.toBeNull();
    expect(report).toHaveBeenCalledWith('metadata_missing', 'www.ikea.com', 200);
  });
});

describe('Shopee import reliability', () => {
  const short = new URL('https://s.shopee.co.id/114aBAsydf');
  const listing = new URL('https://shopee.co.id/lamp-i.123.456');
  it.each(['https://[', 'https://example.invalid/listing'])('attributes an invalid redirect to its sender', async (location) => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
    const report = vi.fn();
    await expect(previewProductMetadata(short, fetcher, report)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('redirect_disallowed', short.hostname, 302);
  });

  it('ends a fragment-only redirect loop on the first response', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 301, headers: { location: '#again' } }));
    const report = vi.fn();
    await expect(previewProductMetadata(short, fetcher, report)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('redirect_limit', short.hostname, 301);
  });

  it('skips malformed and unrelated structured metadata before reading the current listing', async () => {
    const entries = [{ '@type': 'Product', url: '/other', name: 'Other', image: 'https://cf.shopee.co.id/other' },
      { '@type': 'Product', url: listing.href, name: 'Lamp', image: 'https://cf.shopee.co.id/lamp' }];
    const html = '<script type="application/ld+json">{</script><script type="application/ld+json">' +
      JSON.stringify(entries) + '</script>';
    await expect(previewProductMetadata(listing, async () => new Response(html, { headers: { 'content-type': 'text/html' } })))
      .resolves.toMatchObject({ title: 'Lamp', image: 'https://cf.shopee.co.id/lamp' });
  });

  it('keeps the identity-matched JSON-LD seller across www aliases with prices disabled', async () => {
    const product = { '@type': 'Product', url: 'https://www.shopee.co.id/lamp-i.123.456', name: 'Lamp',
      offers: { '@type': 'Offer', price: '129000', priceCurrency: 'IDR',
        seller: { '@type': 'Organization', name: 'Lamp Shop' } } };
    const html = '<script type="application/ld+json">' + JSON.stringify(product) + '</script>';
    await expect(previewProductMetadata(listing, async () => new Response(html,
      { headers: { 'content-type': 'text/html' } }))).resolves.toMatchObject({
      title: 'Lamp', sellerName: 'Lamp Shop', productUrl: 'https://shopee.co.id/lamp-i.123.456',
      price: null,
    });
  });

  it.each([
    { '@type': 'AggregateOffer', lowPrice: '100', highPrice: '200', priceCurrency: 'IDR' },
    [{ '@type': 'Offer', price: '100', priceCurrency: 'IDR' },
      { '@type': 'Offer', price: '200', priceCurrency: 'IDR' }],
    { '@type': 'Offer', price: '100', priceCurrency: 'IDR', priceSpecification: { price: '50' } },
  ])('withholds aggregate, multiple, or promotional offer data: %j', async offers => {
    const html = '<script type="application/ld+json">' + JSON.stringify({
      '@type': 'Product', url: listing.href, name: 'Lamp', offers,
    }) + '</script>';
    await expect(previewProductMetadata(listing, async () => new Response(html,
      { headers: { 'content-type': 'text/html' } }))).resolves.toMatchObject({ title: 'Lamp', price: null });
  });

  it('withholds prices when product variants or multiple matching products are present', async () => {
    const product = { '@type': 'Product', url: listing.href, name: 'Lamp', hasVariant: [{ '@type': 'Product' }],
      offers: { '@type': 'Offer', price: '100', priceCurrency: 'IDR' } };
    const duplicate = { ...product, hasVariant: undefined };
    for (const data of [product, [duplicate, duplicate]]) {
      const html = '<script type="application/ld+json">' + JSON.stringify(data) + '</script>';
      await expect(previewProductMetadata(listing, async () => new Response(html,
        { headers: { 'content-type': 'text/html' } }))).resolves.toMatchObject({ price: null });
    }
  });
});

describe.each([
  ['https://s.shopee.co.id/start', 6],
  ['https://tk.tokopedia.com/start', 5],
] as const)('redirect budget for %s', (start, budget) => {
  it('stops at the request limit even if each redirect is unique', async () => {
    let hops = 0;
    const report = vi.fn();
    await expect(previewProductMetadata(new URL(start), async () => new Response(null, {
      status: 302, headers: { location: '/hop-' + ++hops },
    }), report)).resolves.toBeNull();
    expect(hops).toBe(budget);
    expect(report.mock.calls[0]?.[0]).toBe('redirect_limit');
  });
});

it('keeps an untrusted redirect host out of Tokopedia diagnostics', async () => {
  const start = new URL('https://tk.tokopedia.com/start');
  const report = vi.fn();
  const upstream = vi.fn(async () => new Response(null, { status: 302,
    headers: { location: 'https://untrusted.example/catalog' } }));
  await expect(previewProductMetadata(start, upstream, report)).resolves.toBeNull();
  expect(upstream).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalledWith('redirect_disallowed', start.hostname, 302);
});
