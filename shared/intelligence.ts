import type { BuyingAnswers, ImpulseAnswers, ImpulseResult } from './impulse.js';
import type { ScreeningAnswers, ScreeningResult } from './screening.js';
import type { ComparisonInput, ComparisonResult } from './value-ranker.js';
import type { PriorityInput, PriorityResult } from './priorities.js';
import type { QuickTimingInput, QuickTimingResult } from './quick-timing.js';
import type { PurchasePlan, PurchaseQuote } from './purchase-plan.js';
import type { TimingInput, TimingResult } from './purchase-timing.js';
import type { Currency } from './wishlist.js';
import type { PurchaseFinanceContext } from './purchase-impact.js';

export type ProductSnapshot = { id: string; name: string; priceMinor: number | null; quantity: number; currency?: Currency };
export type AssessmentSnapshot = { version: 1; products: ProductSnapshot[] };
export type ReviewChange =
  | { kind: 'legacy' | 'methodology' | 'selection' | 'preference' }
  | { kind: 'price' | 'quantity'; id: string; name: string; before: number | null; after: number | null; currency?: Currency }
  | { kind: 'financial'; field: keyof TimingInput }
  | { kind: 'planning'; field: 'purchaseMinor' | 'extraMinor' | 'targetDate'; before: string | null; after: string | null };

export type TimingPlanInput = TimingInput & { plan?: PurchasePlan; reviewId?: string; confirmedCurrent?: boolean; previewToken?: string };
export type SavedTimingInput = Pick<TimingInput, 'purchaseMinor' | 'extraMinor' | 'targetDate'> & { plan?: PurchasePlan };
export type TimingSummary = Pick<TimingResult, 'version' | 'asOf' | 'status' | 'target' | 'missing' | 'totalMinor' | 'months'> & {
  quote: PurchaseQuote;
};
export type TimingPreview = TimingResult & { quote: PurchaseQuote; review?: ReviewChange[]; snapshot: AssessmentSnapshot; previewToken: string };

export type PriorityAssessment = { kind: 'comparison'; input: PriorityInput; result: PriorityResult };
export type LegacyComparison = { kind: 'comparison'; input: ComparisonInput; result: ComparisonResult };
export type QuickTimingAssessment = { kind: 'timing'; input: QuickTimingInput; result: QuickTimingResult };
export type DetailedTimingAssessment = { kind: 'timing'; input: SavedTimingInput; result: TimingSummary };
export type SavedPayload =
  | { kind: 'impulse'; input: ImpulseAnswers | BuyingAnswers | ScreeningAnswers; result: ImpulseResult | ScreeningResult }
  | LegacyComparison | PriorityAssessment | DetailedTimingAssessment | QuickTimingAssessment;

export type SavedAssessment = SavedPayload & {
  id: string; createdAt: string; version: string; snapshot?: AssessmentSnapshot | null; review?: ReviewChange[];
};
export type AssessmentKind = SavedPayload['kind'];
export type AssessmentPage = { records: SavedAssessment[]; next: string | null };
export type Preferences = { coolingOffDays: number | null };
export type SavedPurchaseFinanceContext = { context: PurchaseFinanceContext; updatedAt: string };

export function isPriority<T extends SavedPayload>(record: T): record is T & PriorityAssessment {
  return record.kind === 'comparison' && 'mode' in record.input;
}

export function isQuickTiming<T extends SavedPayload>(record: T): record is T & QuickTimingAssessment {
  return record.kind === 'timing' && 'mode' in record.input;
}
