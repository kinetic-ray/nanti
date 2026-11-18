import { evaluateBuyingReasons } from './impulse.js';
import type { WaitingPeriod } from './impulse.js';

export const screeningVersion = '3.0.0';

// Each pair is the evidence contributed by a No or Yes answer, respectively.
export const screeningSignals = {
  practicalNeed: ['no-clear-need', 'clear-need'],
  alreadyHave: ['no-substitute', 'has-substitute'],
  useOften: ['occasional-use', 'frequent-use'],
  canWait: ['delay-has-consequence', 'safe-to-wait'],
  withoutDiscount: ['discount-driven', 'interest-at-full-price'],
  socialPressure: ['no-fomo-reported', 'fomo-reported'],
} as const;

export const screeningQuestions = [
  'practicalNeed', 'alreadyHave', 'useOften', 'canWait', 'withoutDiscount', 'socialPressure',
] as const satisfies readonly (keyof typeof screeningSignals)[];
export type ScreeningQuestion = typeof screeningQuestions[number];
export type ScreeningAnswers = Partial<Record<ScreeningQuestion, boolean>>;
export type ScreeningSignal = typeof screeningSignals[ScreeningQuestion][number];

export function evaluateScreening(answers: ScreeningAnswers, period: WaitingPeriod | null, asOf: string) {
  const signals = screeningQuestions.flatMap((question) => {
    const value = answers[question];
    return value === undefined ? [] : [screeningSignals[question][value ? 1 : 0]];
  });
  const { practicalNeed, alreadyHave, useOften, canWait, withoutDiscount, socialPressure } = answers;
  const urgency = canWait === false;
  const outsidePressure = withoutDiscount === false || socialPressure === true;
  const littlePracticalValue =
    (practicalNeed === false && (alreadyHave === true || useOften === false || !urgency && (canWait === true || outsidePressure))) ||
    (alreadyHave === true && (useOften === false || canWait === true && outsidePressure)) ||
    (practicalNeed !== true && withoutDiscount === false && socialPressure === true && canWait === true);
  const strongNeed = practicalNeed === true && alreadyHave === false && (useOften === true || urgency);
  const outcome = littlePracticalValue ? 'red' : strongNeed && (urgency || !outsidePressure) ? 'green' : 'yellow';
  // Retain the older response fields for clients that still read impulse history.
  return {
    ...evaluateBuyingReasons(answers, period, asOf),
    version: screeningVersion,
    concern: ({ green: 'Low', yellow: 'Moderate', red: 'High' } as const)[outcome],
    outcome,
    signals,
    unanswered: screeningQuestions.filter((question) => answers[question] === undefined),
  };
}

export type ScreeningResult = ReturnType<typeof evaluateScreening>;
