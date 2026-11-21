export const currencies = ['USD', 'THB', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'MYR', 'IDR'] as const;
export type Currency = typeof currencies[number];

export type WishlistSummary = { id: string; name: string; currency: Currency };
export type ItemInput = { name: string; url: string | null; priceMinor: number | null; quantity: number; imageKey?: string | null; sellerName?: string | null };
export type ItemWriteInput = ItemInput & { priceSource?: 'imported_unverified' };
export type ItemSaveInput = ItemWriteInput & { saveTokopediaImage?: true; tokopediaProductUrl?: string };
export type Item = ItemInput & { id: string };
export type Wishlist = WishlistSummary & {
  items: Item[];
  totalMinor: string;
  unpriced: number;
};

export function parsePrice(value: string): number | null {
  const price = value.trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(price)) return null;
  const [whole, fraction = ''] = price.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
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
