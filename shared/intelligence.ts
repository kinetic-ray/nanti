import type { ImpulseAnswers, ImpulseResult } from './impulse.js';
import type { ComparisonInput, ComparisonResult } from './value-ranker.js';

export type SavedPayload =
  | { kind: 'impulse'; input: ImpulseAnswers; result: ImpulseResult }
  | { kind: 'comparison'; input: ComparisonInput; result: ComparisonResult };

export type SavedAssessment = SavedPayload & { id: string; createdAt: string; version: string };
export type AssessmentKind = SavedPayload['kind'];
export type AssessmentPage = { records: SavedAssessment[]; next: string | null };
export type Preferences = { coolingOffDays: number | null };
