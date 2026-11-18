export const impulseVersion = '1.1.0';
export const buyingReasonsVersion = '2.0.0';
export const waitingPeriods = ['3-days', '1-week', '1-month'] as const;
export type WaitingPeriod = typeof waitingPeriods[number];

export const buyingReasons = [
  { id: 'withoutDiscount', question: 'Would you still want this at full price?', weight: 1, concernOnNo: true,
    reason: 'The discount is part of the appeal.', action: 'See if it still feels worth buying at full price.' },
  { id: 'alreadyHave', question: 'Do you already own something that does the job?', weight: 1,
    reason: 'Something you own already does the job.', action: 'Try using what you have a little longer.' },
  { id: 'useOften', question: 'Do you think you’ll use this often?', weight: 1, concernOnNo: true,
    reason: 'You may use this only occasionally.', action: 'Think about when you’d actually use it.' },
  { id: 'canWait', question: 'Can you put this purchase off without it causing a problem?', weight: 1,
    reason: 'You have room to decide later.', action: 'Pick a time to come back to it if that helps.' },
] as const;

export type BuyingAnswers = Partial<Record<typeof buyingReasons[number]['id'], boolean>>;

// Weights express product design choices. They are not effect sizes from the research.
const impulseRulesV1 = { minimumAnswered: 5, moderateAt: 4, highAt: 8, maximumCoolingOffDays: 365 } as const;
export const impulseRules = { ...impulseRulesV1 } as const;

const impulseFactorsV1 = [
  { id: 'temporary', question: 'Is this mainly something you want in the moment?', weight: 2,
    reason: 'The interest may be temporary.', action: 'Write down what you would use it for.' },
  { id: 'alternative', question: 'Do you already have something that would work?', weight: 1,
    reason: 'Something you own might meet the same need.', action: 'Try what you already have first.' },
  { id: 'promotion', question: 'Is a limited-time offer pushing you to decide sooner?', weight: 2,
    reason: 'The offer is setting the pace of the decision.', action: 'Consider whether the purchase makes sense at your own pace.' },
  { id: 'pressure', question: 'Are other people’s choices or fear of missing out affecting your decision?', weight: 2,
    reason: 'Social pressure is shaping the decision.', action: 'Think about what you would choose on your own.' },
  { id: 'research', question: 'Have you looked at other ways to meet the same need?', weight: 1, concernOnNo: true,
    reason: 'There may be alternatives you have yet to consider.', action: 'Compare another option, including keeping what you have.' },
  { id: 'waiting', question: 'Would you still want this after giving yourself time to decide?', weight: 2, concernOnNo: true,
    reason: 'Your interest may fade with time.', action: 'Pick a time to revisit the decision.' },
  { id: 'planned', question: 'Were you planning this purchase before you saw the offer or listing?', weight: 1, concernOnNo: true,
    reason: 'The purchase was outside your original plans.', action: 'Check how it fits with your other priorities.' },
] as const;

const needFactor = {
  id: 'need', question: 'Does this solve a specific need you can name?', weight: 2, concernOnNo: true,
  reason: 'You have yet to identify a specific need for this purchase.', action: 'Name what you would use it for and how often.',
} as const;
export const impulseFactors = [needFactor, ...impulseFactorsV1.slice(1)] as readonly
  (typeof needFactor | typeof impulseFactorsV1[number])[];

export function factorsForImpulseVersion(version: string) {
  if (version === buyingReasonsVersion) return buyingReasons;
  return version === '1.0.0' ? impulseFactorsV1 : impulseFactors;
}

type LegacyImpulseFactor = typeof impulseFactors[number]['id'];
export type ImpulseFactor = LegacyImpulseFactor | typeof buyingReasons[number]['id'];
export type ImpulseAnswers = Partial<Record<LegacyImpulseFactor, boolean>>;
export type ImpulseConcern = 'Low' | 'Moderate' | 'High' | 'Insufficient information';

export function evaluateImpulse(answers: ImpulseAnswers, coolingOffDays: number | null,
  version = answers.temporary === undefined ? impulseVersion : '1.0.0') {
  const factors = version === '1.0.0' ? impulseFactorsV1 : impulseFactors;
  const rules = version === '1.0.0' ? impulseRulesV1 : impulseRules;
  const contributing: LegacyImpulseFactor[] = [];
  const unanswered: LegacyImpulseFactor[] = [];
  let points = 0;
  let unresolved = 0;
  for (const factor of factors) {
    const answer = answers[factor.id];
    if (answer === undefined) {
      unanswered.push(factor.id);
      unresolved += factor.weight;
    } else if (answer === !('concernOnNo' in factor)) {
      contributing.push(factor.id);
      points += factor.weight;
    }
  }
  const band = (value: number) => value >= rules.highAt ? 'High'
    : value >= rules.moderateAt ? 'Moderate' : 'Low';
  const possiblePoints = points + unresolved;
  const concern: ImpulseConcern = factors.length - unanswered.length >= rules.minimumAnswered &&
    band(points) === band(possiblePoints) ? band(points) : 'Insufficient information';
  return {
    version,
    concern,
    contributing: contributing.sort((left, right) =>
      factors.find((factor) => factor.id === right)!.weight -
      factors.find((factor) => factor.id === left)!.weight),
    unanswered,
    points,
    possiblePoints,
    coolingOffDays,
  };
}

export function waitingReviewDate(asOf: string, period: WaitingPeriod) {
  const date = new Date(`${asOf}T00:00:00.000Z`);
  if (period === '1-month') {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  } else {
    date.setUTCDate(date.getUTCDate() + (period === '3-days' ? 3 : 7));
  }
  return date.toISOString().slice(0, 10);
}

export function evaluateBuyingReasons(answers: BuyingAnswers, period: WaitingPeriod | null, asOf: string) {
  const contributing = buyingReasons.filter((factor) => answers[factor.id] === !('concernOnNo' in factor)).map(({ id }) => id);
  const unanswered = buyingReasons.filter(({ id }) => answers[id] === undefined).map(({ id }) => id);
  const points = contributing.length;
  const possiblePoints = points + unanswered.length;
  const band = (value: number) => value >= 3 ? 'High' : value >= 2 ? 'Moderate' : 'Low';
  const concern: ImpulseConcern = unanswered.length <= 1 && band(points) === band(possiblePoints)
    ? band(points) : 'Insufficient information';
  return {
    version: buyingReasonsVersion, concern, contributing, unanswered, points, possiblePoints,
    coolingOffDays: null, period, reviewOn: period ? waitingReviewDate(asOf, period) : null,
  };
}

export type ImpulseResult = ReturnType<typeof evaluateImpulse> | ReturnType<typeof evaluateBuyingReasons>;
