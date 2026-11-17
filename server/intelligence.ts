import type { AssessmentKind, AssessmentPage, AssessmentSnapshot, Preferences, SavedAssessment, SavedPayload } from '../shared/intelligence.js';

export type AssessmentScope = { ownerId: string; wishlistId: string; itemId: string | null; kind: AssessmentKind };
export type HistoryCursor = { createdAt: Date; id: string };
export type SaveIntent = { key: string; hash: string };
export type FinancialFingerprints = Record<string, string>;
export type StoredAssessment = { record: SavedAssessment; financial: FinancialFingerprints | null; requestHash: string | null };
export const assessmentRetentionDays = 365;

export interface IntelligenceRepository {
  history(scope: AssessmentScope, before?: HistoryCursor): Promise<AssessmentPage>;
  save(scope: AssessmentScope, payload: SavedPayload, snapshot: AssessmentSnapshot,
    financial?: FinancialFingerprints, intent?: SaveIntent): Promise<SavedAssessment | null>;
  find(scope: AssessmentScope, id: string): Promise<StoredAssessment | null>;
  findRequest(ownerId: string, key: string): Promise<(StoredAssessment & AssessmentScope) | null>;
  remove(scope: AssessmentScope, id: string): Promise<boolean>;
  preferences(ownerId: string): Promise<Preferences>;
  setPreferences(ownerId: string, preferences: Preferences): Promise<void>;
  clear(ownerId: string): Promise<void>;
  prune(before: Date): Promise<void>;
}

export class SaveIntentConflict extends Error {}
