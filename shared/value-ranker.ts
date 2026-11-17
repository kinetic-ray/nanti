export const comparisonVersion = '1.0.0';
export const comparisonLimits = { alternatives: 6, criteria: 6, note: 60, name: 40, weight: 100, rating: 10 };

export type Criterion = { id: string; name: string; kind: 'price' | 'benefit' | 'cost'; weight: number };
export type Rating = { value: number | null; note: string };
export type ComparisonInput = {
  criteria: Criterion[];
  alternatives: { itemId: string; ratings: Record<string, Rating> }[];
};
export type ComparisonAlternative = { id: string; values: Record<string, number | null> };
type RankedOption = { id: string; score: number; rank: number };

// Rounded to nine decimal places for stable equality and displayed with less precision.
function scoreOptions(alternatives: ComparisonAlternative[], normalized: (number | null)[][], weights: number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!total || normalized.some((row) => row.some((value, index) => value === null && (weights[index] ?? 0) > 0))) {
    return null;
  }
  const sorted = alternatives.map(({ id }, index) => {
    const score = normalized[index]!.reduce<number>((sum, value, criterion) =>
      sum + (value ?? 0) * (weights[criterion]! / total), 0);
    return { id, score: Number(score.toFixed(9)), rank: 0 };
  }).sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1));
  sorted.forEach((option, index) => {
    const previous = sorted[index - 1];
    option.rank = previous?.score === option.score ? previous.rank : index + 1;
  });
  return sorted;
}

export function comparisonAlternatives(input: ComparisonInput, items: { id: string; priceMinor: number | null }[]) {
  const prices = new Map(items.map(({ id, priceMinor }) => [id, priceMinor]));
  return input.alternatives.map(({ itemId, ratings }) => ({
    id: itemId,
    values: Object.fromEntries(input.criteria.map(({ id, kind }) =>
      [id, kind === 'price' ? prices.get(itemId) ?? null : ratings[id]?.value ?? null])),
  }));
}

export function evaluateComparison(criteria: Criterion[], alternatives: ComparisonAlternative[]) {
  const weights = criteria.map(({ weight }) => weight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const ranges = criteria.map(({ id }) => {
    const values = alternatives.map(({ values }) => values[id] ?? null);
    const known = values.filter((value): value is number => value !== null);
    return known.length === values.length && known.length > 0
      ? { minimum: Math.min(...known), maximum: Math.max(...known) } : null;
  });
  const normalized = alternatives.map(({ values }) => criteria.map(({ id, kind }, index) => {
    const range = ranges[index];
    const value = values[id] ?? null;
    if (!range || value === null) return null;
    const { minimum, maximum } = range;
    if (minimum === maximum) return 1;
    return (kind === 'benefit' ? value - minimum : maximum - value) / (maximum - minimum);
  }));
  const ranking = alternatives.length >= 2 ? scoreOptions(alternatives, normalized, weights) : null;
  const sensitivity: { criterionId: string; weight: number; ranking: RankedOption[] }[] = [];
  if (ranking) {
    const current = ranking.map(({ id, rank }) => `${id}:${rank}`).join();
    criteria.forEach(({ id, weight }, index) => {
      for (const trial of [0, comparisonLimits.weight]) {
        if (trial === weight) continue;
        const changed = scoreOptions(alternatives, normalized, weights.map((entry, slot) => slot === index ? trial : entry));
        if (changed && changed.map((entry) => `${entry.id}:${entry.rank}`).join() !== current) {
          sensitivity.push({ criterionId: id, weight: trial, ranking: changed });
        }
      }
    });
  }
  return {
    version: comparisonVersion,
    ranking,
    status: alternatives.length < 2 ? 'not-enough-products' : !total ? 'no-weights' : ranking ? 'ranked' : 'missing-data',
    sensitivity,
    breakdown: alternatives.map(({ id, values }, row) => ({
      id,
      criteria: criteria.map((criterion, column) => {
        const value = normalized[row]?.[column] ?? null;
        return {
          id: criterion.id,
          input: values[criterion.id] ?? null,
          normalized: value,
          contribution: criterion.weight === 0 ? 0 : value === null ? null : value * (criterion.weight / total),
        };
      }),
    })),
  } as const;
}

export type ComparisonResult = ReturnType<typeof evaluateComparison>;
