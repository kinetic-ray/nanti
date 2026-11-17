import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { currencies, parsePrice, safeProductUrl } from '../shared/wishlist.js';
import type { Currency, Item, ItemInput, WishlistSummary } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';

function Dialog({ title, busy, close, children }: {
  title: string; busy: boolean; close: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={heading} onCancel={(event) => {
      event.preventDefault();
      if (!busy) close();
    }}>
      <h2 id={heading}>{title}</h2>
      {children}
    </dialog>
  );
}

export function ListForm({ list, close, save }: {
  list?: WishlistSummary;
  close: () => void;
  save: (name: string, currency: Currency) => Promise<void>;
}) {
  const [name, setName] = useState(list?.name ?? '');
  const [currency, setCurrency] = useState<Currency>(list?.currency ?? 'USD');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await save(name, currency);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={list ? 'Rename wishlist' : 'New wishlist'} busy={busy} close={close}>
      <form onSubmit={submit}>
        <label>Wishlist name<input required maxLength={100} value={name}
          onChange={(event) => setName(event.target.value)} /></label>
        {!list && <label>Currency<select value={currency}
          onChange={(event) => setCurrency(event.target.value as Currency)}>
          {currencies.map((code) => <option key={code}>{code}</option>)}
        </select></label>}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={close}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save wishlist'}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function ItemForm({ item, currency, close, save }: {
  item?: Item;
  currency: Currency;
  close: () => void;
  save: (data: ItemInput) => Promise<void>;
}) {
  const [url, setUrl] = useState(item?.url ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item?.priceMinor == null ? '' : (item.priceMinor / 100).toFixed(2));
  const [quantity, setQuantity] = useState(item?.quantity.toString() ?? '1');
  const [lookup, setLookup] = useState('');
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function findProduct() {
    setLookup('');
    const parsed = safeProductUrl(url.trim());
    if (!parsed) {
      setLookup('Enter a valid product link or fill in the details below.');
      return;
    }
    setLooking(true);
    try {
      const result = await api<{ name: string | null }>('/products/preview', {
        method: 'POST', data: { url: parsed.href },
      });
      if (result.name) {
        setName((current) => current.trim() ? current : result.name ?? '');
        setLookup('Product name found. Review the details before saving.');
      } else {
        setLookup('Details are unavailable for this link. Enter them below.');
      }
    } catch (failure) {
      setLookup(`${errorMessage(failure)} You can enter the details below.`);
    } finally {
      setLooking(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const priceMinor = parsePrice(price);
    if (price.trim() && priceMinor === null) {
      setError('Enter a price from 0 to 9999999.99 with up to two decimal places.');
      return;
    }
    const parsed = url.trim() ? safeProductUrl(url.trim()) : null;
    if (url.trim() && !parsed) {
      setError('Enter a valid HTTP or HTTPS product link, or leave it blank.');
      return;
    }
    setBusy(true);
    try {
      await save({ name, url: parsed?.href ?? null, priceMinor, quantity: Number(quantity) });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={item ? 'Edit product' : 'Add product'} busy={busy} close={close}>
      <form onSubmit={submit}>
        <label>Product link <span className="optional">(optional)</span>
          <input type="url" value={url} maxLength={2048} placeholder="https://"
            disabled={looking} onChange={(event) => { setUrl(event.target.value); setLookup(''); }} />
        </label>
        <button type="button" className="lookup" disabled={looking || busy || !url.trim()} onClick={findProduct}>
          {looking ? 'Looking up…' : 'Look up product name'}
        </button>
        <p className="hint lookup-status" role="status">{lookup}</p>
        <label>Product name<input required maxLength={160} value={name}
          onChange={(event) => setName(event.target.value)} /></label>
        <div className="fields">
          <label>Unit price ({currency}) <span className="optional">(optional)</span>
            <input inputMode="decimal" maxLength={10} value={price}
              onChange={(event) => setPrice(event.target.value)} />
          </label>
          <label>Quantity<input type="number" min={1} max={999} step={1} required value={quantity}
            onChange={(event) => setQuantity(event.target.value)} /></label>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={close}>Cancel</button>
          <button className="primary" disabled={busy || looking}>{busy ? 'Saving…' : 'Save product'}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteForm({ name, wishlist, close, remove }: {
  name: string; wishlist: boolean; close: () => void; remove: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await remove();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={wishlist ? 'Delete wishlist?' : 'Remove product?'} busy={busy} close={close}>
      <form onSubmit={submit}>
        <p>{wishlist ? <>“{name}” and all its products will be deleted.</> : <>“{name}” will be removed from this wishlist.</>}</p>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={close}>Cancel</button>
          <button className="danger" disabled={busy}>{busy ? 'Removing…' : wishlist ? 'Delete wishlist' : 'Remove product'}</button>
        </div>
      </form>
    </Dialog>
  );
}
