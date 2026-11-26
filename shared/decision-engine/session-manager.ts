import {
  decisionEngineVersion,
  type DecisionSession,
  type MotivationSelection,
} from './types.js';

import {
  isValidMotivationSelection,
} from './motivation-registry.js';

import {
  getNextQuestion,
} from './branching-engine.js';

export function createDecisionSession(): DecisionSession {
  return {
    version: decisionEngineVersion,
    motivation: null,
    answers: [],
  };
}

export function setMotivation(
  session: DecisionSession,
  motivation: MotivationSelection,
): DecisionSession {
  if (!isValidMotivationSelection(motivation)) {
    throw new Error('Invalid motivation selection.');
  }

  if (
    session.motivation?.primary === motivation.primary &&
    session.motivation?.secondary === motivation.secondary
  ) {
    return session;
  }

  return {
    ...session,
    motivation: { ...motivation },
    answers: [],
  };
}

export function submitAnswer(
  session: DecisionSession,
  questionId: string,
  optionId: string,
): DecisionSession {
  const existingIndex = session.answers.findIndex(
    answer => answer.questionId === questionId,
  );

  if (
    existingIndex >= 0 &&
    session.answers[existingIndex]?.optionId === optionId
  ) {
    return session;
  }

  const base: DecisionSession =
    existingIndex >= 0
      ? {
          ...session,
          answers: session.answers.slice(0, existingIndex),
        }
      : session;

  const next = getNextQuestion(base);

  if (
    next.status !== 'question' ||
    next.question.id !== questionId
  ) {
    throw new Error('Question is not available in this session.');
  }

  if (!next.question.options.some(option => option.id === optionId)) {
    throw new Error('Invalid answer option.');
  }

  return {
    ...base,
    answers: [
      ...base.answers,
      { questionId, optionId },
    ],
  };
}

export function goBack(
  session: DecisionSession,
): DecisionSession {
  if (!session.answers.length) {
    return {
      ...session,
      motivation: null,
      answers: [],
    };
  }

  return {
    ...session,
    answers: session.answers.slice(0, -1),
  };
}

export function validateDecisionSession(
  session: DecisionSession,
): boolean {
  try {
    if (session.version !== decisionEngineVersion) return false;

    if (!session.motivation) {
      return session.answers.length === 0;
    }

    let replay = setMotivation(
      createDecisionSession(),
      session.motivation,
    );

    for (const answer of session.answers) {
      replay = submitAnswer(
        replay,
        answer.questionId,
        answer.optionId,
      );
    }

    return replay.answers.length === session.answers.length;
  } catch {
    return false;
  }
}