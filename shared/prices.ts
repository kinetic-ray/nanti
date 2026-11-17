import type { Currency } from './wishlist.js';

export const priceSources = ['existing', 'manual', 'imported_unverified', 'marketplace_verified'] as const;
export const userPriceSources = ['manual', 'imported_unverified'] as const;
export type PriceSource = typeof priceSources[number];
export type UserPriceSource = typeof userPriceSources[number];

export type PriceObservation = {
  id: string;
  priceMinor: number;
  currency: Currency;
  source: PriceSource;
  observedAt: string;
};

export type PriceTarget = { priceMinor: number; notify: boolean; lastReachedAt: string | null };
export type ItemPrices = {
  currency: Currency;
  currentMinor: number | null;
  previousMinor: number | null;
  lowestMinor: number | null;
  highestMinor: number | null;
  lastVerifiedAt: string | null;
  observations: PriceObservation[];
  next: string | null;
  target: PriceTarget | null;
};

export type PriceAlert = {
  id: string;
  itemName: string;
  itemId: string;
  wishlistId: string;
  targetMinor: number;
  readAt: string | null;
  observation: PriceObservation;
};

export type PriceInbox = { alerts: PriceAlert[]; unread: number };
