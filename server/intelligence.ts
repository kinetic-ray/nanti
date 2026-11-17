import type { AssessmentKind, AssessmentPage, Preferences, SavedAssessment, SavedPayload } from '../shared/intelligence.js';
import type { Item } from '../shared/wishlist.js';

export type AssessmentScope = { ownerId: string; wishlistId: string; itemId: string | null; kind: AssessmentKind };
export type HistoryCursor = { createdAt: Date; id: string };

export interface IntelligenceRepository {
  history(scope: AssessmentScope, before?: HistoryCursor): Promise<AssessmentPage>;
  save(scope: AssessmentScope, payload: SavedPayload): Promise<SavedAssessment | null>;
  remove(scope: AssessmentScope, id: string): Promise<boolean>;
  preferences(ownerId: string): Promise<Preferences>;
  setPreferences(ownerId: string, preferences: Preferences): Promise<void>;
}

export function getPurchaseCost(items: Item[]) {
  let known = 0n;
  let complete = items.length > 0;
  for (const { priceMinor, quantity } of items) {
    if (priceMinor === null) complete = false;
    else known += BigInt(priceMinor) * BigInt(quantity);
  }
  return { known, complete };
}
