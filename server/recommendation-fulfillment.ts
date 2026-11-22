/**
 * Pure decision rules shared by request fulfillment and in-app notification delivery.
 * Persistence and authorization must be enforced by the calling repository/API.
 */
export type RecommendationRequestStatus = 'pending' | 'fulfilled';
export interface PendingRecommendationRequest {
  id: string;
  ownerId: string;
  productKey: string;
  status: RecommendationRequestStatus;
  fulfilledAt: Date | null;
}
export interface RecommendationNoticeDraft {
  requestId: string;
  ownerId: string;
  productId: string;
}
/** A request is only fulfilled when at least one published, validated match exists. */
export function planRecommendationFulfillment(
  request: PendingRecommendationRequest,
  matchedProductIds: readonly string[],
  existingNotifiedProductIds: ReadonlySet<string>,
): { fulfill: boolean; notices: RecommendationNoticeDraft[] } {
  if (request.status !== 'pending' || !matchedProductIds.length) {
    return { fulfill: false, notices: [] };
  }
  const unique = [...new Set(matchedProductIds)].filter(id => id && !existingNotifiedProductIds.has(id));
  return {
    fulfill: true,
    notices: unique.map(productId => ({ requestId: request.id, ownerId: request.ownerId, productId })),
  };
}
/** Consumers should never be promised a notification unless a persistent account can receive it. */
export function recommendationNotificationCopy(hasAccount: boolean): string {
  return hasAccount
    ? 'Kami kabari lewat Nanti kalau sudah ada alternatif yang cocok.'
    : 'Permintaanmu tercatat. Masuk dengan akun agar kamu bisa mendapat kabar di Nanti.';
}
