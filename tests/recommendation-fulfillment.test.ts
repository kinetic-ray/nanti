import { describe, expect, it } from 'vitest';
import { planRecommendationFulfillment, recommendationNotificationCopy } from '../server/recommendation-fulfillment.js';

const request = {
  id: 'request-1', ownerId: 'owner-1', productKey: 'product-hash',
  status: 'pending' as const, fulfilledAt: null,
};
describe('recommendation fulfillment planning', () => {
  it('does not fulfill when no matching alternative exists', () => {
    expect(planRecommendationFulfillment(request, [], new Set())).toEqual({ fulfill: false, notices: [] });
  });
  it('deduplicates matches and previously notified alternatives', () => {
    expect(planRecommendationFulfillment(request, ['a', 'a', 'b', 'c'], new Set(['b']))).toEqual({
      fulfill: true,
      notices: [
        { requestId: 'request-1', ownerId: 'owner-1', productId: 'a' },
        { requestId: 'request-1', ownerId: 'owner-1', productId: 'c' },
      ],
    });
  });
  it('does not re-fulfill completed requests', () => {
    expect(planRecommendationFulfillment({ ...request, status: 'fulfilled' }, ['a'], new Set()))
      .toEqual({ fulfill: false, notices: [] });
  });
  it('does not promise guest notification delivery', () => {
    expect(recommendationNotificationCopy(false)).toContain('Masuk dengan akun');
    expect(recommendationNotificationCopy(true)).toContain('Kami kabari');
  });
});
