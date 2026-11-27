import type {
  BehavioralAssessment,
  DecisionOutcome,
} from './types.js';

import type {
  FinancialAssessment,
} from './financial-assessment.js';

export type CombinedOutcome =
  | DecisionOutcome
  | 'worth_buying'
  | 'should_wait'
  | 'do_not_buy_now';

export type CombinedAssessment = {
  mode: 'basic' | 'partial' | 'full';
  outcome: CombinedOutcome;
  behavioral: BehavioralAssessment;
  financial: FinancialAssessment;
  actionId: string;
};

export function combineAssessments(
  behavioral: BehavioralAssessment,
  financial: FinancialAssessment,
): CombinedAssessment {
  const mode =
    financial.status === 'not_assessed'
      ? 'basic'
      : financial.missingFields.length > 0 ||
        financial.status === 'insufficient_data'
        ? 'partial'
        : 'full';

  const base: CombinedAssessment = {
    mode,
    outcome: behavioral.outcome,
    behavioral,
    financial,
    actionId: behavioral.actionId,
  };

  // A financing simulation can inform readiness without upgrading the purchase verdict.
  if (financial.estimated) return base;

  const safetyNeed = behavioral.reasonIds.includes(
    'confirmed_safety_need',
  );

  if (financial.status === 'risky') {
    return {
      ...base,
      outcome: behavioral.outcome === 'unclear_need'
        ? 'should_wait'
        : 'do_not_buy_now',
      actionId: safetyNeed
        ? 'find_affordable_safe_alternative'
        : 'protect_financial_obligations',
    };
  }

  if (behavioral.outcome === 'not_needed') {
    return base;
  }

  if (behavioral.outcome === 'unclear_need') {
    return base;
  }

  if (financial.status === 'limited') {
    return {
      ...base,
      outcome: 'should_wait',
      actionId: safetyNeed
        ? 'find_affordable_safe_alternative'
        : 'build_purchase_budget',
    };
  }

  if (
    financial.status === 'not_assessed' ||
    financial.status === 'insufficient_data'
  ) {
    return base;
  }

  if (behavioral.outcome === 'can_wait') {
    return base;
  }

  const unresolvedProductIssue =
    behavioral.unresolvedConflict ||
    behavioral.reasonIds.includes('product_fit_limitation') ||
    behavioral.reasonIds.includes('product_quality_or_fit_uncertain') ||
    behavioral.reasonIds.includes('impulse_risk_present');

  if (unresolvedProductIssue) {
    return base;
  }

  return {
    ...base,
    outcome: 'worth_buying',
    actionId: 'purchase_within_budget',
  };
}
