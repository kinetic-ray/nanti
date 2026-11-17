import type { ImpulseAnswers, ImpulseResult } from './impulse.js';
import type { ComparisonInput, ComparisonResult } from './value-ranker.js';
import type { PurchasePlan, PurchaseQuote } from './purchase-plan.js';
import type { TimingInput, TimingResult } from './purchase-timing.js';

export type ProductSnapshot = { id: string; name: string; priceMinor: number | null; quantity: number };
export type AssessmentSnapshot = { version: 1; products: ProductSnapshot[] };
export type ReviewChange =
  | { kind: 'legacy' | 'methodology' | 'selection' | 'preference' }
  | { kind: 'price' | 'quantity'; id: string; name: string; before: number | null; after: number | null }
  | { kind: 'financial'; field: keyof TimingInput }
  | { kind: 'planning'; field: 'purchaseMinor' | 'extraMinor' | 'targetDate'; before: string | null; after: string | null };

export type TimingPlanInput = TimingInput & { plan?: PurchasePlan; reviewId?: string; confirmedCurrent?: boolean; previewToken?: string };
export type SavedTimingInput = Pick<TimingInput, 'purchaseMinor' | 'extraMinor' | 'targetDate'> & { plan?: PurchasePlan };
export type TimingSummary = Pick<TimingResult, 'version' | 'asOf' | 'status' | 'target' | 'missing' | 'totalMinor' | 'months'> & {
  quote: PurchaseQuote;
};
export type TimingPreview = TimingResult & { quote: PurchaseQuote; review?: ReviewChange[]; snapshot: AssessmentSnapshot; previewToken: string };

export type SavedPayload =
  | { kind: 'impulse'; input: ImpulseAnswers; result: ImpulseResult }
  | { kind: 'comparison'; input: ComparisonInput; result: ComparisonResult }
  | { kind: 'timing'; input: SavedTimingInput; result: TimingSummary };

export type SavedAssessment = SavedPayload & {
  id: string; createdAt: string; version: string; snapshot?: AssessmentSnapshot | null; review?: ReviewChange[];
};
export type AssessmentKind = SavedPayload['kind'];
export type AssessmentPage = { records: SavedAssessment[]; next: string | null };
export type Preferences = { coolingOffDays: number | null };
