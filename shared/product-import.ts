import { safeProductUrl } from './wishlist.js';
import type { Currency } from './wishlist.js';

export type Merchant = 'shopee' | 'tokopedia' | 'ikea' | 'other';
export type ProductImport = {
  merchant: Merchant;
  hostname: string;
  originalUrl: string;
  name: string | null;
  status: 'name_available' | 'details_available' | 'manual_required';
  price?: { priceMinor: number; currency: Currency };
  imagePath?: string;
  canSaveImage?: boolean;
  tokopediaImageProof?: string;
  productUrl?: string;
  sellerName?: string;
  diagnostic?: { code: string; host: string; httpStatus?: number };
};

export function isIkeaMetadataLink(url: URL) {
  return url.origin === 'https://www.ikea.com' &&
    /^\/[a-z]{2}\/[a-z]{2}\/p\/[a-z0-9-]{1,150}-s?\d{8}\/?$/iu.test(url.pathname);
}

const shopee = new Set(['shopee.co.id', 'shopee.com', 'shopee.sg', 'shopee.com.my', 'shopee.co.th',
  'shopee.vn', 'shopee.ph', 'shopee.com.br', 'shope.ee', 's.shopee.co.id']);
const tokopedia = new Set(['tokopedia.com', 'tokopedia.link', 'tk.tokopedia.com', 'vt.tokopedia.com', 'shop-id.tokopedia.com']);
const redirect = /^(?:url|next|redirect|redirect_url|redirect_uri|continue|target|to|dest|destination|return_to)$/iu;
const destination = /^\s*(?:[a-z][a-z0-9+.-]*:|[/\\]{2})/iu;

export function safeImportUrl(value: string) {
  const url = safeProductUrl(value);
  if (!url) return null;
  const host = url.hostname.replace(/\.+$/u, '');
  if (!host.includes('.') || host.startsWith('[') || /^\d+(?:\.\d+){3}$/u.test(host) ||
      /(?:^|\.)(?:local|localdomain|localhost|internal|intranet|lan|corp|home|home\.arpa)$/iu.test(host)) return null;
  if ([...url.searchParams].some(([key, param]) => redirect.test(key) && destination.test(param))) return null;
  return url;
}

export function productMerchant(host: string): Merchant {
  const hostname = host.replace(/^www\./u, '').replace(/\.+$/u, '');
  if (shopee.has(hostname)) return 'shopee';
  if (tokopedia.has(hostname) || hostname.endsWith('.tokopedia.com')) return 'tokopedia';
  if (hostname === 'ikea.com' || hostname === 'ikea.co.id') return 'ikea';
  return 'other';
}
