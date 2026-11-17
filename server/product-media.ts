import { identifyProduct } from './product-identity.js';
import { previewProductMetadata } from './product-preview.js';

const imageTypes = new Set(['image/jpeg', 'image/webp', 'image/avif', 'image/png']);
const maxBytes = 384 * 1024;
const ttl = 30 * 60_000;
type Thumbnail = { type: string; bytes: Buffer };

export function createProductMedia(request = fetch) {
  const cache = new Map<string, { expires: number; image: Promise<Thumbnail | null> }>();

  async function getThumbnail(canonical: string, market: string): Promise<Thumbnail | null> {
    try {
      const listing = new URL(canonical);
      const product = await previewProductMetadata(listing, request);
      if (!product?.image) return null;
      const photo = new URL(product.image);
      if (photo.origin !== listing.origin || photo.username || photo.password ||
          !photo.pathname.startsWith(`/${market}/images/products/`) ||
          !/^[a-z0-9_-]+\.(?:jpg|jpeg|png|webp|avif)$/iu.test(photo.pathname.split('/').at(-1) ?? '')) return null;
      photo.search = '?f=s';
      photo.hash = '';
      const response = await request(photo, {
        redirect: 'manual', signal: AbortSignal.timeout(3500), headers: { accept: 'image/webp,image/jpeg,image/png,image/avif' },
      });
      const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (!response.ok || !response.body || !type || !imageTypes.has(type) ||
          Number(response.headers.get('content-length')) > maxBytes) {
        await response.body?.cancel();
        return null;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) return null;
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return size ? { type, bytes: Buffer.concat(chunks, size) } : null;
    } catch {
      return null;
    }
  }

  return (url: string | null) => {
    const listing = identifyProduct(url);
    if (!listing) return Promise.resolve(null);
    const key = listing.canonicalUrl;
    const previous = cache.get(key);
    if (previous && previous.expires > Date.now()) return previous.image;
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    const entry = { expires: Date.now() + ttl, image: getThumbnail(key, listing.market) };
    cache.set(key, entry);
    void entry.image.then(result => {
      if (!result) entry.expires = Date.now() + 2 * 60_000;
    });
    return entry.image;
  };
}
