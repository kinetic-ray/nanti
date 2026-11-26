import { describe, expect, it } from 'vitest';

import {
  createDecisionSession,
  setMotivation,
  submitAnswer,
  getNextQuestion,
  resolveBehavioralDecision,
  validateDecisionSession,
  goBack,
  buildEvidence,
  calculateScores,
  type MotivationSelection,
  type DecisionSession,
} from '../shared/decision-engine/index.js';

type FixtureAnswers = Record<string, string>;

function simulate(
  motivation: MotivationSelection,
  answers: FixtureAnswers,
) {
  let session = setMotivation(
    createDecisionSession(),
    motivation,
  );

  const visited: string[] = [];

  for (let step = 0; step < 10; step++) {
    const next = getNextQuestion(session);

    if (next.status === 'complete') {
      expect(validateDecisionSession(session)).toBe(true);

      return {
        session,
        visited,
        result: resolveBehavioralDecision(session),
      };
    }

    if (next.status !== 'question') {
      throw new Error('Unexpected motivation request.');
    }

    const id = next.question.id;
    const option = answers[id];

    if (!option) {
      throw new Error(
        `Missing fixture answer: ${id}. ` +
        `Visited: ${visited.join(', ')}`,
      );
    }

    expect(visited).not.toContain(id);

    visited.push(id);

    session = submitAnswer(session, id, option);
  }

  throw new Error('Session did not terminate.');
}

const defaults: FixtureAnswers = {
  ownership: 'none',
  condition: 'good',
  impact: 'functional',
  problem_frequency: 'daily',
  additional_benefit: 'similar',
  usage_frequency: 'daily',
  desire_duration: 'months',
  promotion_dependency: 'yes',
  social_influence: 'independent',
  scarcity: 'yes',
  alternatives: 'none',
  repair: 'no',
  repair_willingness: 'unwilling',
  need_timing: 'now',
  delay_consequence: 'minor',
  product_fit: 'exact',
  quality: 'verified',
  hobby_activity: 'active',
  hobby_experience: 'distinct',
  personal_value: 'emotional',
  reward_meaning: 'achievement',
  reward_planning: 'planned',
  gift_fit: 'meaningful',
  gift_timing: 'flexible',
  comfort_safety: 'comfort',
  safety_detail: 'potential',
  external_trigger: 'promotion',
  clarify_impact_delay: 'important',
  clarify_ownership: 'insufficient',
  clarify_timing: 'now',
  clarify_safety: 'yes',
};

function run(
  primary: MotivationSelection['primary'],
  overrides: FixtureAnswers = {},
) {
  return simulate(
    { primary },
    { ...defaults, ...overrides },
  );
}

