import type { Currency } from './wishlist.js';

export type RecommendationStatus = 'draft' | 'active' | 'archived';
export type RecommendationAction = 'publish' | 'unpublish' | 'archive' | 'restore';

export type RecommendationCuration = {
  title: string;
  category: string;
  color: string | null;
  style: string | null;
  useCase: string | null;
  description: string | null;
};

export type RecommendationImport = {
  originalUrl: string;
  listingUrl: string;
  title: string | null;
  image: string | null;
  price: { priceMinor: number; currency: Currency } | null;
};

export type RecommendationPreview = { metadata: RecommendationImport; proof: string };

export type RecommendationWorkspaceProduct = RecommendationCuration & {
  id: string;
  url: string;
  importedTitle: string | null;
  image: string | null;
  price: RecommendationImport['price'];
  marketplace: string | null;
  status: RecommendationStatus;
};
