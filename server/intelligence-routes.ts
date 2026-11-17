import { Router } from 'express';
import type { Response } from 'express';
import { evaluateImpulse } from '../shared/impulse.js';
import { getMethodology } from '../shared/methodology.js';
import { evaluateTiming } from '../shared/purchase-timing.js';
import { comparisonAlternatives, evaluateComparison } from '../shared/value-ranker.js';
import type { AssessmentKind, SavedPayload } from '../shared/intelligence.js';
import type { Item, WishlistSummary } from '../shared/wishlist.js';
import { getPurchaseCost } from './intelligence.js';
import type { AssessmentScope, IntelligenceRepository } from './intelligence.js';
import {
  algorithmVersion, comparisonBody, historyQuery, id, impulseBody, methodologyModule, preferenceBody, timingBody,
} from './intelligence-validation.js';
import type { WishlistRepository } from './wishlist.js';

type Locals = { ownerId: string; list: WishlistSummary & { items: Item[] }; item?: Item };
type ScopedResponse = Response<unknown, Locals>;

function missing(res: Response) {
  res.status(404).json({ error: 'This wishlist, product, or assessment could not be found.', code: 'not_found' });
}

function scope(res: ScopedResponse, kind: AssessmentKind): AssessmentScope {
  const { ownerId, list, item } = res.locals;
  return { ownerId, wishlistId: list.id, itemId: item?.id ?? null, kind };
}

export function intelligenceRoutes(wishlists: WishlistRepository, repository: IntelligenceRepository) {
  const api = Router();
  const listApi = Router({ mergeParams: true });
  const itemApi = Router({ mergeParams: true });

  api.get(['/methodology/:module', '/methodology/:module/:version'], (req, res) => {
    const version = algorithmVersion.optional().parse(req.params.version);
    const methodology = getMethodology(methodologyModule.parse(req.params.module), version);
    if (!methodology) {
      res.status(404).json({ error: 'This methodology version could not be found.', code: 'not_found' });
      return;
    }
    res.json(methodology);
  });
  api.get('/preferences', async (_req, res) => {
    res.json(await repository.preferences(res.locals.ownerId));
  });
  api.put('/preferences', async (req, res) => {
    await repository.setPreferences(res.locals.ownerId, preferenceBody.parse(req.body));
    res.sendStatus(204);
  });

  api.use('/wishlists/:listId', listApi);
  listApi.use(async (req, res: ScopedResponse, next) => {
    const list = await wishlists.find(res.locals.ownerId, id.parse(req.params.listId));
    if (!list) return missing(res);
    res.locals.list = list;
    next();
  });
  listApi.use('/items/:itemId', itemApi);
  itemApi.use((req, res: ScopedResponse, next) => {
    const itemId = id.parse(req.params.itemId);
    const item = res.locals.list.items.find((entry) => entry.id === itemId);
    if (!item) return missing(res);
    res.locals.item = item;
    next();
  });

  async function save(res: ScopedResponse, payload: SavedPayload) {
    const record = await repository.save(scope(res, payload.kind), payload);
    if (!record) return missing(res);
    res.status(201).json(record);
  }

  function history(router: Router, path: string, kind: AssessmentKind) {
    router.get(path, async (req, res: ScopedResponse) => {
      res.json(await repository.history(scope(res, kind), historyQuery.parse(req.query).before));
    });
    router.delete(`${path}/:assessmentId`, async (req, res: ScopedResponse) => {
      if (!await repository.remove(scope(res, kind), id.parse(req.params.assessmentId))) return missing(res);
      res.sendStatus(204);
    });
  }

  history(itemApi, '/impulse', 'impulse');
  itemApi.post('/impulse', async (req, res: ScopedResponse) => {
    const input = impulseBody.parse(req.body);
    const { coolingOffDays } = await repository.preferences(res.locals.ownerId);
    await save(res, { kind: 'impulse', input, result: evaluateImpulse(input, coolingOffDays) });
  });

  history(listApi, '/comparisons', 'comparison');
  listApi.post('/comparisons', async (req, res: ScopedResponse) => {
    const input = comparisonBody.parse(req.body);
    const ids = new Set(res.locals.list.items.map((item) => item.id));
    if (input.alternatives.some(({ itemId }) => !ids.has(itemId))) return missing(res);
    const result = evaluateComparison(input.criteria, comparisonAlternatives(input, res.locals.list.items));
    await save(res, { kind: 'comparison', input, result });
  });

  for (const router of [listApi, itemApi]) {
    router.post('/timing', (req, res: ScopedResponse) => {
      const { item, list } = res.locals;
      const input = timingBody.parse(req.body);
      const { known, complete } = getPurchaseCost(item ? [item] : list.items);
      if (input.purchaseMinor !== undefined && (complete || BigInt(input.purchaseMinor) < known)) {
        res.status(400).json({
          code: 'invalid_purchase_cost',
          error: complete ? 'Use the saved purchase price. Reload if the price changed.' :
            'Enter the full purchase cost, including the prices already saved.',
        });
        return;
      }
      res.json(evaluateTiming({ ...input, purchaseMinor: complete ? known.toString() : input.purchaseMinor },
        new Date().toISOString().slice(0, 10)));
    });
  }
  return api;
}
