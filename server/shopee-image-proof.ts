import { createHmac, timingSafeEqual } from 'node:crypto';

type ShopeePreviewImage = { owner: string; listing: string; product: string; image: string };
const lifetime = 5 * 60_000;

function digest(secret: string, value: ShopeePreviewImage, expires: number) {
  return createHmac('sha256', secret)
    .update(JSON.stringify(['shopee-image-preview', expires, value.owner, value.listing, value.product, value.image]))
    .digest();
}

export function signShopeeImage(secret: string, value: ShopeePreviewImage) {
  const expires = Date.now() + lifetime;
  return `${expires}.${digest(secret, value, expires).toString('hex')}`;
}

export function verifyShopeeImage(secret: string, value: ShopeePreviewImage, proof: string) {
  const match = /^(\d{13})\.([0-9a-f]{64})$/u.exec(proof);
  if (!match) return false;
  const expires = Number(match[1]);
  const now = Date.now();
  return expires > now && expires <= now + lifetime &&
    timingSafeEqual(digest(secret, value, expires), Buffer.from(match[2]!, 'hex'));
}
