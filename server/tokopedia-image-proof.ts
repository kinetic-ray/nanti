import { createHmac, timingSafeEqual } from 'node:crypto';

type PreviewImage = { owner: string; listing: string; product: string; image: string };
const lifetime = 5 * 60_000;

function digest(secret: string, image: PreviewImage, expires: number) {
  const { owner, listing, product, image: url } = image;
  return createHmac('sha256', secret)
    .update(JSON.stringify(['tokopedia-image-preview', expires, owner, listing, product, url]))
    .digest();
}

export function signTokopediaImage(secret: string, image: PreviewImage) {
  const expires = Date.now() + lifetime;
  return `${expires}.${digest(secret, image, expires).toString('hex')}`;
}

export function verifyTokopediaImage(secret: string, image: PreviewImage, proof: string) {
  const match = /^(\d{13})\.([0-9a-f]{64})$/u.exec(proof);
  if (!match) return false;
  const expires = Number(match[1]);
  const now = Date.now();
  return expires > now && expires <= now + lifetime &&
    timingSafeEqual(digest(secret, image, expires), Buffer.from(match[2]!, 'hex'));
}
