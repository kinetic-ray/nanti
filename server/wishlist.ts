import type { Currency, Item, ItemWriteInput, WishlistSummary } from '../shared/wishlist.js';

export type ScopedWishlist = WishlistSummary & { items: Item[]; scopeId?: string };

export interface WishlistRepository {
  list(ownerId: string): Promise<WishlistSummary[]>;
  find(ownerId: string, id: string): Promise<ScopedWishlist | null>;
  create(ownerId: string, data: { name: string; currency: Currency }, guest?: boolean): Promise<WishlistSummary>;
  rename(ownerId: string, id: string, name: string): Promise<boolean>;
  remove(ownerId: string, id: string): Promise<boolean>;
  addItem(ownerId: string, listId: string, data: ItemWriteInput, requestId?: string, photo?: Buffer): Promise<boolean>;
  updateItem(ownerId: string, listId: string, id: string, data: ItemWriteInput): Promise<boolean>;
  removeItem(ownerId: string, listId: string, id: string): Promise<boolean>;
}

export async function readWishlist(repository: WishlistRepository, ownerId: string, id: string) {
  const list = await repository.find(ownerId, id);
  if (!list) return null;

  let totalMinor = 0n;
  let unpriced = 0;
  for (const item of list.items) {
    if (item.priceMinor === null) unpriced++;
    else totalMinor += BigInt(item.priceMinor) * BigInt(item.quantity);
  }
  const { id: listId, name, currency, items } = list;
  return { id: listId, name, currency, items, totalMinor: totalMinor.toString(), unpriced };
}
