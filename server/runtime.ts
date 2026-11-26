import { isIP } from 'node:net';
import { z } from 'zod';
import { adminHashPattern, adminUsernamePattern } from './admin-credentials.js';
import { createApp } from './app.js';
import { connectDatabase } from './database.js';
import { assessmentRetentionDays } from './intelligence.js';
import { configureOAuth } from './oauth-providers.js';
import { prismaAccounts } from './prisma-accounts.js';
import { prismaAffiliate } from './prisma-affiliate.js';
import { prismaIntelligence } from './prisma-intelligence.js';
import { prismaPrices } from './prisma-prices.js';
import { prismaWishlists } from './prisma-wishlists.js';
import { createProductMedia } from './product-media.js';
import { createImageStorage } from './image-storage.js';
import { createMysqlImageStorage } from './mysql-image-storage.js';
import { previewProduct, previewProductMetadata } from './product-preview.js';
import { productMerchant } from '../shared/product-import.js';
import { prismaFinancialProfiles } from './financial-profile.js';

const runtimeConfig = z.object({
  DATABASE_URL: z.string().startsWith('mysql://'),
  DATABASE_CA_CERT_BASE64: z.string().optional(),
  SESSION_SECRET: z.string().min(32),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NANTI_TRUST_PROXY: z.string().refine(value => !value || isIP(value) !== 0).default(''),
  NANTI_IKEA_METADATA_PERMISSION: z.enum(['', 'granted']).default(''),
  NANTI_IKEA_PRICE_METADATA_PERMISSION: z.enum(['', 'granted']).default(''),
  NANTI_SHOPEE_PRICE_METADATA_PERMISSION: z.enum(['', 'granted']).default(''),
  NANTI_ADMIN_USERNAME: z.string().regex(adminUsernamePattern).or(z.literal('')).default(''),
  NANTI_ADMIN_PASSWORD_HASH: z.string().regex(adminHashPattern).or(z.literal('')).default(''),
  NANTI_RECOMMENDATION_SUPERADMIN_USERNAME: z.string().regex(adminUsernamePattern).or(z.literal('')).default(''),
}).refine((value) => Boolean(value.NANTI_ADMIN_USERNAME) === Boolean(value.NANTI_ADMIN_PASSWORD_HASH), {
  path: ['NANTI_ADMIN_PASSWORD_HASH'], message: 'Set both administrator variables or leave both empty.',
});
const poolLimit = z.coerce.number().int().min(2).max(10).default(3);
const cronSecret = z.string().regex(/^[A-Za-z0-9_-]{16,}$/u);

export function marketplacePriceAllowed(merchant: string, permissions: Pick<NodeJS.ProcessEnv,
  'NANTI_IKEA_PRICE_METADATA_PERMISSION' | 'NANTI_SHOPEE_PRICE_METADATA_PERMISSION'>): boolean {
  return merchant === 'tokopedia' || (merchant === 'ikea' && permissions.NANTI_IKEA_PRICE_METADATA_PERMISSION === 'granted') ||
    (merchant === 'shopee' && permissions.NANTI_SHOPEE_PRICE_METADATA_PERMISSION === 'granted');
}

