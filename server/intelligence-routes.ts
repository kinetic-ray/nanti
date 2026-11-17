import { Router } from 'express';
import type { Request, Response } from 'express';
import { evaluateImpulse } from '../shared/impulse.js';
import { getMethodology } from '../shared/methodology.js';
import { evaluateTiming } from '../shared/purchase-timing.js';
import { comparisonAlternatives, evaluateComparison } from '../shared/value-ranker.js';
import type { AssessmentKind, SavedPayload, TimingPlanInput } from '../shared/intelligence.js';
import { getPurchaseQuote, includedProducts } from '../shared/purchase-plan.js';
import type { Item, WishlistSummary } from '../shared/wishlist.js';
import { SaveIntentConflict } from './intelligence.js';
import type { AssessmentScope, FinancialFingerprints, IntelligenceRepository } from './intelligence.js';
import { assessmentChanges, fingerprintFinances, productSnapshot, saveIntent, timingChanges, validatePlan } from './assessment-review.js';
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

export function intelligenceRoutes(wishlists: WishlistRepository, repository: IntelligenceRepository, secret: string) {
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
  api.delete('/data', async (_req, res) => {
    await repository.clear(res.locals.ownerId);
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

  function conflict(res: ScopedResponse) {
    res.status(409).json({ error: 'This save was already used for another assessment.', code: 'save_conflict' });
  }
  function changed(res: ScopedResponse) {
    res.status(409).json({ code: 'inputs_changed', error: 'The saved products changed. Check again before saving.' });
  }

  async function save(req: Request, res: ScopedResponse, kind: AssessmentKind,
    prepare: () => Promise<{ payload: SavedPayload; items: Item[]; financial?: FinancialFingerprints } | null>) {
    const key = id.optional().parse(req.get('Idempotency-Key'));
    const intent = key ? saveIntent(secret, key, req.body) : undefined;
    const target = scope(res, kind);
    if (intent) {
      const prior = await repository.findRequest(target.ownerId, intent.key);
      if (prior) {
        if (prior.requestHash !== intent.hash || prior.kind !== kind || prior.itemId !== target.itemId ||
          prior.wishlistId !== target.wishlistId) return conflict(res);
        res.status(201).json(prior.record);
        return;
      }
    }
    const prepared = await prepare();
    if (!prepared) return;
    try {
      const record = await repository.save(target, prepared.payload, productSnapshot(prepared.items), prepared.financial, intent);
      if (!record) return missing(res);
      res.status(201).json(record);
    } catch (error) {
      if (error instanceof SaveIntentConflict) return conflict(res);
      throw error;
    }
  }

  function history(router: Router, path: string, kind: AssessmentKind) {
    router.get(path, async (req, res: ScopedResponse) => {
      const page = await repository.history(scope(res, kind), historyQuery.parse(req.query).before);
      const { item, list, ownerId } = res.locals;
      const preference = kind === 'impulse' ? (await repository.preferences(ownerId)).coolingOffDays : undefined;
      res.json({ ...page, records: page.records.map((record) => {
        const review = assessmentChanges(record, item ? [item] : list.items, preference);
        return review.length ? { ...record, review } : record;
      }) });
    });
    router.delete(`${path}/:assessmentId`, async (req, res: ScopedResponse) => {
      if (!await repository.remove(scope(res, kind), id.parse(req.params.assessmentId))) return missing(res);
      res.sendStatus(204);
    });
  }

  history(itemApi, '/impulse', 'impulse');
  itemApi.post('/impulse', async (req, res: ScopedResponse) => {
    const input = impulseBody.parse(req.body);
    await save(req, res, 'impulse', async () => {
      const { coolingOffDays } = await repository.preferences(res.locals.ownerId);
      const result = evaluateImpulse(input, coolingOffDays, input.temporary === undefined ? undefined : '1.0.0');
      return { items: [res.locals.item!], payload: { kind: 'impulse', input, result } };
    });
  });

  history(listApi, '/comparisons', 'comparison');
  listApi.post('/comparisons', async (req, res: ScopedResponse) => {
    const { expectedProducts, ...input } = comparisonBody.parse(req.body);
    await save(req, res, 'comparison', async () => {
      const ids = new Set(input.alternatives.map(({ itemId }) => itemId));
      const items = res.locals.list.items.filter(({ id }) => ids.has(id));
      if (expectedProducts && (expectedProducts.length !== items.length || items.length !== ids.size || items.some((item) =>
        !expectedProducts.some((old) => item.id === old.id && item.priceMinor === old.priceMinor && item.quantity === old.quantity)))) {
        changed(res);
        return null;
      }
      if (items.length !== ids.size) { missing(res); return null; }
      const result = evaluateComparison(input.criteria, comparisonAlternatives(input, items));
      return { items, payload: { kind: 'comparison', input, result } };
    });
  });

  async function prepareTiming(res: ScopedResponse, input: TimingPlanInput) {
    const { item, list } = res.locals;
    if (input.reviewId && (input.confirmedCurrent !== true ||
      [input.liquidMinor, input.obligationsMinor, input.reserveMinor].some((value) => value === undefined))) {
      res.status(400).json({ code: 'confirm_finances', error: 'Enter or confirm your current finances before checking again.' });
      return null;
    }
    const items = item ? [item] : list.items;
    const plan = input.plan ?? [];
    const invalid = item && plan.length ? 'invalid_plan_items' : validatePlan(items, plan);
    if (invalid) {
      const errors = {
        invalid_plan_items: 'The purchase selection contains an unavailable or repeated product.',
        invalid_plan_group: 'Each alternative group needs at least two products and at most one selection.',
        empty_plan: 'Include at least one product.',
      };
      res.status(400).json({ code: invalid, error: errors[invalid] });
      return null;
    }
    const selected = includedProducts(items, plan);
    const quote = getPurchaseQuote(selected, input.purchaseMinor);
    if (input.purchaseMinor !== undefined && (!selected.length || quote.source === 'saved' ||
      BigInt(input.purchaseMinor) < BigInt(quote.subtotalMinor))) {
      res.status(400).json({
        code: 'invalid_purchase_cost',
        error: quote.source === 'saved' ? 'Use the saved purchase price. Reload if the price changed.' :
          'Enter the full purchase cost, including the prices already saved.',
      });
      return null;
    }
    const financial = fingerprintFinances(secret, res.locals.ownerId, input);
    const stored = input.reviewId ? await repository.find(scope(res, 'timing'), input.reviewId) : null;
    if (input.reviewId && !stored) { missing(res); return null; }
    const result = evaluateTiming({ ...input, purchaseMinor: quote.source === 'saved' ? quote.subtotalMinor : input.purchaseMinor },
      new Date().toISOString().slice(0, 10));
    const { previewToken, ...previewInput } = input;
    const snapshot = productSnapshot(selected);
    const token = saveIntent(secret, 'timing-preview', [scope(res, 'timing'), previewInput, snapshot, result.asOf]).hash;
    if (previewToken !== undefined && previewToken !== token) {
      changed(res);
      return null;
    }
    return { selected, financial, quote, result, snapshot, token, review: stored ? timingChanges(stored, items, input, financial) : undefined };
  }

  for (const router of [listApi, itemApi]) {
    history(router, '/timing/history', 'timing');
    router.post('/timing', async (req, res: ScopedResponse) => {
      const preview = await prepareTiming(res, timingBody.parse(req.body));
      if (!preview) return;
      const { quote, result, review, snapshot, token } = preview;
      res.json({ ...result, quote, review, snapshot, previewToken: token });
    });
    router.post('/timing/history', async (req, res: ScopedResponse) => {
      const input = timingBody.parse(req.body);
      await save(req, res, 'timing', async () => {
        const prepared = await prepareTiming(res, input);
        if (!prepared) return null;
        const { result: { version, asOf, status, target, missing, totalMinor, months }, quote, selected, financial } = prepared;
        const { plan, purchaseMinor, extraMinor, targetDate } = input;
        return {
          items: selected, financial,
          payload: { kind: 'timing', input: { plan, purchaseMinor, extraMinor, targetDate },
            result: { version, asOf, status, target, missing, totalMinor, months, quote } },
        };
      });
    });
  }
  return api;
}
