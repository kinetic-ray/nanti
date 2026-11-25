import type { ProductImport } from '../shared/product-import.js';

const maxScriptBytes = 512 * 1024;
const imageOrigin = 'https://down-id.img.susercontent.com/file/';

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function rows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function id(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  return typeof value === 'string' && /^[1-9]\d{0,19}$/u.test(value) ? value : undefined;
}

function label(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() && value.trim().length <= 160 ? value.trim() : undefined;
}

function image(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z\d][a-z\d_-]{0,127}$/iu.test(value) ? imageOrigin + value : undefined;
}

export function readShopeeEmbeddedState(source: string, shopId: string, itemId: string) {
  if (Buffer.byteLength(source) > maxScriptBytes) return null;
  let json: unknown;
  try { json = JSON.parse(source); } catch { return null; }
  const state = object(object(json)?.initialState);
  const context = object(object(state?.DOMAIN_CONTEXT)?.data);
  if (id(context?.shopId) !== shopId || id(context?.itemId) !== itemId) return null;
  const pdp = object(object(state?.DOMAIN_PDP)?.data);
  const cache = object(object(pdp?.PDP_BFF_DATA)?.cachedMap);
  const entry = object(cache?.[shopId + '/' + itemId]);
  const item = object(entry?.item);
  if (!item || id(item.shop_id) !== shopId || id(item.item_id) !== itemId) return null;

  const photos = object(entry?.product_images);
  const gallery = [...new Set([...rows(item.images), ...rows(photos?.images)]
    .flatMap(value => image(value) ?? []))];
  const primary = image(item.image) ?? gallery[0];
  const modelIds = new Set<string>();
  const models: NonNullable<ProductImport['shopeeDetails']>['models'] = [];
  for (const value of rows(item.models)) {
    const model = object(value);
    const modelId = id(model?.model_id);
    const name = model?.name === '' ? '' : label(model?.name);
    if (!modelId || name === undefined || (model?.item_id !== undefined && id(model.item_id) !== itemId)) continue;
    if (modelIds.has(modelId)) return null;
    modelIds.add(modelId);
    models.push({ id: modelId, name });
  }
  const tiers = rows(item.tier_variations).flatMap(value => {
    const tier = object(value);
    const name = label(tier?.name);
    const options = rows(tier?.options).map(label);
    return name && options.length && options.every(option => option !== undefined) ? [{ name, options }] : [];
  });
  if (models.length === 1 && models[0]?.name === '') tiers.length = 0;

  const shop = object(entry?.shop_detailed);
  const sellers = new Set<string>();
  const shopName = id(shop?.shopid ?? shop?.shop_id) === shopId ? label(shop?.name) : undefined;
  if (shopName) sellers.add(shopName);
  for (const value of [...rows(item.shop_vouchers), ...rows(entry?.shop_vouchers)]) {
    const voucher = object(value);
    const name = id(voucher?.shop_id) === shopId ? label(voucher?.shop_name) : undefined;
    if (name) sellers.add(name);
  }
  const title = label(item.title) ?? label(item.name);
  if (!title && !primary && !models.length && sellers.size !== 1) return null;
  return { title, image: primary, sellers, details: { gallery, tiers, models } };
}