describe('Decision Engine V2: behavioral decisions', () => {
  it('recognizes a confirmed safety need', () => {
    const { result } = run('comfort_safety', {
      comfort_safety: 'safety',
      safety_detail: 'potential',
      ownership: 'insufficient',
      condition: 'unsafe',
    });

    expect(result.outcome).toBe('worth_considering');
    expect(result.scores.urgency).toBe(5);
  });

  it('prioritizes a free equivalent safe alternative', () => {
    const { result } = run('comfort_safety', {
      comfort_safety: 'safety',
      safety_detail: 'potential',
      alternatives: 'free_equivalent',
    });

    expect(result.outcome).toBe('not_needed');
  });

  it('recognizes meaningful hobby purchases', () => {
    const { result, visited } = run('hobby_collection', {
      hobby_activity: 'collection',
      hobby_experience: 'distinct',
      desire_duration: 'long_term',
    });

    expect(result.outcome).toBe('worth_considering');
    expect(visited).not.toContain('alternatives');
    expect(result.scores.impulse).toBe(0);
  });

  it('recognizes a planned achievement reward', () => {
    const { result, visited } = run('personal_satisfaction', {
      personal_value: 'reward',
      reward_meaning: 'achievement',
      reward_planning: 'planned',
      desire_duration: 'long_term',
    });

    expect(visited).toContain('reward_meaning');
    expect(visited).toContain('reward_planning');
    expect(result.outcome).toBe('worth_considering');
  });

  it('defers purchases when several equivalent items exist', () => {
    const { result } = run('personal_satisfaction', {
      personal_value: 'emotional',
      ownership: 'multiple',
      desire_duration: 'long_term',
      additional_benefit: 'appearance',
    });

    expect(result.outcome).toBe('can_wait');
  });

  it('recognizes confidence as a valid personal benefit', () => {
    const { result } = run('personal_satisfaction', {
      personal_value: 'confidence',
      ownership: 'adequate',
      additional_benefit: 'appearance',
    });

    expect(result.outcome).toBe('worth_considering');
  });

  it('rejects promotion-driven purchases without clear benefit', () => {
    const { result } = run('external_influence', {
      external_trigger: 'promotion',
      impact: 'unknown',
      desire_duration: 'today',
      promotion_dependency: 'no',
    });

    expect(result.outcome).toBe('not_needed');
  });

  it('recognizes disruption to important activities', () => {
    const { result } = run('functional', {
      impact: 'disruption',
      ownership: 'insufficient',
      condition: 'problematic',
      delay_consequence: 'serious',
    });

    expect(result.outcome).toBe('worth_considering');
  });

  it('defers a genuine future need', () => {
    const { result, visited } = run('functional', {
      impact: 'functional',
      need_timing: 'future',
    });

    expect(visited).toContain('need_timing');
    expect(result.outcome).toBe('can_wait');
  });

  it('preserves a genuine need despite uncertain product fit', () => {
    const { result } = run('functional', {
      impact: 'disruption',
      delay_consequence: 'serious',
      product_fit: 'unknown',
      quality: 'unknown',
    });

    expect(result.outcome).toBe('worth_considering');
    expect(result.reasonIds).toContain(
      'product_quality_or_fit_uncertain',
    );
  });

  it('recognizes daily comfort as a meaningful benefit', () => {
    const { result } = run('comfort_safety', {
      comfort_safety: 'comfort',
      usage_frequency: 'daily',
    });

    expect(result.outcome).toBe('worth_considering');
  });

  it('does not assume a need when motivation remains unclear', () => {
    const { result } = run('unclear', {
      impact: 'unknown',
      desire_duration: 'unknown',
      usage_frequency: 'unknown',
      product_fit: 'unknown',
      quality: 'unknown',
    });

    expect(result.outcome).toBe('unclear_need');
  });

  it('clarifies an unexplained safety claim', () => {
    const { visited, result } = run('comfort_safety', {
      comfort_safety: 'safety',
      safety_detail: 'unknown',
      clarify_safety: 'yes',
    });

    expect(visited).toContain('clarify_safety');
    expect(result.outcome).toBe('worth_considering');
    expect(result.unresolvedConflict).toBe(false);
  });

  it('does not retain a safety override after preventive clarification', () => {
    const { result } = run('comfort_safety', {
      comfort_safety: 'safety',
      safety_detail: 'unknown',
      clarify_safety: 'preventive',
    });

    expect(result.reasonIds).not.toContain(
      'confirmed_safety_need',
    );

    expect(
      result.evidence.some(item =>
        item.flagId === 'safety_concern' &&
        item.effectiveWeight > 0,
      ),
    ).toBe(false);
  });
});

