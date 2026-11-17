import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { currencies, parsePrice, safeProductUrl } from '../shared/wishlist.js';
import type { Currency, Item, ItemInput, WishlistSummary } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { useLocale } from './locale.js';

export function Dialog({ title, busy, close, children, className, focusHeading = false }: {
  title: string; busy: boolean; close: () => void; children: ReactNode;
  className?: string; focusHeading?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const heading = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    if (focusHeading) titleRef.current?.focus();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [focusHeading]);
  return (
    <dialog ref={ref} className={className} aria-labelledby={heading} onCancel={(event) => {
      event.stopPropagation();
      event.preventDefault();
      if (!busy) close();
    }}>
      <h2 ref={titleRef} id={heading} tabIndex={focusHeading ? -1 : undefined}>{title}</h2>
      {children}
    </dialog>
  );
}

export function ListForm({ list, close, save }: {
  list?: WishlistSummary;
  close: () => void;
  save: (name: string, currency: Currency) => Promise<void>;
}) {
  const { t, error: localError } = useLocale();
  const [name, setName] = useState(list?.name ?? '');
  const [currency, setCurrency] = useState<Currency>(list?.currency ?? 'IDR');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!name.trim()) { setError('Enter a wishlist name.'); return; }
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
    <Dialog title={t(list ? 'Rename wishlist' : 'New wishlist')} busy={busy} close={close}>
      <form noValidate onSubmit={submit}>
        <label>{t('Wishlist name')}<input required maxLength={100} value={name}
          onChange={(event) => setName(event.target.value)} /></label>
        {!list && <label>{t('Currency')}<select value={currency}
          onChange={(event) => setCurrency(event.target.value as Currency)}>
          {currencies.map((code) => <option key={code}>{code}</option>)}
        </select></label>}
        {error && <p role="alert" className="error">{localError(error)}</p>}
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={close}>{t('Cancel')}</button>
          <button className="primary" disabled={busy}>{t(busy ? 'Saving…' : 'Save wishlist')}</button>
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
  const { t, decimal, error: localError } = useLocale();
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
      setLookup(errorMessage(failure));
    } finally {
      setLooking(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!name.trim()) { setError('Enter a product name.'); return; }
    if (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 999) {
      setError('Enter a whole number from 1 to 999.'); return;
    }
    const priceMinor = parsePrice(decimal(price));
    if (price.trim() && priceMinor === null) {
      setError('Enter a price up to 9,999,999.99 with at most two decimal places.');
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
    <Dialog title={t(item ? 'Edit product' : 'Add product')} busy={busy} close={close}>
      <form noValidate onSubmit={submit}>
        <label>{t('Product link')} <span className="optional">{t('(optional)')}</span>
          <input type="url" value={url} maxLength={2048} placeholder="https://"
            disabled={looking} onChange={(event) => { setUrl(event.target.value); setLookup(''); }} />
        </label>
        <button type="button" className="lookup" disabled={looking || busy || !url.trim()} onClick={findProduct}>
          {t(looking ? 'Looking up…' : 'Look up product name')}
        </button>
        <p className="hint lookup-status" role="status">{lookup && localError(lookup)}</p>
        <label>{t('Product name')}<input required maxLength={160} value={name}
          onChange={(event) => setName(event.target.value)} /></label>
        <div className="fields">
          <label>{t('Unit price ({currency})', { currency })} <span className="optional">{t('(optional)')}</span>
            <input inputMode="decimal" maxLength={10} value={price}
              onChange={(event) => setPrice(event.target.value)} />
          </label>
          <label>{t('Quantity')}<input type="number" min={1} max={999} step={1} required value={quantity}
            onChange={(event) => setQuantity(event.target.value)} /></label>
        </div>
        {error && <p role="alert" className="error">{localError(error)}</p>}
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={close}>{t('Cancel')}</button>
          <button className="primary" disabled={busy || looking}>{t(busy ? 'Saving…' : 'Save product')}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteForm({ name, wishlist, close, remove }: {
  name: string; wishlist: boolean; close: () => void; remove: () => Promise<void>;
}) {
  const { t, error: localError } = useLocale();
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
    <Dialog title={t(wishlist ? 'Delete wishlist?' : 'Remove product?')} busy={busy} close={close}>
      <form onSubmit={submit}>
        <p>{t(wishlist ? '“{name}” and all its products will be deleted.' : '“{name}” will be removed from this wishlist.', { name })}</p>
        {error && <p role="alert" className="error">{localError(error)}</p>}
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={close}>{t('Cancel')}</button>
          <button className="danger" disabled={busy}>{t(busy ? 'Removing…' : wishlist ? 'Delete wishlist' : 'Remove product')}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function PrivacyForm({ close, cleared }: { close: () => void; cleared: () => void }) {
  const { t, error: localError } = useLocale();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancel = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (confirm) cancel.current?.focus(); }, [confirm]);
  async function clear() {
    setBusy(true);
    setError('');
    try {
      await api('/intelligence/data', { method: 'DELETE' });
      cleared();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally { setBusy(false); }
  }
  return <Dialog title={t(confirm ? 'Clear all assessment data?' : 'Privacy and history')} busy={busy} close={close} focusHeading>
    <p>{t('Saved assessments expire after 365 days. Access is tied to this browser.')}</p>
    {confirm && <p>{t('This clears your saved assessments and waiting preference. Your wishlists and products stay here.')}</p>}
    {error && <p role="alert" className="error">{localError(error)}</p>}
    <div className="form-actions">
      <button ref={cancel} disabled={busy} onClick={close}>{t(confirm ? 'Cancel' : 'Close')}</button>
      <button className={confirm ? 'danger' : undefined} disabled={busy} onClick={() => confirm ? void clear() : setConfirm(true)}>
        {t(busy ? 'Removing…' : 'Clear assessment data')}
      </button>
    </div>
  </Dialog>;
}
