import { expect, it, vi } from 'vitest';
import { downloadTokopediaImage } from '../server/tokopedia-metadata.js';

const imageUrl = 'https://images.tokopedia.net/image.jpg';
// Baseline JPEG frame and scan markers with bounded dimensions.
const jpeg = Buffer.from('ffd8ffc0000b080010002001011100ffda0008010100003f0000ffd9', 'hex');
const page = (body: Uint8Array, type = 'image/jpeg') => new Response(Buffer.from(body), {
  headers: { 'content-type': type },
});

it('accepts only a bounded JPEG from an approved HTTPS image host', async () => {
  const fetchImage = vi.fn(async () => page(jpeg));
  await expect(downloadTokopediaImage(imageUrl, fetchImage)).resolves.toEqual(jpeg);
  for (const url of ['http://images.tokopedia.net/a.jpg', 'https://images.tokopedia.net.example.org/a.jpg',
    'https://images.tokopedia.net:8443/a.jpg', 'https://127.0.0.1/a.jpg']) {
    await expect(downloadTokopediaImage(url, fetchImage)).resolves.toBeNull();
  }
  expect(fetchImage).toHaveBeenCalledOnce();
});

it('rejects redirect, invalid MIME, malformed dimensions and oversized bodies', async () => {
  const oversizedDimensions = Buffer.from(jpeg);
  oversizedDimensions.writeUInt16BE(65535, 7);
  const responses = [
    new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/a.jpg' } }),
    page(jpeg, 'image/svg+xml'),
    page(Buffer.from('not JPEG')),
    page(oversizedDimensions),
    page(Buffer.alloc(195_001)),
  ];
  for (const response of responses) {
    const fetchImage = vi.fn(async () => response);
    await expect(downloadTokopediaImage(imageUrl, fetchImage)).resolves.toBeNull();
    expect(fetchImage).toHaveBeenCalledOnce();
  }
});
