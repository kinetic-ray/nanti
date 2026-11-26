import {
  questionLimits,
  type DecisionSession,
  type DecisionQuestion,
  type MotivationId,
} from './types.js';

import {
  getQuestion,
  type QuestionId,
} from './question-registry.js';

import {
  buildEvidence,
  getAnswer,
  hasActiveFlag,
} from './evidence-engine.js';

import {
  calculateScores,
  detectConflicts,
} from './scoring-engine.js';

export type BranchingResult =
  | { status: 'motivation_required' }
  | {
      status: 'question';
      question: DecisionQuestion;
      answeredCount: number;
    }
  | {
      status: 'complete';
      answeredCount: number;
      unresolvedConflict: boolean;
    };

export function getClarificationQuestion(
  conflict: string,
): DecisionQuestion {
  const definitions: Record<string, DecisionQuestion> = {
    impact_delay_conflict: {
      id: 'clarify_impact_delay',
      prompt: 'Mana yang lebih menggambarkan situasimu?',
      clarification: true,
      options: [
        {
          id: 'important',
          label: 'Aktivitasku memang terganggu tanpa barang ini',
          flagIds: ['activity_disruption'],
        },
        {
          id: 'optional',
          label: 'Sebenarnya aku masih bisa beraktivitas dengan baik',
          flagIds: ['low_urgency'],
        },
        {
          id: 'unknown',
          label: 'Belum bisa memastikan',
          flagIds: [],
        },
      ],
    },
    ownership_condition_conflict: {
      id: 'clarify_ownership',
      prompt: 'Apakah barang yang kamu punya masih cukup dan aman digunakan?',
      clarification: true,
      options: [
        {
          id: 'adequate',
          label: 'Ya, masih cukup dan aman',
          flagIds: ['existing_item_adequate'],
        },
        {
          id: 'insufficient',
          label: 'Tidak, sudah tidak memadai',
          flagIds: ['replacement_confirmed'],
        },
        {
          id: 'unknown',
          label: 'Belum bisa memastikan',
          flagIds: [],
        },
      ],
    },
    timing_delay_conflict: {
      id: 'clarify_timing',
      prompt: 'Kapan manfaat barang ini benar-benar kamu perlukan?',
      clarification: true,
      options: [
        {
          id: 'now',
          label: 'Sekarang, karena aktivitasku sudah terganggu',
          flagIds: ['immediate_need'],
        },
        {
          id: 'future',
          label: 'Nanti, ketika aktivitas tersebut dimulai',
          flagIds: ['future_need'],
        },
        {
          id: 'unknown',
          label: 'Belum bisa memastikan',
          flagIds: [],
        },
      ],
    },
    safety_unconfirmed: {
      id: 'clarify_safety',
      prompt: 'Apakah ada risiko nyata jika kamu tetap menggunakan barang yang sekarang?',
      clarification: true,
      options: [
        {
          id: 'yes',
          label: 'Ya, ada risiko keamanan yang nyata',
          flagIds: ['safety_concern', 'safety_confirmed'],
        },
        {
          id: 'preventive',
          label: 'Tidak ada risiko khusus, hanya ingin lebih terlindungi',
          flagIds: ['comfort_upgrade'],
        },
        {
          id: 'unknown',
          label: 'Belum bisa memastikan',
          flagIds: [],
        },
      ],
    },
  };

  const question = definitions[conflict];

  if (!question) {
    throw new Error(`Unsupported conflict: ${conflict}`);
  }

  return question;
}

export function getUnresolvedConflicts(
  session: DecisionSession,
): string[] {
  return detectConflicts(session).filter(conflict => {
    const clarification = getClarificationQuestion(conflict);
    const answer = getAnswer(session, clarification.id);

    return !answer || answer === 'unknown';
  });
}

