import { useMemo, useState } from 'react';

import {
  createDecisionSession,
  setMotivation,
  submitAnswer,
  goBack,
  getNextQuestion,
  resolveBehavioralDecision,
  validateDecisionSession,
  adaptFinancialProfile,
  assessFinancialReadiness,
  combineAssessments,
  buildExplanation,
  type DecisionSession,
  type MotivationSelection,
  type FinancialProfileSource,
  type PurchaseTerms,
} from '../shared/decision-engine/index.js';
import { projectCredit } from '../shared/decision-engine/credit-projection.js';

type DecisionEngineOptions = {
  profile: FinancialProfileSource | null;
  purchase: PurchaseTerms | null;
  credit?: Omit<Parameters<typeof projectCredit>[0], 'profile'>;
  lowerRepaymentMinor?: bigint;
};

export function useDecisionEngine({
  profile,
  purchase,
  credit,
  lowerRepaymentMinor,
}: DecisionEngineOptions) {
  const [session, setSession] = useState<DecisionSession>(
    createDecisionSession,
  );

  const next = useMemo(
    () => getNextQuestion(session),
    [session],
  );

  const behavioral = useMemo(() => {
    if (next.status !== 'complete') return null;
    if (!validateDecisionSession(session)) return null;

    return resolveBehavioralDecision(session);
  }, [session, next]);

  const financialInput = useMemo(
    () => adaptFinancialProfile(profile, {
      debtExcludedFromExpenses: true,
      reserveIncludedInCash: false,
    }),
    [profile],
  );

  const financial = useMemo(() => {
    if (!behavioral || !purchase) return null;

    return assessFinancialReadiness(
      financialInput,
      purchase,
    );
  }, [behavioral, financialInput, purchase]);

  const assessment = useMemo(() => {
    if (!behavioral || !financial) return null;

    return combineAssessments(behavioral, financial);
  }, [behavioral, financial]);

  const explanation = useMemo(
    () => assessment ? buildExplanation(assessment) : null,
    [assessment],
  );
  const creditProjection = behavioral && credit
    ? projectCredit({ ...credit, profile: financialInput })
    : null;
  const lowerCreditProjection = behavioral && credit && lowerRepaymentMinor !== undefined
    ? projectCredit({ ...credit, repaymentMinor: lowerRepaymentMinor, profile: financialInput })
    : null;

  function selectMotivation(selection: MotivationSelection) {
    setSession(current => setMotivation(current, selection));
  }

  function answer(questionId: string, optionId: string) {
    setSession(current => {
      const currentStep = getNextQuestion(current);

      if (
        currentStep.status !== 'question' ||
        currentStep.question.id !== questionId
      ) {
        return current;
      }

      if (
        !currentStep.question.options.some(
          option => option.id === optionId,
        )
      ) {
        return current;
      }

      return submitAnswer(current, questionId, optionId);
    });
  }

  function back() {
    setSession(current => goBack(current));
  }

  function restart() {
    setSession(createDecisionSession());
  }

  return {
    session,
    next,
    behavioral,
    financialInput,
    financial,
    assessment,
    explanation,
    creditProjection,
    lowerCreditProjection,
    answeredCount:
      session.answers.length + (session.motivation ? 1 : 0),
    hasFinancialProfile: financialInput !== null,
    isComplete: next.status === 'complete',
    selectMotivation,
    answer,
    back,
    restart,
  };
}
