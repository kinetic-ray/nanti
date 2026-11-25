import { safeImportUrl } from '../shared/product-import.js';
import { identifyProduct, isEligibleAffiliate } from './product-identity.js';
import { lookup } from 'node:dns/promises';
import { BlockList } from 'node:net';
import { isPublicIpv4 } from './tokopedia-metadata.js';

const publicIpv6 = new BlockList();
publicIpv6.addSubnet('2000::', 3, 'ipv6');
const specialIpv6 = new BlockList();
for (const [network, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  specialIpv6.addSubnet(network, prefix, 'ipv6');
}

export const destinationFields = {
  id: true, identityId: true, revision: true, affiliateUrl: true, originalUrl: true, classification: true,
  status: true, approvedAt: true, validatedAt: true, approvedBy: true, evidence: true, directReplacement: true,
} as const;

export function replacementUrl(value: string) {
  const url = safeImportUrl(value);
  return url?.protocol === 'https:' && !url.port ? url : null;
}

export function catalogUrl(value: string, merchant: string) {
  if ((merchant === 'IKEA' || merchant === 'Shopee') && identifyProduct(value)?.merchant === merchant) return value;
  const url = new URL(value);
  return merchant === 'Tokopedia' && url.hostname === 'www.tokopedia.com'
    ? url.origin + url.pathname
    : `${url.origin}/`;
}

export async function hasPublicDestination(url: URL) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), 3000); }),
    ]);
    return addresses.length > 0 && addresses.every(({ address, family }) => family === 4 ? isPublicIpv4(address) :
      publicIpv6.check(address, 'ipv6') && !specialIpv6.check(address, 'ipv6'));
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function effectiveMapping<T extends {
  status: string; identityId: string; originalUrl: string; affiliateUrl: string; directReplacement: boolean;
  classification: string; approvedAt: Date | null; validatedAt: Date | null; approvedBy: string | null; evidence: unknown;
}>(record: { id: string; canonicalUrl: string; activeMapping: T | null }, sourceUrl = record.canonicalUrl) {
  const row = record.activeMapping;
  if (!row || row.status !== 'approved' || row.identityId !== record.id || row.originalUrl !== record.canonicalUrl) return null;
  if (row.directReplacement) return replacementUrl(row.affiliateUrl) ? row : null;
  const evidence = row.evidence as { confirmedExact?: boolean; overrideReason?: string } | null;
  return row.classification === 'verified_exact' && row.approvedAt && row.validatedAt && row.approvedBy &&
    evidence?.confirmedExact === true && (isEligibleAffiliate(sourceUrl, row.affiliateUrl) ||
      Boolean(evidence.overrideReason)) ? row : null;
}