function branchQuestions(
  session: DecisionSession,
  motivation: MotivationId,
): QuestionId[] {
  const answer = (id: string) => getAnswer(session, id);
  const questions: QuestionId[] = [];

  const add = (...ids: QuestionId[]) => {
    for (const id of ids) {
      if (!questions.includes(id)) questions.push(id);
    }
  };

  switch (motivation) {
    case 'replacement':
      add('ownership');

      if (answer('ownership') && answer('ownership') !== 'none') {
        add('condition');
      }

      if (answer('condition') === 'unsafe') {
        add('safety_detail');
      }

      add('impact');

      if (
        answer('condition') === 'problematic' ||
        answer('condition') === 'uncomfortable'
      ) {
        add('problem_frequency', 'repair');

        if (answer('repair') === 'yes') {
          add('repair_willingness');
        }
      }

      if (
        answer('ownership') === 'adequate' ||
        answer('ownership') === 'multiple'
      ) {
        add('additional_benefit');
      }

      add('alternatives', 'need_timing');
      break;

    case 'functional':
      add('impact', 'ownership');

      if (
        answer('ownership') === 'adequate' ||
        answer('ownership') === 'multiple'
      ) {
        add('additional_benefit');
      }

      if (answer('ownership') === 'insufficient') {
        add('condition');
      }

      if (answer('condition') === 'unsafe') {
        add('safety_detail');
      }

      if (answer('impact') === 'disruption') {
        add('problem_frequency', 'delay_consequence');
      }

      if (answer('impact') === 'unknown') {
        add('usage_frequency');
      }

      add('alternatives', 'need_timing');
      break;

    case 'comfort_safety':
      add('comfort_safety');

      if (answer('comfort_safety') === 'discomfort') {
        add('problem_frequency');
      }

      if (
        answer('comfort_safety') === 'comfort' ||
        answer('comfort_safety') === 'both'
      ) {
        add('usage_frequency');
      }

      if (
        answer('comfort_safety') === 'safety' ||
        answer('comfort_safety') === 'both'
      ) {
        add('safety_detail');
      }

      add('ownership');

      if (answer('ownership') === 'insufficient') {
        add('condition');
      }

      if (answer('condition') === 'uncomfortable') {
        add('repair');

        if (answer('repair') === 'yes') {
          add('repair_willingness');
        }
      }

      add('alternatives', 'need_timing');
      break;

    case 'personal_satisfaction':
      add('personal_value');

      if (answer('personal_value') === 'reward') {
        add('reward_meaning', 'reward_planning');
      }

      add('desire_duration', 'ownership');

      if (
        answer('ownership') === 'adequate' ||
        answer('ownership') === 'multiple'
      ) {
        add('additional_benefit');
      }

      add('need_timing');
      break;

    case 'hobby_collection':
      add(
        'hobby_activity',
        'hobby_experience',
        'desire_duration',
        'usage_frequency',
      );
      break;

    case 'gift':
      add('gift_fit', 'gift_timing');
      break;

    case 'external_influence':
      add('external_trigger', 'impact', 'desire_duration');

      if (answer('desire_duration') !== 'long_term') {
        switch (answer('external_trigger')) {
          case 'promotion':
            add('promotion_dependency');
            break;
          case 'social':
            add('social_influence');
            break;
          case 'scarcity':
            add('scarcity');
            break;
        }
      }

      if (answer('impact') === 'personal') {
        add('personal_value');
      }

      add('ownership', 'alternatives');
      break;

    case 'unclear':
      add('impact');

      if (answer('impact') === 'personal') {
        add('personal_value');
      }

      add('desire_duration', 'ownership', 'usage_frequency');
      break;
  }

  return questions;
}

function candidateQuestions(
  session: DecisionSession,
): QuestionId[] {
  if (!session.motivation) return [];

  const { primary, secondary } = session.motivation;

  const main =
    primary === 'unclear' && secondary
      ? secondary
      : primary;

  const supporting =
    secondary && secondary !== main
      ? secondary
      : undefined;

  const primaryQuestions = branchQuestions(session, main);

  const supportingQuestions = supporting
    ? branchQuestions(session, supporting)
    : [];

  const evidence = buildEvidence(session);
  const scores = calculateScores(session, evidence);

  const safetyClaim = hasActiveFlag(evidence, 'safety_concern');
  const confirmedSafety = hasActiveFlag(evidence, 'safety_confirmed');

  const candidates: QuestionId[] = [];

  const add = (...ids: QuestionId[]) => {
    for (const id of ids) {
      if (!candidates.includes(id)) candidates.push(id);
    }
  };

  // Resolve safety claims before ordinary follow-up.
  if (safetyClaim && !confirmedSafety) {
    add('safety_detail');
  }

  // Preserve room for essential safety and product-fit checks.
  if (confirmedSafety) {
    add('alternatives', 'product_fit');
  }

  // Explore the main motivation first.
  add(...primaryQuestions);

  // Reserve product fit before lower-priority supporting questions.
  add('product_fit');

  add(...supportingQuestions);

  if (
    getAnswer(session, 'product_fit') === 'unknown' ||
    getAnswer(session, 'product_fit') === 'partial' ||
    getAnswer(session, 'product_fit') === 'excessive'
  ) {
    add('quality');
  }

  if ((scores.need ?? 0) >= 4) {
    add('need_timing', 'delay_consequence');
  }

  if (
    (scores.need ?? 0) < 4 &&
    (scores.personal_value ?? 0) < 4
  ) {
    add('impact', 'desire_duration', 'usage_frequency');
  }

  add('quality', 'need_timing', 'usage_frequency');

  return candidates.filter(id => {
    if (getAnswer(session, id) !== undefined) return false;

    if (
      getAnswer(session, 'desire_duration') === 'long_term' &&
      (
        id === 'promotion_dependency' ||
        id === 'social_influence' ||
        id === 'scarcity'
      )
    ) {
      return false;
    }

    if (
      main === 'hobby_collection' &&
      id === 'alternatives' &&
      !confirmedSafety
    ) {
      return false;
    }

    return true;
  });
}

