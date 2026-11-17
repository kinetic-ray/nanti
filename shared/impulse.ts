export const impulseVersion = '1.1.0';

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
  return version === '1.0.0' ? impulseFactorsV1 : impulseFactors;
}

export type ImpulseFactor = typeof impulseFactors[number]['id'];
export type ImpulseAnswers = Partial<Record<ImpulseFactor, boolean>>;
export type ImpulseConcern = 'Low' | 'Moderate' | 'High' | 'Insufficient information';

export function evaluateImpulse(answers: ImpulseAnswers, coolingOffDays: number | null,
  version = answers.temporary === undefined ? impulseVersion : '1.0.0') {
  const factors = factorsForImpulseVersion(version);
  const rules = version === '1.0.0' ? impulseRulesV1 : impulseRules;
  const contributing: ImpulseFactor[] = [];
  const unanswered: ImpulseFactor[] = [];
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

export type ImpulseResult = ReturnType<typeof evaluateImpulse>;
