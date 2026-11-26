import type {
  DecisionSession,
  Evidence,
} from './types.js';

import {
  buildEvidence,
  getAnswer,
} from './evidence-engine.js';

import {
  flagRegistry,
  isFlagId,
} from './flag-registry.js';

import {
  detectConflicts,
} from './scoring-engine.js';

import {
  getClarificationQuestion,
} from './branching-engine.js';

export type ReconciledEvidence = {
  session: DecisionSession;
  evidence: Evidence[];
  unresolvedConflicts: string[];
};

export function reconcileEvidence(
  session: DecisionSession,
): ReconciledEvidence {
  const answers = session.answers.map(answer => ({ ...answer }));
  const unresolvedConflicts: string[] = [];

  const replace = (questionId: string, optionId: string) => {
    const index = answers.findIndex(
      answer => answer.questionId === questionId,
    );

    if (index >= 0) {
      answers[index] = { questionId, optionId };
    } else {
      answers.push({ questionId, optionId });
    }
  };

  const suppressed = new Set<string>();

  for (const conflict of detectConflicts(session)) {
    const question = getClarificationQuestion(conflict);
    const answer = getAnswer(session, question.id);

    if (!answer || answer === 'unknown') {
      unresolvedConflicts.push(conflict);
      continue;
    }

    switch (conflict) {
      case 'impact_delay_conflict':
        if (answer === 'important') {
          replace('delay_consequence', 'serious');
        } else if (answer === 'optional') {
          replace('impact', 'functional');
          replace('delay_consequence', 'none');
          suppressed.add('activity_disruption');
        }
        break;

      case 'ownership_condition_conflict':
        if (answer === 'adequate') {
          replace('ownership', 'adequate');
          replace('condition', 'good');
          suppressed.add('replacement_needed');
          suppressed.add('replacement_confirmed');
          suppressed.add('safety_concern');
          suppressed.add('safety_confirmed');
        } else if (answer === 'insufficient') {
          replace('ownership', 'insufficient');
        }
        break;

      case 'timing_delay_conflict':
        if (answer === 'now') {
          replace('need_timing', 'now');
        } else if (answer === 'future') {
          replace('need_timing', 'future');
          replace('delay_consequence', 'minor');
          suppressed.add('immediate_need');
          suppressed.add('delay_consequence');
        }
        break;

      case 'safety_unconfirmed':
        if (answer === 'yes') {
          replace('safety_detail', 'potential');
        } else if (answer === 'preventive') {
          replace('safety_detail', 'preventive');
          suppressed.add('safety_concern');
          suppressed.add('safety_confirmed');
        }
        break;
    }
  }

  const normalizedSession: DecisionSession = {
    ...session,
    answers,
  };

  const original = buildEvidence(session);
  const normalized = buildEvidence(normalizedSession);

  const key = (item: Evidence) =>
    `${item.flagId}:${item.sourceQuestionId}:${item.sourceOptionId}`;

  const normalizedKeys = new Set(normalized.map(key));

  const history = original
    .filter(item => !normalizedKeys.has(key(item)))
    .map(item => ({
      ...item,
      effectiveWeight: 0,
      status: 'neutralized' as const,
    }));

  const evidence: Evidence[] = [
    ...normalized,
    ...history,
  ];

  for (const conflict of detectConflicts(session)) {
    const question = getClarificationQuestion(conflict);
    const selected = getAnswer(session, question.id);

    const option = question.options.find(
      item => item.id === selected,
    );

    if (!option) continue;

    for (const flagId of option.flagIds) {
      if (!isFlagId(flagId)) continue;

      const definition = flagRegistry[flagId];

      evidence.push({
        flagId,
        dimension: definition.dimension,
        weight: definition.weight,
        effectiveWeight: definition.weight,
        sourceQuestionId: question.id,
        sourceOptionId: option.id,
        status: 'active',
      });
    }
  }

  const longTerm =
    getAnswer(normalizedSession, 'desire_duration') === 'long_term';

  return {
    session: normalizedSession,
    unresolvedConflicts,
    evidence: evidence.map(item => {
      if (
        suppressed.has(item.flagId) ||
        (longTerm && item.dimension === 'impulse')
      ) {
        return {
          ...item,
          effectiveWeight: 0,
          status: 'neutralized',
        };
      }

      return item;
    }),
  };
}