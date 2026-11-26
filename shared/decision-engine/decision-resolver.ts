import {
  decisionEngineVersion,
  type DecisionSession,
  type DecisionOutcome,
  type BehavioralAssessment,
} from './types.js';

import {
  getAnswer,
  hasActiveFlag,
  strongestEvidence,
} from './evidence-engine.js';

import {
  calculateScores,
} from './scoring-engine.js';

import {
  reconcileEvidence,
} from './evidence-reconciliation.js';

import {
  validateDecisionSession,
} from './session-manager.js';

import {
  getNextQuestion,
} from './branching-engine.js';

export function resolveBehavioralDecision(
  originalSession: DecisionSession,
): BehavioralAssessment {
  if (!validateDecisionSession(originalSession)) {
    throw new Error('Invalid decision session.');
  }

  if (getNextQuestion(originalSession).status !== 'complete') {
    throw new Error('Decision session is incomplete.');
  }

  const reconciled = reconcileEvidence(originalSession);
  const session = reconciled.session;
  const evidence = reconciled.evidence;

  const scores = calculateScores(session, evidence);

  const answer = (id: string) => getAnswer(session, id);

  const flag = (
    id: Parameters<typeof hasActiveFlag>[1],
  ) => hasActiveFlag(evidence, id);

  const motivation = session.motivation;

  const primary =
    motivation?.primary === 'unclear'
      ? motivation.secondary ?? 'unclear'
      : motivation?.primary;

  const isHobby =
    primary === 'hobby_collection' &&
    (
      flag('active_hobby') ||
      flag('collection_value') ||
      flag('distinct_experience')
    );

  const confirmedSafety =
    flag('safety_concern') &&
    flag('safety_confirmed');

  const freeAlternative =
    answer('alternatives') === 'free_equivalent';

  const repairAccepted =
    answer('repair_willingness') === 'accepted';

  const strongNeed = (scores.need ?? 0) >= 4;
  const strongPersonalValue =
    (scores.personal_value ?? 0) >= 4;

  const highImpulse = (scores.impulse ?? 0) >= 4;

  const insufficientEvidence =
    (scores.evidence ?? 0) < 2.5;

  const futureNeed =
    answer('need_timing') === 'future' ||
    answer('gift_timing') === 'future';

  const adequateOwnership =
    answer('ownership') === 'adequate' ||
    answer('ownership') === 'multiple';

  const multipleItems =
    answer('ownership') === 'multiple';

  const meaningfulUpgrade =
    answer('additional_benefit') === 'functional' ||
    answer('additional_benefit') === 'efficiency' ||
    (
      answer('additional_benefit') === 'comfort' &&
      flag('daily_comfort')
    );

  const specificEmotionalBenefit =
    flag('confidence_value') ||
    flag('emotional_value');

  const confirmedReward =
    answer('personal_value') === 'reward' &&
    (
      flag('planned_reward') ||
      flag('meaningful_achievement')
    );

  const explicitWeakBenefit =
    answer('impact') === 'unknown' ||
    answer('personal_value') === 'unknown' ||
    answer('additional_benefit') === 'similar';

  const productMismatch =
    answer('product_fit') === 'mismatch' ||
    answer('product_fit') === 'partial' ||
    answer('product_fit') === 'excessive';

  const productUncertain =
    !answer('product_fit') ||
    answer('product_fit') === 'unknown' ||
    answer('quality') === 'unknown' ||
    answer('quality') === 'concern';

  let outcome: DecisionOutcome;
  let reason: string;
  let actionId: string;

  if (freeAlternative && !isHobby) {
    outcome = 'not_needed';
    reason = 'free_equivalent_available';
    actionId = 'use_existing_alternative';

  } else if (confirmedSafety) {
    outcome = 'worth_considering';
    reason = 'confirmed_safety_need';
    actionId = 'prioritize_safe_product';

  } else if (futureNeed) {
    outcome = 'can_wait';
    reason = 'future_need';
    actionId = 'review_closer_to_need';

  } else if (repairAccepted && !isHobby) {
    outcome = 'not_needed';
    reason = 'repair_meets_need';
    actionId = 'repair_existing_item';

  } else if (
    multipleItems &&
    !meaningfulUpgrade &&
    !isHobby
  ) {
    outcome = 'can_wait';
    reason = 'multiple_equivalent_items';
    actionId = 'use_existing_items';

  } else if (
    adequateOwnership &&
    !meaningfulUpgrade &&
    !specificEmotionalBenefit &&
    !confirmedReward &&
    !isHobby &&
    !flag('activity_disruption')
  ) {
    outcome = 'can_wait';
    reason = 'existing_item_still_adequate';
    actionId = 'review_incremental_benefit';

  } else if (
    flag('promotion_dependency') &&
    !strongNeed &&
    !strongPersonalValue
  ) {
    outcome = 'not_needed';
    reason = 'promotion_without_clear_benefit';
    actionId = 'reconsider_without_promotion';

  } else if (
    insufficientEvidence &&
    !strongNeed &&
    !strongPersonalValue
  ) {
    outcome = 'unclear_need';
    reason = 'insufficient_evidence';
    actionId = 'identify_expected_benefit';

  } else if (
    strongNeed ||
    strongPersonalValue ||
    confirmedReward
  ) {
    outcome = 'worth_considering';

    reason =
      strongNeed && strongPersonalValue
        ? 'functional_and_personal_benefit'
        : strongNeed
          ? 'strong_functional_benefit'
          : 'strong_personal_value';

    actionId = 'review_purchase_readiness';

  } else if (
    highImpulse &&
    explicitWeakBenefit
  ) {
    outcome = 'not_needed';
    reason = 'impulse_without_clear_benefit';
    actionId = 'reconsider_purchase_later';

  } else if (
    (scores.need ?? 0) >= 3 ||
    (scores.personal_value ?? 0) >= 3
  ) {
    outcome = 'can_wait';
    reason = 'limited_purchase_benefit';
    actionId = 'review_benefit_later';

  } else {
    outcome = 'unclear_need';
    reason = 'unclear_purchase_motivation';
    actionId = 'identify_expected_benefit';
  }

  const reasonIds = [reason];

  if (outcome === 'worth_considering') {
    if (productMismatch) {
      reasonIds.push('product_fit_limitation');
      actionId = confirmedSafety
        ? 'find_suitable_safe_alternative'
        : 'compare_more_suitable_products';

    } else if (productUncertain) {
      reasonIds.push('product_quality_or_fit_uncertain');
      actionId = 'verify_product_quality_and_fit';

    } else if (highImpulse) {
      reasonIds.push('impulse_risk_present');
      actionId = 'review_product_choice_without_pressure';
    }
  }

  if (reconciled.unresolvedConflicts.length) {
    reasonIds.push('unresolved_evidence_conflict');
  }

  const supportingEvidence = strongestEvidence(evidence)
    .filter(item =>
      item.effectiveWeight >= 4 &&
      (
        outcome === 'worth_considering'
          ? item.dimension === 'need' ||
            item.dimension === 'personal_value'
          : outcome === 'can_wait'
            ? item.dimension === 'deferral'
            : false
      ),
    )
    .map(item => item.flagId);

  for (const id of supportingEvidence) {
    if (reasonIds.length >= 3) break;
    if (!reasonIds.includes(id)) reasonIds.push(id);
  }

  return {
    version: decisionEngineVersion,
    outcome,
    scores,
    evidence,
    reasonIds: reasonIds.slice(0, 3),
    actionId,
    unresolvedConflict:
      reconciled.unresolvedConflicts.length > 0,
  };
}