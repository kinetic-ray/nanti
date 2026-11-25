export const currencies = ['USD', 'THB', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'MYR', 'IDR'] as const;
export type Currency = typeof currencies[number];
// priceMinor is stored as a signed 32-bit integer in Prisma/MySQL.
export const maxPriceMinor = 2_147_483_647;

export type WishlistSummary = { id: string; name: string; currency: Currency };
export type ItemInput = { name: string; url: string | null; priceMinor: number | null; quantity: number; imageKey?: string | null; sellerName?: string | null };
export type ItemWriteInput = ItemInput & { priceSource?: 'imported_unverified' };
export type ItemSaveInput = ItemWriteInput & {
  publicTitle?: { title: string; proof: string };
  publicPriceProof?: string;
  verifiedListing?: { url: string; proof: string };
  saveMarketplaceImage?: true;
  tokopediaProductUrl?: string;
  tokopediaImage?: { url: string; proof: string };
};
export type Item = ItemInput & { id: string };
export type Wishlist = WishlistSummary & {
  items: Item[];
  totalMinor: string;
  unpriced: number;
};

export function parsePrice(value: string): number | null {
  const price = value.trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(price)) return null;
  const [whole, fraction = ''] = price.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) && minor <= maxPriceMinor ? minor : null;
}

export function formatPrice(minor: number | string, currency: Currency, locale?: string) {
  const amount = BigInt(minor);
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fraction = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }).format(amount % 100n);
  return formatter.formatToParts(amount / 100n)
    .map((part) => part.type === 'fraction' ? fraction : part.value).join('');
}

export function safeProductUrl(value: string): URL | null {
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.href.length > 2048) return null;
    return url;
  } catch {
    return null;
  }
}
