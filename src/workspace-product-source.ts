import { productMerchant, safeImportUrl } from '../shared/product-import.js';

export const productSources = { shopee: 'Shopee', tokopedia: 'Tokopedia', ikea: 'IKEA', other: 'Lainnya' } as const;

export function productSource(url: string) {
  const link = safeImportUrl(url);
  return link ? productMerchant(link.hostname) : 'other';
}