function hasEnoughEvidence(
  session: DecisionSession,
): boolean {
  const evidence = buildEvidence(session);
  const scores = calculateScores(session, evidence);

  if (getUnresolvedConflicts(session).length) return false;

  if (
    hasActiveFlag(evidence, 'safety_concern') &&
    getAnswer(session, 'safety_detail') === undefined
  ) {
    return false;
  }

  if (
    hasActiveFlag(evidence, 'safety_confirmed') &&
    getAnswer(session, 'alternatives') === undefined
  ) {
    return false;
  }

  if (getAnswer(session, 'product_fit') === undefined) {
    return false;
  }

  if ((scores.evidence ?? 0) < 3.75) return false;

  const main = session.motivation?.primary === 'unclear'
    ? session.motivation.secondary ?? 'unclear'
    : session.motivation?.primary;

  if (
    main === 'personal_satisfaction' &&
    getAnswer(session, 'personal_value') === 'reward' &&
    (
      !getAnswer(session, 'reward_meaning') ||
      !getAnswer(session, 'reward_planning')
    )
  ) {
    return false;
  }

  if (
    getAnswer(session, 'repair') === 'yes' &&
    !getAnswer(session, 'repair_willingness')
  ) {
    return false;
  }

  if (
    session.motivation?.secondary &&
    session.motivation.primary !== 'unclear'
  ) {
    const supporting = branchQuestions(
      session,
      session.motivation.secondary,
    );

    const first = supporting[0];

    if (first && getAnswer(session, first) === undefined) {
      return false;
    }
  }

  return true;
}

export function getNextQuestion(
  session: DecisionSession,
): BranchingResult {
  if (!session.motivation) {
    return { status: 'motivation_required' };
  }

  // Motivation counts as one question.
  const answeredCount = 1 + session.answers.length;

  const conflicts = getUnresolvedConflicts(session);
  const firstConflict = conflicts[0];

  const clarificationUsed = session.answers.some(
    answer => answer.questionId.startsWith('clarify_'),
  );

  const complete = (): BranchingResult => ({
    status: 'complete',
    answeredCount,
    unresolvedConflict: conflicts.length > 0,
  });

  const next = (question: DecisionQuestion): BranchingResult => ({
    status: 'question',
    question,
    answeredCount,
  });

  // One clarification per session.
  // It may be asked immediately, including as question nine.
  if (
    firstConflict !== undefined &&
    !clarificationUsed &&
    answeredCount <
      questionLimits.maximum +
      questionLimits.clarificationAllowance
  ) {
    return next(getClarificationQuestion(firstConflict));
  }

  if (answeredCount >= questionLimits.maximum) {
    return complete();
  }

  if (
    answeredCount >= questionLimits.minimum &&
    hasEnoughEvidence(session)
  ) {
    return complete();
  }

  const candidates = candidateQuestions(session);

  const firstCandidate = candidates[0];

  if (firstCandidate === undefined) return complete();

  // Reserve the final regular question for product fit.
  if (
    answeredCount === questionLimits.maximum - 1 &&
    getAnswer(session, 'product_fit') === undefined
  ) {
    return next(getQuestion('product_fit'));
  }

  return next(getQuestion(firstCandidate));
}