describe('Decision Engine V2: scoring invariants', () => {
  it('does not inflate correlated evidence beyond five', () => {
    const { result } = run('functional', {
      impact: 'disruption',
      delay_consequence: 'serious',
    });

    for (const score of Object.values(result.scores)) {
      if (score !== null) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(5);
      }
    }
  });

  it('neutralizes every impulse flag for long-term desire', () => {
    const session: DecisionSession = {
      ...createDecisionSession(),
      motivation: { primary: 'external_influence' },
      answers: [
        {
          questionId: 'external_trigger',
          optionId: 'promotion',
        },
        {
          questionId: 'desire_duration',
          optionId: 'long_term',
        },
        {
          questionId: 'promotion_dependency',
          optionId: 'no',
        },
      ],
    };

    const evidence = buildEvidence(session);

    expect(
      evidence.filter(item => item.dimension === 'impulse')
        .length,
    ).toBeGreaterThan(0);

    expect(
      evidence
        .filter(item => item.dimension === 'impulse')
        .every(item => item.effectiveWeight === 0),
    ).toBe(true);

    expect(calculateScores(session, evidence).impulse).toBe(0);
  });

  it('keeps unassessed dimensions unknown', () => {
    const scores = calculateScores(createDecisionSession());

    expect(
      Object.values(scores).every(score => score === null),
    ).toBe(true);
  });

  it('does not count first ownership as proof of need', () => {
    const session: DecisionSession = {
      ...createDecisionSession(),
      motivation: { primary: 'unclear' },
      answers: [
        {
          questionId: 'ownership',
          optionId: 'none',
        },
      ],
    };

    expect(calculateScores(session).need).toBeNull();
  });

  it('applies the supporting motivation multiplier', () => {
    const session = setMotivation(
      createDecisionSession(),
      {
        primary: 'functional',
        secondary: 'hobby_collection',
      },
    );

    const hobby = buildEvidence(session).find(
      item => item.flagId === 'hobby_value',
    );

    expect(hobby?.effectiveWeight).toBe(3);
  });
});

describe('Decision Engine V2: session integrity', () => {
  it('starts with motivation selection', () => {
    expect(
      getNextQuestion(createDecisionSession()).status,
    ).toBe('motivation_required');
  });

  it('rejects duplicate primary and secondary motivations', () => {
    expect(() => setMotivation(
      createDecisionSession(),
      {
        primary: 'functional',
        secondary: 'functional',
      },
    )).toThrow();
  });

  it('rejects questions outside the current branch', () => {
    const session = setMotivation(
      createDecisionSession(),
      { primary: 'functional' },
    );

    expect(() =>
      submitAnswer(session, 'gift_fit', 'meaningful'),
    ).toThrow();
  });

  it('rejects invalid answer options', () => {
    const session = setMotivation(
      createDecisionSession(),
      { primary: 'functional' },
    );

    expect(() =>
      submitAnswer(session, 'impact', 'invalid'),
    ).toThrow();
  });

  it('resets downstream answers when motivation changes', () => {
    const { session } = run('functional');

    const updated = setMotivation(session, {
      primary: 'hobby_collection',
    });

    expect(updated.answers).toHaveLength(0);
  });

  it('resets downstream answers when an earlier answer changes', () => {
    const { session } = run('functional');

    const updated = submitAnswer(
      session,
      'impact',
      'unknown',
    );

    expect(updated.answers).toEqual([
      { questionId: 'impact', optionId: 'unknown' },
    ]);
  });

  it('supports backward navigation', () => {
    const { session } = run('functional');
    const previous = goBack(session);

    expect(previous.answers.length).toBe(
      session.answers.length - 1,
    );
  });

  it('rejects incomplete assessment sessions', () => {
    const session = setMotivation(
      createDecisionSession(),
      { primary: 'functional' },
    );

    expect(() =>
      resolveBehavioralDecision(session),
    ).toThrow();
  });

  it('rejects tampered answer sequences', () => {
    const session = setMotivation(
      createDecisionSession(),
      { primary: 'functional' },
    );

    const tampered: DecisionSession = {
      ...session,
      answers: [
        {
          questionId: 'gift_fit',
          optionId: 'meaningful',
        },
      ],
    };

    expect(validateDecisionSession(tampered)).toBe(false);
  });

  it('keeps normal sessions within the question budget', () => {
    const motivations = [
      'replacement',
      'functional',
      'comfort_safety',
      'personal_satisfaction',
      'hobby_collection',
      'gift',
      'external_influence',
      'unclear',
    ] as const;

    for (const motivation of motivations) {
      const { session } = run(motivation);

      const total = session.answers.length + 1;

      expect(total).toBeGreaterThanOrEqual(5);
      expect(total).toBeLessThanOrEqual(8);
    }
  });
});