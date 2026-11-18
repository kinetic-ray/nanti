export const priorityVersion = '2.0.0';
export const priorityLimit = 6;
export const priorityFactors = ['usefulness', 'urgency', 'affordability', 'preference'] as const;
export type PriorityFactor = typeof priorityFactors[number];
export type PriorityRatings = Record<PriorityFactor, number>;
export type PriorityInput = {
  mode: 'priorities';
  emphasis: PriorityFactor | null;
  alternatives: { wishlistId: string; itemId: string; ratings: PriorityRatings }[];
};

export function rankPriorities(input: PriorityInput) {
  const ranking = input.alternatives.map(({ itemId, ratings }) => ({
    id: itemId,
    score: priorityFactors.reduce((sum, factor) => sum + ratings[factor] * (factor === input.emphasis ? 2 : 1), 0),
    strengths: priorityFactors.filter((factor) => ratings[factor] === 2),
    needsTime: ratings.affordability < 2,
    rank: 1,
  })).sort((a, b) => b.score - a.score);
  ranking.forEach((entry, index) => {
    const previous = ranking[index - 1];
    entry.rank = previous?.score === entry.score ? previous.rank : index + 1;
  });
  return { version: priorityVersion, ranking };
}

export type PriorityResult = ReturnType<typeof rankPriorities>;