export async function createRuntime(environment: NodeJS.ProcessEnv, options: { vercel?: boolean; webRoot?: string }) {
  const config = runtimeConfig.safeParse(environment);
  if (!config.success) {
    throw new Error(`Invalid configuration: ${config.error.issues.map(({ path }) => path.join('.')).join(', ')}`);
  }
  const env = config.data;
  const production = options.vercel || env.NODE_ENV === 'production';
  const limit = poolLimit.safeParse(environment.DATABASE_POOL_LIMIT || undefined);
  if (options.vercel && !limit.success) throw new Error('Invalid configuration: DATABASE_POOL_LIMIT');
  const cron = environment.CRON_SECRET || undefined;
  if (options.vercel && cron && !cronSecret.safeParse(cron).success) throw new Error('Invalid configuration: CRON_SECRET');
  const providers = await configureOAuth(environment, production).catch(() => {
    throw new Error('Invalid consumer OAuth configuration. Check AUTH_* variables and the authentication setup guide.');
  });
  let db: ReturnType<typeof connectDatabase>;
  try {
    db = connectDatabase(env.DATABASE_URL, { caBase64: env.DATABASE_CA_CERT_BASE64,
      serverlessPoolLimit: options.vercel ? limit.data : undefined });
  } catch {
    throw new Error('Invalid database configuration. Check DATABASE_URL and DATABASE_CA_CERT_BASE64.');
  }
  const checkDatabase = async () => {
    // Keep schema checks isolated so a missing column can be attributed to its model.
    // Never log query arguments, database URLs, or driver error messages.
    const checks = [
      ['DataOwner', () => db.dataOwner.findFirst({ select: { id: true } })],
      ['Item', () => db.item.findFirst({ select: { id: true, imageKey: true, sellerName: true } })],
      ['ProductImage', () => db.productImage.findFirst({ select: { id: true } })],
      ['AuthIdentity', () => db.authIdentity.findFirst({ select: { avatarUrl: true } })],
      ['FinancialProfile', () => db.financialProfile.findFirst({ select: { userId: true } })],
      ['CreatorProfile', () => db.creatorProfile.findFirst({ select: { handle: true, publishedDesign: true } })],
      ['CreatorProduct', () => db.creatorProduct.findFirst({ select: { id: true, hasPhoto: true } })],
      ['PriceObservation', () => db.priceObservation.findFirst({ select: { id: true } })],
      ['PriceTarget', () => db.priceTarget.findFirst({ select: { itemId: true } })],
      ['PriceAlert', () => db.priceAlert.findFirst({ select: { id: true } })],
    ] as const;
    for (const [model, check] of checks) {
      try {
        await check();
      } catch (error) {
        console.error('Database schema check failed', { model });
        throw error;
      }
    }
  };
  const intelligence = prismaIntelligence(db);
  const accounts = prismaAccounts(db);
  const financialProfiles = prismaFinancialProfiles(db);
  const mysqlImages = createMysqlImageStorage(db);
  const prune = () => Promise.allSettled([
    intelligence.prune(new Date(Date.now() - assessmentRetentionDays * 86_400_000)),
    accounts.prune(),
    mysqlImages.prune(),
  ]).then((results) => {
    if (results[0]?.status === 'rejected') console.error('Could not clear expired assessment data.');
    if (results[1]?.status === 'rejected') console.error('Could not clear expired account data.');
    if (results[2]?.status === 'rejected') console.error('Could not clear expired product image uploads.');
    if (results.some(({ status }) => status === 'rejected')) throw new Error('Retention cleanup failed.');
  });
  const ikeaMetadataAllowed = env.NANTI_IKEA_METADATA_PERMISSION === 'granted';

  const app = createApp({
    repository: prismaWishlists(db),
    intelligence,
    prices: prismaPrices(db),
    recommendationsDb: db,
    recommendationSuperadminEnabled: Boolean(env.NANTI_RECOMMENDATION_SUPERADMIN_USERNAME &&
      env.NANTI_RECOMMENDATION_SUPERADMIN_USERNAME === env.NANTI_ADMIN_USERNAME),
    affiliate: prismaAffiliate(db),
    consumer: { accounts, providers, financialProfiles },
    admin: env.NANTI_ADMIN_USERNAME && env.NANTI_ADMIN_PASSWORD_HASH ? {
      username: env.NANTI_ADMIN_USERNAME, passwordHash: env.NANTI_ADMIN_PASSWORD_HASH,
    } : undefined,
    // Marketplace previews use their own strict domain allowlist; IKEA remains opt-in.
    preview: async (url) => (ikeaMetadataAllowed || ['shopee', 'tokopedia'].includes(productMerchant(url.hostname)))
      ? previewProduct(url) : null,
    lookupMetadata: async (url, request, onDiagnostic) => {
      const merchant = productMerchant(url.hostname);
      if (!ikeaMetadataAllowed && merchant !== 'shopee' && merchant !== 'tokopedia') return null;
      const metadata = await previewProductMetadata(url, request, onDiagnostic);
      return metadata && { ...metadata, price: marketplacePriceAllowed(merchant, env) ? metadata.price : null };
    },
    productMedia: ikeaMetadataAllowed ? createProductMedia() : undefined,
    imageStorage: createImageStorage(environment),
    mysqlImages,
    secret: env.SESSION_SECRET,
    secureCookies: production || environment.AUTH_PUBLIC_ORIGIN?.startsWith('https://') === true,
    trustedProxy: options.vercel ? 1 : env.NANTI_TRUST_PROXY,
    checkDatabase,
    webRoot: options.webRoot,
    retention: options.vercel && cron ? { secret: cron, prune } : undefined,
  });
  return { app, db, checkDatabase, prune };
}
