import type { CreatorDesign } from './creator-design.js';
import type { Currency } from './wishlist.js';

export type CreatorProductInput = {
  title: string;
  url: string;
  description: string;
  category: string;
  priceMinor?: number | null;
  currency?: Currency | null;
};

export type StorefrontProduct = CreatorProductInput & { id: string; image: string | null };
export type CatalogProduct = StorefrontProduct & { published: boolean };
export type CreatorCatalog = {
  name: string;
  handle: string;
  publishedDesign: CreatorDesign | null;
  products: CatalogProduct[];
};
export type PublicStorefront = {
  name: string;
  design: CreatorDesign;
  products: StorefrontProduct[];
};
