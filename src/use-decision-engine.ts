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

type DecisionEngineOptions = {
  profile: FinancialProfileSource | null;
  purchase: PurchaseTerms | null;
};

export function useDecisionEngine({
  profile,
  purchase,
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
    () => adaptFinancialProfile(profile),
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