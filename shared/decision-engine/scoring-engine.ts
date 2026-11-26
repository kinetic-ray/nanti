import type {
  DecisionSession,
  DecisionScores,
  Evidence,
  EvidenceDimension,
} from './types.js';

import {
  flagRegistry,
  isFlagId,
} from './flag-registry.js';

import {
  buildEvidence,
  strongestEvidence,
  getAnswer,
} from './evidence-engine.js';

import {
  isQuestionId,
  getAnswerOption,
} from './question-registry.js';

export type EvidenceGroupScore = {
  dimension: EvidenceDimension;
  group: string;
  score: number;
  flagIds: readonly string[];
};

export function roundScore(value: number): number {
  return Math.round(
    Math.max(0, Math.min(5, value)) * 100,
  ) / 100;
}

export function scoreEvidenceGroups(
  evidence: readonly Evidence[],
): EvidenceGroupScore[] {
  const groups = new Map<string, Evidence[]>();

  for (const item of strongestEvidence(evidence)) {
    if (!isFlagId(item.flagId)) continue;
    if (item.effectiveWeight <= 0) continue;

    const definition = flagRegistry[item.flagId];
    const key = `${definition.dimension}:${definition.group}`;

    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const results: EvidenceGroupScore[] = [];

  for (const group of groups.values()) {
    const strongest = group[0];

    if (!strongest || !isFlagId(strongest.flagId)) {
      continue;
    }

    const definition = flagRegistry[strongest.flagId];

    const independentSources = new Set(
      group
        .filter(item => item.sourceQuestionId !== 'motivation')
        .map(item => item.sourceQuestionId),
    );

    independentSources.delete(strongest.sourceQuestionId);

    const confirmations = Math.min(
      2,
      independentSources.size,
    );

    const score = roundScore(
      strongest.effectiveWeight + confirmations * 0.25,
    );

    results.push({
      dimension: definition.dimension,
      group: definition.group,
      score,
      flagIds: group.map(item => item.flagId),
    });
  }

  return results;
}

function dimensionScore(
  groups: readonly EvidenceGroupScore[],
  dimension: EvidenceDimension,
): number | null {
  const matching = groups.filter(
    group => group.dimension === dimension,
  );

  return matching.length
    ? Math.max(...matching.map(group => group.score))
    : null;
}

export function detectConflicts(
  session: DecisionSession,
): string[] {
  const conflicts: string[] = [];

  const impact = getAnswer(session, 'impact');
  const delay = getAnswer(session, 'delay_consequence');
  const ownership = getAnswer(session, 'ownership');
  const condition = getAnswer(session, 'condition');
  const timing = getAnswer(session, 'need_timing');

  if (
    impact === 'disruption' &&
    delay === 'none'
  ) {
    conflicts.push('impact_delay_conflict');
  }

  if (
    ownership === 'adequate' &&
    (condition === 'broken' || condition === 'unsafe')
  ) {
    conflicts.push('ownership_condition_conflict');
  }

  if (
    timing === 'future' &&
    delay === 'serious'
  ) {
    conflicts.push('timing_delay_conflict');
  }

  if (
    getAnswer(session, 'safety_detail') === 'unknown'
  ) {
    conflicts.push('safety_unconfirmed');
  }

  return conflicts;
}

function evidenceSufficiency(
  session: DecisionSession,
): number | null {
  if (!session.motivation) return null;

  const validAnswers = session.answers.filter(
    answer =>
      isQuestionId(answer.questionId) &&
      !!getAnswerOption(answer.questionId, answer.optionId),
  );

  const answers = new Map(
    validAnswers.map(answer => [
      answer.questionId,
      answer.optionId,
    ]),
  );

  const known = (id: string): boolean => {
    const answer = answers.get(id);
    return answer !== undefined && answer !== 'unknown';
  };

  const primary =
    session.motivation.primary === 'unclear' &&
    session.motivation.secondary
      ? session.motivation.secondary
      : session.motivation.primary;

  const relevantDomains: readonly (readonly string[])[] =
    primary === 'hobby_collection'
      ? [
          ['hobby_activity'],
          ['hobby_experience'],
          ['desire_duration'],
          ['product_fit'],
        ]
      : primary === 'gift'
        ? [
            ['gift_fit'],
            ['gift_timing'],
            ['product_fit'],
          ]
        : primary === 'personal_satisfaction'
          ? [
              ['personal_value'],
              ['desire_duration'],
              ['ownership'],
              ['product_fit'],
            ]
          : primary === 'external_influence'
            ? [
                ['external_trigger'],
                ['impact', 'personal_value'],
                ['desire_duration'],
                ['product_fit'],
              ]
            : [
                ['impact', 'condition', 'comfort_safety'],
                ['ownership', 'alternatives'],
                ['need_timing', 'delay_consequence'],
                ['product_fit'],
              ];

  const completed = relevantDomains.filter(
    domain => domain.some(known),
  ).length;

  const conflicts = detectConflicts(session).length;

  return roundScore(
    (completed / relevantDomains.length) * 5 -
      conflicts * 0.75,
  );
}

export function calculateScores(
  session: DecisionSession,
  evidence: readonly Evidence[] = buildEvidence(session),
): DecisionScores {
  const groups = scoreEvidenceGroups(evidence);

  const scores: DecisionScores = {
    need: dimensionScore(groups, 'need'),
    personal_value: dimensionScore(groups, 'personal_value'),
    urgency: dimensionScore(groups, 'urgency'),
    impulse: dimensionScore(groups, 'impulse'),
    product_fit: dimensionScore(groups, 'product_fit'),
    evidence: evidenceSufficiency(session),
  };

  if (
    getAnswer(session, 'desire_duration') === 'long_term'
  ) {
    scores.impulse = 0;
  }

  if (
    scores.urgency === null &&
    (
      getAnswer(session, 'need_timing') === 'future' ||
      getAnswer(session, 'need_timing') === 'flexible' ||
      getAnswer(session, 'delay_consequence') === 'none'
    )
  ) {
    scores.urgency = 0;
  }

  if (
    getAnswer(session, 'product_fit') === 'mismatch'
  ) {
    scores.product_fit = 0;
  }

  if (
    getAnswer(session, 'product_fit') === 'excessive'
  ) {
    scores.product_fit = 3;
  }

  return scores;
}

export function scoreBand(
  score: number | null,
): 'unknown' | 'weak' | 'limited' | 'moderate' | 'strong' {
  if (score === null) return 'unknown';
  if (score < 1.5) return 'weak';
  if (score < 3) return 'limited';
  if (score < 4) return 'moderate';
  return 'strong';
}