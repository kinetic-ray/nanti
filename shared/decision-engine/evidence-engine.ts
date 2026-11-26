import {
  secondaryMotivationMultiplier,
  type DecisionSession,
  type Evidence,
} from './types.js';

import {
  flagRegistry,
  isFlagId,
  type FlagId,
} from './flag-registry.js';

import {
  motivationRegistry,
  isValidMotivationSelection,
} from './motivation-registry.js';

import {
  isQuestionId,
  getAnswerOption,
} from './question-registry.js';

export function getAnswer(
  session: DecisionSession,
  questionId: string,
): string | undefined {
  return session.answers.find(
    answer => answer.questionId === questionId,
  )?.optionId;
}

function createEvidence(
  flagId: FlagId,
  questionId: string,
  optionId: string,
  multiplier = 1,
): Evidence {
  const definition = flagRegistry[flagId];

  return {
    flagId,
    dimension: definition.dimension,
    weight: definition.weight,
    effectiveWeight: definition.weight * multiplier,
    sourceQuestionId: questionId,
    sourceOptionId: optionId,
    status: multiplier === 1 ? 'active' : 'reduced',
  };
}

export function collectEvidence(
  session: DecisionSession,
): Evidence[] {
  const evidence: Evidence[] = [];

  if (
    session.motivation &&
    isValidMotivationSelection(session.motivation)
  ) {
    const { primary, secondary } = session.motivation;

    for (const flag of motivationRegistry[primary].initialFlags) {
      evidence.push(
        createEvidence(flag, 'motivation', primary),
      );
    }

    if (secondary) {
      for (const flag of motivationRegistry[secondary].initialFlags) {
        evidence.push(
          createEvidence(
            flag,
            'motivation',
            secondary,
            secondaryMotivationMultiplier,
          ),
        );
      }
    }
  }

  const seenQuestions = new Set<string>();

  for (const answer of session.answers) {
    if (seenQuestions.has(answer.questionId)) continue;
    if (!isQuestionId(answer.questionId)) continue;

    const option = getAnswerOption(
      answer.questionId,
      answer.optionId,
    );

    if (!option) continue;

    seenQuestions.add(answer.questionId);

    for (const flagId of option.flagIds) {
      if (!isFlagId(flagId)) continue;

      evidence.push(
        createEvidence(
          flagId,
          answer.questionId,
          answer.optionId,
        ),
      );
    }
  }

  const comfort = getAnswer(session, 'comfort_safety');
  const impact = getAnswer(session, 'impact');
  const frequency = getAnswer(session, 'problem_frequency');
  const usage = getAnswer(session, 'usage_frequency');

  if (
    (comfort === 'discomfort' ||
      getAnswer(session, 'condition') === 'uncomfortable') &&
    frequency === 'daily'
  ) {
    evidence.push(
      createEvidence(
        'daily_discomfort',
        'problem_frequency',
        'daily',
      ),
    );
  }

  if (
    (comfort === 'discomfort' ||
      getAnswer(session, 'condition') === 'uncomfortable') &&
    frequency === 'weekly'
  ) {
    evidence.push(
      createEvidence(
        'recurring_discomfort',
        'problem_frequency',
        'weekly',
      ),
    );
  }

  if (
    (comfort === 'comfort' ||
      comfort === 'both' ||
      impact === 'comfort' ||
      getAnswer(session, 'additional_benefit') === 'comfort') &&
    usage === 'daily'
  ) {
    evidence.push(
      createEvidence(
        'daily_comfort',
        'usage_frequency',
        'daily',
      ),
    );
  }

  return evidence;
}

function neutralize(evidence: Evidence): Evidence {
  return {
    ...evidence,
    effectiveWeight: 0,
    status: 'neutralized',
  };
}

function reduce(
  evidence: Evidence,
  multiplier: number,
): Evidence {
  return {
    ...evidence,
    effectiveWeight: evidence.effectiveWeight * multiplier,
    status: 'reduced',
  };
}

export function applyEvidenceRules(
  session: DecisionSession,
  evidence: readonly Evidence[],
): Evidence[] {
  const longTermDesire =
    getAnswer(session, 'desire_duration') === 'long_term';

  const condition = getAnswer(session, 'condition');
  const safetyDetail = getAnswer(session, 'safety_detail');
  const delay = getAnswer(session, 'delay_consequence');
  const impact = getAnswer(session, 'impact');

  const confirmedFunctionalBenefit = evidence.some(
    item =>
      item.dimension === 'need' &&
      item.sourceQuestionId !== 'motivation' &&
      item.effectiveWeight >= 4 &&
      item.flagId !== 'safety_concern',
  );

  const confirmedSafety =
    safetyDetail === 'experienced' ||
    safetyDetail === 'potential';

  return evidence.map(item => {
    if (item.flagId === 'first_ownership') {
      return neutralize(item);
    }

    if (longTermDesire && item.dimension === 'impulse') {
      return neutralize(item);
    }

    if (
      item.flagId === 'replacement_needed' &&
      condition === 'good'
    ) {
      return neutralize(item);
    }

    if (
      item.flagId === 'safety_concern' &&
      safetyDetail === 'unknown'
    ) {
      return reduce(item, 0.5);
    }

    if (
      item.flagId === 'social_influence' &&
      (confirmedFunctionalBenefit || confirmedSafety)
    ) {
      return reduce(item, 0.5);
    }

    if (
      item.flagId === 'spontaneous_desire' &&
      confirmedFunctionalBenefit
    ) {
      return reduce(item, 0.5);
    }

    if (
      item.flagId === 'activity_disruption' &&
      delay === 'none'
    ) {
      return reduce(item, 0.5);
    }

    if (
      item.flagId === 'functional_need' &&
      impact === 'unknown'
    ) {
      return reduce(item, 0.5);
    }

    return { ...item };
  });
}

export function buildEvidence(
  session: DecisionSession,
): Evidence[] {
  return applyEvidenceRules(
    session,
    collectEvidence(session),
  );
}

export function strongestEvidence(
  evidence: readonly Evidence[],
): Evidence[] {
  const unique = new Map<string, Evidence>();

  for (const item of evidence) {
    const existing = unique.get(item.flagId);

    if (
      !existing ||
      item.effectiveWeight > existing.effectiveWeight
    ) {
      unique.set(item.flagId, item);
    }
  }

  return [...unique.values()].sort(
    (a, b) => b.effectiveWeight - a.effectiveWeight,
  );
}

export function hasActiveFlag(
  evidence: readonly Evidence[],
  flagId: FlagId,
): boolean {
  return evidence.some(
    item =>
      item.flagId === flagId &&
      item.effectiveWeight > 0,
  );
}