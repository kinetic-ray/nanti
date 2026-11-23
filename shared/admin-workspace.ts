import type { Currency } from './wishlist.js';

export type PlatformSummary = { users: number; creators: number; products: number; liveStorefronts: number };
export type PlatformProduct = {
  id: string; title: string; url: string; published: boolean; image: string | null;
  priceMinor: number | null; currency: Currency | null; creator: string;
};
export type PlatformUser = { id: string; displayName: string | null; role: 'admin' | 'member'; creator: string | null; createdAt: string };
export type PlatformStorefront = { id: string; name: string; handle: string; published: boolean; products: number };
export type PlatformCreator = { id: string; name: string; user: string | null; products: number; createdAt: string };
export type PlatformAudit = {
  affiliate: { id: string; actor: string; action: string; title: string; createdAt: string }[];
  workspace: { id: string; actor: string; action: string; subject: string; reason: string; createdAt: string }[];
};
export type PlatformPage<Row> = { records: Row[]; page: number; pages: number; total: number };
export type PlatformSettingsStatus = {
  environment: 'production' | 'non-production';
  checks: {
    databaseConfigured: boolean;
    administratorLoginConfigured: boolean;
    googleSignInConfigured: boolean;
    appleSignInConfigured: boolean;
    accountRecoveryConfigured: boolean;
    imageStorageConfigured: boolean;
    recommendationManagementEnabled: boolean;
  };
};
