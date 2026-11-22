/**
 * Deterministic candidate ranking for Superadmin-curated alternatives.
 * No network calls or external AI API. All inputs must be validated at the API boundary.
 * Prices must be verified and denominated in the same currency and minor units.
 */
export interface RecommendationProduct {
  id: string;
  title: string;
  category: string | null;
  color?: string | null;
  style?: string | null;
  useCase?: string | null;
  description?: string | null;
  priceMinor: number | null;
  currency: string;
  priceVerified: boolean;
  published: boolean;
  url: string;
  priority?: number;
}
export interface RecommendationMatch {
  product: RecommendationProduct;
  score: number;
  reasons: string[];
}
export interface RecommendationOptions {
  limit?: number;
  manuallyLinkedIds?: readonly string[];
}
const synonyms: Record<string, string> = {
  sneakers: 'sneaker', shoes: 'shoe', trainers: 'sneaker', trainerss: 'sneaker',
  sepatu: 'shoe', putih: 'white', hitam: 'black', kasual: 'casual',
  running: 'runner', runners: 'runner', lifestyle: 'casual',
  chunky: 'chunky', retro: 'retro', sporty: 'sport',
};
function tokens(value: string): string[] {
  return (value.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [])
    .map(word => synonyms[word] ?? word)
    .filter(word => word.length > 1);
}
function norm(value: string | null | undefined): string {
  return tokens(value ?? '').join(' ');
}
function vectorize(documents: string[]): Map<string, number>[] {
  const docs = documents.map(doc => tokens(doc));
  const df = new Map<string, number>();
  for (const doc of docs) for (const token of new Set(doc)) df.set(token, (df.get(token) ?? 0) + 1);
  return docs.map(doc => {
    const tf = new Map<string, number>();
    for (const token of doc) tf.set(token, (tf.get(token) ?? 0) + 1);
    const weighted = new Map<string, number>();
    let lengthSquared = 0;
    for (const [token, count] of tf) {
      const weight = (1 + Math.log(count)) * (Math.log((docs.length + 1) / ((df.get(token) ?? 0) + 1)) + 1);
      weighted.set(token, weight);
      lengthSquared += weight * weight;
    }
    const magnitude = Math.sqrt(lengthSquared);
    for (const [token, weight] of weighted) weighted.set(token, magnitude ? weight / magnitude : 0);
    return weighted;
  });
}
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let result = 0;
  for (const [key, weight] of a) result += weight * (b.get(key) ?? 0);
  return result;
}
function content(product: RecommendationProduct): string {
  return [product.title, product.category, product.color, product.style, product.useCase, product.description]
    .filter(Boolean).join(' ');
}
function safeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname.toLowerCase()) &&
      !url.hostname.endsWith('.localhost');
  } catch { return false; }
}
/**
 * Only candidates with a known, verified cheaper price are eligible.
 * URL safety here is defense in depth, NOT a replacement for SSRF-safe import
 * and outbound-link validation at the server boundary.
 */
export function rankAlternatives(
  source: RecommendationProduct,
  candidates: readonly RecommendationProduct[],
  options: RecommendationOptions = {},
): RecommendationMatch[] {
  if (!source.category || !Number.isSafeInteger(source.priceMinor) || (source.priceMinor ?? 0) <= 0) return [];
  const category = norm(source.category);
  if (!category) return [];
  const eligible = candidates.filter(item =>
    item.id !== source.id && item.published && item.priceVerified &&
    Number.isSafeInteger(item.priceMinor) && (item.priceMinor ?? 0) > 0 &&
    (item.priceMinor ?? Infinity) < (source.priceMinor ?? 0) &&
    item.currency === source.currency && norm(item.category) === category &&
    safeHttpsUrl(item.url),
  );
  const vectors = vectorize([content(source), ...eligible.map(content)]);
  const manual = new Set(options.manuallyLinkedIds ?? []);
  const results = eligible.map((product, index) => {
    const similarity = cosine(vectors[0], vectors[index + 1]);
    const color = !!norm(source.color) && norm(source.color) === norm(product.color);
    const style = !!norm(source.style) && norm(source.style) === norm(product.style);
    const useCase = !!norm(source.useCase) && norm(source.useCase) === norm(product.useCase);
    const explicit = manual.has(product.id);
    const score = similarity * 0.45 + Number(color) * 0.15 + Number(style) * 0.15 +
      Number(useCase) * 0.15 + Number(explicit) * 0.1;
    const reasons = [
      ...(color ? ['Warna serupa'] : []),
      ...(style ? ['Gaya serupa'] : []),
      ...(useCase ? ['Kegunaan serupa'] : []),
      'Harga terverifikasi lebih rendah',
    ];
    return { product, score, reasons, explicit };
  }).filter(match => match.explicit || match.score >= 0.25);
  results.sort((a, b) => b.score - a.score ||
    (b.product.priority ?? 0) - (a.product.priority ?? 0) ||
    a.product.id.localeCompare(b.product.id));
  return results.slice(0, Math.max(0, Math.min(3, Math.floor(options.limit ?? 3))))
    .map(({ product, score, reasons }) => ({ product, score, reasons }));
}
