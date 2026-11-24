import { createHmac, timingSafeEqual } from 'node:crypto';

const lifetime = 5 * 60_000;
type PublicTitle = { owner: string; url: string; title: string; price?: { priceMinor: number; currency: string } };

function digest(secret: string, { owner, url, title, price }: PublicTitle, expires: number) {
  return createHmac('sha256', secret)
    .update(JSON.stringify(['public-product-title', expires, owner, url, title, ...(price ? [price.priceMinor, price.currency] : [])]))
    .digest();
}

export function signPublicTitle(secret: string, product: PublicTitle) {
  const expires = Date.now() + lifetime;
  return `${expires}.${digest(secret, product, expires).toString('hex')}`;
}

export function verifyPublicTitle(secret: string, product: PublicTitle, proof: string) {
  const match = /^(\d{13})\.([0-9a-f]{64})$/u.exec(proof);
  if (!match) return false;
  const expires = Number(match[1]);
  const now = Date.now();
  return expires > now && expires <= now + lifetime &&
    timingSafeEqual(digest(secret, product, expires), Buffer.from(match[2]!, 'hex'));
}
