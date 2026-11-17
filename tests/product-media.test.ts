import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { createProductMedia } from '../server/product-media.js';
import type { WishlistRepository } from '../server/wishlist.js';

const listing = 'https://www.ikea.com/us/en/p/example-product-12345678/';
const photo = 'https://www.ikea.com/us/en/images/products/example__123.jpg';
const bytes = Uint8Array.of(255, 216, 255, 217);
const page = (image: string) => new Response(`<head><meta property="og:image" content="${image}"></head>`, {
  headers: { 'content-type': 'text/html' },
});

describe('Saved product media', () => {
  it('uses the retailer photo and deduplicates simultaneous lookups without forwarding attribution', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(page(photo + '?source=tracking'))
      .mockResolvedValueOnce(new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }));
    const media = createProductMedia(fetcher);
    const expected = { type: 'image/jpeg', bytes: Buffer.from(bytes) };
    await expect(Promise.all([media(listing + '?utm_source=fixture'), media(listing)])).resolves.toEqual([expected, expected]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith(new URL(photo + '?f=s'), expect.objectContaining({ redirect: 'manual' }));
    expect(fetcher).toHaveBeenNthCalledWith(1, new URL(listing), expect.objectContaining({ redirect: 'manual' }));
  });

  it('uses a fallback for unsupported listings, mismatched photo hosts, redirects, and oversized bodies', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(page('https://example.test/image.jpg'));
    const media = createProductMedia(fetcher);
    await expect(media('https://example.test/item')).resolves.toBeNull();
    await expect(media(listing + '?variant=blue')).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(media(listing)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
    for (const invalid of [
      new Response(null, { status: 302, headers: { location: 'https://example.test/image.jpg' } }),
      new Response(bytes, { headers: { 'content-type': 'image/svg+xml' } }),
      new Response(new Uint8Array(384 * 1024 + 1), { headers: { 'content-type': 'image/jpeg' } }),
    ]) {
      const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(page(photo)).mockResolvedValueOnce(invalid);
      await expect(createProductMedia(upstream)(listing)).resolves.toBeNull();
    }
  });

  it('only resolves photos after the API authorizes the saved item and keeps responses out of browser caches', async () => {
    const summary = { id: randomUUID(), name: 'Fixture', currency: 'IDR' as const };
    const item = { id: randomUUID(), name: 'Fixture', priceMinor: null, quantity: 1, url: listing };
    let authorizedOwner: string | undefined;
    const repository: WishlistRepository = {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(async (owner: string) => { authorizedOwner = owner; return summary; }),
      find: vi.fn(async (owner: string, id: string) =>
        owner === authorizedOwner && id === summary.id ? { ...summary, items: [item] } : null),
      rename: vi.fn(), remove: vi.fn(), addItem: vi.fn(), updateItem: vi.fn(), removeItem: vi.fn(),
    };
    const media = vi.fn().mockResolvedValue({ type: 'image/jpeg', bytes: Buffer.from(bytes) });
    const app = createApp({ repository, productMedia: media, preview: async () => null,
      secret: randomUUID(), secureCookies: false });
    const mutation = { 'X-Nanti-Request': '1', 'Content-Type': 'application/json' };
    const path = `/api/wishlists/${summary.id}/items/${item.id}/image`;
    const owner = request.agent(app);
    const other = request.agent(app);
    await owner.post('/api/session').set(mutation).send({}).expect(200);
    await owner.post('/api/wishlists').set(mutation).send({ name: 'Fixture', currency: 'IDR' }).expect(201);
    await other.post('/api/session').set(mutation).send({}).expect(200);
    await request(app).get(path).expect(401);
    await other.get(path).expect(404);
    expect(media).not.toHaveBeenCalled();
    await owner.get(path).expect('Cache-Control', 'no-store').expect('Content-Type', 'image/jpeg').expect(200);
    expect(media).toHaveBeenCalledExactlyOnceWith(listing);
  });
});
