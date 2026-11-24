export type PurchaseDestination = { originalUrl: string | null; affiliatePath: string | null };
export type MatchClassification = 'verified_exact' | 'potential' | 'mismatch' | 'insufficient';
export type SubmissionStatus = 'pending' | 'reviewed' | 'affiliate_link_assigned';
export type AffiliateStatus = 'pending' | 'approved' | 'rejected' | 'disabled' | 'revoked' | 'invalid';
export const variantFields = ['color', 'size', 'capacity', 'configuration', 'other'] as const;
export type VariantField = typeof variantFields[number];
export type VerificationEvidence = {
  title: string;
  brand?: string;
  model?: string;
  sellerId?: string;
  variants: Partial<Record<VariantField, string>>;
  notes: string;
  evidenceUrl?: string;
  confirmedExact: true;
};

export type Opportunity = {
  id: string; merchant: string; market: string; listingId: string; canonicalUrl: string;
  title: string | null; savedCount: number; coverage: boolean; classification: MatchClassification; reviewedAt: string | null;
  submissionStatus: SubmissionStatus;
};
export type Mapping = {
  id: string; originalUrl: string; affiliateUrl: string; status: AffiliateStatus; classification: MatchClassification;
  evidence: VerificationEvidence | null; approvedBy: string | null; approvedAt: string | null;
  validatedAt: string | null; createdAt: string; active: boolean; eligible: boolean; revision: number;
};
export type AuditEvent = { id: string; mappingId: string; actor: string; action: string; details: Record<string, unknown>; createdAt: string };
export type OpportunityDetail = Opportunity & {
  normalizedTitle: string | null; brand: string | null; model: string | null; sellerId: string | null;
  variants: VerificationEvidence['variants'] | null;
  mappings: Mapping[]; audit: AuditEvent[]; nextMappings: string | null; nextAudit: string | null;
};
export type NoticeKind = 'new_opportunity' | 'candidate_review' | 'mapping_revoked' | 'mapping_invalid' | 'new_user' | 'system_failure';
export type AdminNotice = {
  id: string; identityId: string | null; kind: NoticeKind; listingId: string | null; title: string | null; targetPath: string;
  readAt: string | null; createdAt: string;
};
export type AdminPage<T> = { records: T[]; next: string | null };
