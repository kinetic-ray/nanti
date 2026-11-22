import { useState } from 'react';
import { safeProductUrl } from '../shared/wishlist.js';
import type { Item } from '../shared/wishlist.js';
import { isIkeaMetadataLink } from '../shared/product-import.js';

type Glyph = 'plus' | 'edit' | 'trash' | 'arrow' | 'person' | 'privacy' | 'compare' | 'clock' | 'check' | 'close' | 'bookmark' | 'bell' | 'sparkles';

export function Icon({ name }: { name: Glyph }) {
  if (name === 'edit') return <svg className="icon icon-edit-pencil" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4L16.5 3.5Z" /></svg>;
  return <span className={`icon icon-${name}`} aria-hidden="true" />;
}

export function BookmarkArt() {
  return <div className="bookmark-art" aria-hidden="true"><span /><span /><span /></div>;
}

export function Loading({ label }: { label: string }) {
  return <div role="status" className="loading-surface">
    <span className="sr-only">{label}</span>
    <div aria-hidden="true"><i /><i /><i /></div>
  </div>;
}

function ProductPhoto({ src }: { src: string }) {
  const [available, setAvailable] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img src={src} alt="" loading="lazy" decoding="async" className={available ? 'is-ready' : undefined}
    onLoad={() => setAvailable(true)} onError={() => setFailed(true)} />;
}

export function ProductMedia({ item, listId }: { item: Item; listId: string }) {
  const listing = item.url ? safeProductUrl(item.url) : null;
  const supported = listing && isIkeaMetadataLink(listing);
  return <div aria-hidden="true" className="product-media">
    <span>{Array.from(item.name)[0]?.toLocaleUpperCase()}</span>
    {item.imageKey && <ProductPhoto key={item.id} src={`/api/wishlists/${listId}/items/${item.id}/uploaded-image`} />}
    {!item.imageKey && supported && <ProductPhoto key={listing.href} src={`/api/wishlists/${listId}/items/${item.id}/image`} />}
  </div>;
}
