import type { Currency, Item, ItemInput, WishlistSummary } from '../shared/wishlist.js';

export interface WishlistRepository {
  list(ownerId: string): Promise<WishlistSummary[]>;
  find(ownerId: string, id: string): Promise<(WishlistSummary & { items: Item[] }) | null>;
  create(ownerId: string, data: { name: string; currency: Currency }): Promise<WishlistSummary>;
  rename(ownerId: string, id: string, name: string): Promise<boolean>;
  remove(ownerId: string, id: string): Promise<boolean>;
  addItem(ownerId: string, listId: string, data: ItemInput): Promise<boolean>;
  updateItem(ownerId: string, listId: string, id: string, data: ItemInput): Promise<boolean>;
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
  return { ...list, totalMinor: totalMinor.toString(), unpriced };
}
