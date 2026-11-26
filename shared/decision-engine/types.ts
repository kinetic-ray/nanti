export const decisionEngineVersion = '2.0.0' as const;

export const decisionOutcomes = [
  'not_needed',
  'can_wait',
  'worth_considering',
  'unclear_need',
] as const;

export type DecisionOutcome =
  typeof decisionOutcomes[number];

export type MotivationId =
  | 'replacement'
  | 'functional'
  | 'comfort_safety'
  | 'personal_satisfaction'
  | 'hobby_collection'
  | 'gift'
  | 'external_influence'
  | 'unclear';

export type EvidenceDimension =
  | 'need'
  | 'personal_value'
  | 'urgency'
  | 'impulse'
  | 'product_fit'
  | 'deferral';

export type ScoreDimension =
  | 'need'
  | 'personal_value'
  | 'urgency'
  | 'impulse'
  | 'product_fit'
  | 'evidence';

export type EvidenceWeight = 1 | 2 | 3 | 4 | 5;

export type MotivationSelection = {
  primary: MotivationId;
  secondary?: MotivationId;
};

export type Evidence = {
  flagId: string;
  dimension: EvidenceDimension;
  weight: number;
  effectiveWeight: number;
  sourceQuestionId: string;
  sourceOptionId: string;
  status: 'active' | 'reduced' | 'neutralized';
};

export type AnswerOption = {
  id: string;
  label: string;
  flagIds: readonly string[];
};

export type DecisionQuestion = {
  id: string;
  prompt: string;
  options: readonly AnswerOption[];
  clarification?: boolean;
};

export type DecisionAnswer = {
  questionId: string;
  optionId: string;
};

export type DecisionSession = {
  version: typeof decisionEngineVersion;
  motivation: MotivationSelection | null;
  answers: readonly DecisionAnswer[];
};

export type DecisionScores =
  Record<ScoreDimension, number | null>;

export type BehavioralAssessment = {
  version: typeof decisionEngineVersion;
  outcome: DecisionOutcome;
  scores: DecisionScores;
  evidence: readonly Evidence[];
  reasonIds: readonly string[];
  actionId: string;
  unresolvedConflict: boolean;
};

export const questionLimits = {
  minimum: 5,
  maximum: 8,
  clarificationAllowance: 1,
} as const;

export const secondaryMotivationMultiplier = 0.75;