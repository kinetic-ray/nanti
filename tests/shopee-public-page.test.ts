import { expect, it, vi } from 'vitest';
import { extractShopeeMetadata } from '../server/shopee-metadata.js';

const listing = new URL('https://shopee.co.id/product/1601973354/28190565299');

it('identifies a metadata-free Shopee app shell with HTTP 200', async () => {
  const diagnostic = vi.fn();
  const page = '<!doctype html><head></head><body><div id="main"></div><script src="/app.js"></script></body>';
  const transport = vi.fn(async () => new Response(page, { headers: { 'content-type': 'text/html' } }));
  expect(await extractShopeeMetadata(listing, transport, diagnostic)).toBeNull();
  expect(diagnostic).toHaveBeenCalledWith('storefront_shell', 'shopee.co.id', 200);
  expect(transport).toHaveBeenCalledOnce();
});

it('accepts matching public body JSON-LD and ignores unrelated or unidentified products', async () => {
  const products = [
    { '@type': 'Product', name: 'Unrelated shoe', url: 'https://shopee.co.id/product/1/2' },
    { '@type': 'Product', name: 'Unidentified shoe' },
    { '@type': 'Product', name: 'Matching shoe', url: listing.href },
  ];
  const page = '<!doctype html><head></head><body><main><script type="application/ld+json">' +
    JSON.stringify(products) + '</script></main></body>';
  const transport = async () => new Response(page, { headers: { 'content-type': 'text/html' } });
  expect(await extractShopeeMetadata(listing, transport)).toMatchObject({ title: 'Matching shoe', productUrl: listing.href });
});
