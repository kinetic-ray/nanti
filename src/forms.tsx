import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { currencies, parsePrice } from '../shared/wishlist.js';
import type { Currency, Item, ItemWriteInput, WishlistSummary } from '../shared/wishlist.js';
import { safeImportUrl } from '../shared/product-import.js';
import type { ProductImport } from '../shared/product-import.js';
import { api, errorMessage } from './api.js';
import { useLocale } from './locale.js';

export function Dialog({ title, busy, close, children, className, focusHeading = false, headerAction }: {
  title: string; busy: boolean; close: () => void; children: ReactNode;
  className?: string; focusHeading?: boolean; headerAction?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const heading = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    const viewport = window.visualViewport;
    const updateViewport = () => {
      if (!viewport || viewport.scale !== 1) {
        dialog.style.removeProperty('--dialog-view-height');
        dialog.style.removeProperty('--dialog-keyboard-inset');
        return;
      }
      dialog.style.setProperty('--dialog-view-height', `${viewport.height}px`);
      dialog.style.setProperty('--dialog-keyboard-inset', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
    };
    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    dialog.showModal();
    if (focusHeading) titleRef.current?.focus();
    return () => {
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [focusHeading]);
  return (
    <dialog ref={ref} className={className} aria-labelledby={heading} onCancel={(event) => {
      event.stopPropagation();
      event.preventDefault();
      if (!busy) close();
    }}>
      <div className="dialog-header">
        <h2 ref={titleRef} id={heading} tabIndex={focusHeading ? -1 : undefined}>{title}</h2>
        {headerAction}
      </div>
      <div className="dialog-content">{children}</div>
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
  save: (data: ItemWriteInput) => Promise<void>;
}) {
  const { t, decimal, money, language, error: localError } = useLocale();
  const [url, setUrl] = useState(item?.url ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item?.priceMinor == null ? '' : (item.priceMinor / 100).toFixed(2));
  const [quantity, setQuantity] = useState(item?.quantity.toString() ?? '1');
  const [lookup, setLookup] = useState('');
  const [preview, setPreview] = useState<ProductImport | null>(null);
  const [showDetails, setShowDetails] = useState(Boolean(item));
  const [importedName, setImportedName] = useState(false);
  const [importedPrice, setImportedPrice] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [manualImageUrl, setManualImageUrl] = useState('');
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const pastePending = useRef(false);

  function chooseImage(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP image smaller than 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') { setUploadedImage(reader.result); setError(''); } };
    reader.readAsDataURL(file);
  }

  function setLink(value: string) {
    setUrl(value);
    setLookup('');
    setPreview(null);
    if (importedPrice) { setImportedPrice(false); setPrice(''); }
    if (importedName) { setImportedName(false); setName(''); }
  }

  async function findProduct(value: string, replaced = false) {
    setLookup('');
    setPreview(null);
    setImageFailed(false);
    const parsed = safeImportUrl(value.trim());
    if (!parsed) {
      setLookup('Enter a valid product link or fill in the details below.');
      return;
    }
    setLooking(true);
    try {
      const result = await api<ProductImport>('/products/import', {
        method: 'POST', data: { url: parsed.href },
      });
      setPreview(result);
      if (result.name && (!name.trim() || (replaced && importedName))) {
        setName(result.name);
        setImportedName(true);
      }
      if (result.price?.currency === currency && (!price.trim() || (replaced && importedPrice))) {
        const value = (result.price.priceMinor / 100).toFixed(2);
        setPrice(language === 'id' ? value.replace('.', ',') : value);
        setImportedPrice(true);
      }
      setLookup(result.status === 'manual_required' ? 'The link is ready to save. Add a name to finish.'
        : 'Review the product details before saving.');
    } catch (failure) {
      setLookup(errorMessage(failure));
    } finally {
      setShowDetails(true);
      setLooking(false);
      if (!item) requestAnimationFrame(() => nameInput.current?.focus());
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (looking || busy) return;
    if (!showDetails && url.trim()) { await findProduct(url); return; }
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
    const parsed = url.trim() ? safeImportUrl(url.trim()) : null;
    if (url.trim() && !parsed) {
      setError('Enter a valid HTTP or HTTPS product link, or leave it blank.');
      return;
    }
    setBusy(true);
    try {
      await save({ name, url: parsed?.href ?? null, priceMinor, quantity: Number(quantity),
        ...(importedPrice && priceMinor !== null && { priceSource: 'imported_unverified' }) });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t(item ? 'Edit product' : 'Add product')} busy={busy} close={close} className="import-dialog">
      <form noValidate autoComplete="off" onSubmit={submit}>
        <label>{t(item ? 'Product link' : 'Paste a product link')}
          <input type="url" name="product-url" value={url} maxLength={2048} placeholder="https://…" spellCheck={false}
            disabled={looking || busy} onChange={(event) => {
              const value = event.target.value;
              const pasted = pastePending.current;
              pastePending.current = false;
              setLink(value);
              if (pasted && safeImportUrl(value.trim())) void findProduct(value, true);
            }} onPaste={() => {
              if (item) return;
              pastePending.current = true;
              // If the browser made no change, do not treat the next keystroke as paste.
              setTimeout(() => { pastePending.current = false; }, 0);
            }} />
        </label>
        {!showDetails && <p className="hint">{t('Use a link from Shopee, Tokopedia, IKEA, or another store.')}</p>}
        {(!preview || preview.originalUrl !== url) && <div className="actions">
          <button type="button" className={showDetails ? 'lookup' : 'primary'} disabled={looking || busy || !url.trim()}
            onClick={() => void findProduct(url)}>{t(looking ? 'Looking up…' : 'Check product link')}</button>
          {!showDetails && <button type="button" onClick={() => {
            setShowDetails(true);
            requestAnimationFrame(() => nameInput.current?.focus());
          }} disabled={looking}>
            {t('Enter details myself')}
          </button>}
        </div>}
        {(lookup || looking) && <p className="hint" role="status">{looking ? t('Looking up…') : localError(lookup)}</p>}
        {preview && <div className={preview.status === 'manual_required' ? 'import-fallback' : 'import-preview'}>
          {preview.imagePath && !imageFailed && <img src={preview.imagePath} alt="" width="80" height="64"
            decoding="async" onError={() => setImageFailed(true)} />}
          <div>
            <p className="hint">{t('Store detected: {merchant}', { merchant: {
              shopee: 'Shopee', tokopedia: 'Tokopedia', ikea: 'IKEA', other: preview.hostname,
            }[preview.merchant] })}</p>
            {preview.name && <strong>{preview.name}</strong>}
            {preview.price && <p>{money(preview.price.priceMinor, preview.price.currency)}</p>}
            {preview.status !== 'manual_required' && <p className="hint">{t('From the store page · unverified')}</p>}
            {preview.price && preview.price.currency !== currency &&
              <p className="hint">{t('The store uses {currency}. Enter a price in your wishlist’s currency if you want to save one.',
                { currency: preview.price.currency })}</p>}
          </div>
        </div>}
        {showDetails && <>
          <div className="product-image-editor">
            <input ref={uploadInput} type="file" accept="image/jpeg,image/png,image/webp"
              className="product-image-file" aria-label="Upload product image"
              onChange={event => chooseImage(event.target.files?.[0])} />
            <button type="button" className="product-image-placeholder"
              aria-label="Choose a product image from your device"
              disabled={busy || looking} onClick={() => uploadInput.current?.click()}>
              {uploadedImage || manualImageUrl || (preview?.imagePath && !imageFailed)
                ? <img src={uploadedImage || manualImageUrl || preview?.imagePath || ''}
                    alt="Product preview" onError={() => { setManualImageUrl(''); setImageFailed(true); }} />
                : <span aria-hidden="true">＋<small>Image</small></span>}
            </button>
            <div className="product-image-url">
              <label>Image URL <span className="optional">(optional)</span>
                <input type="url" value={manualImageUrl} placeholder="https://example.com/product.jpg"
                  disabled={busy || looking} onChange={event => { setManualImageUrl(event.target.value); setUploadedImage(null); }} />
              </label>
              <p className="hint">Tap the image to upload, or paste an image URL. Image selection is a preview only until saving is supported.</p>
              {(uploadedImage || manualImageUrl) && <button type="button" onClick={() => { setUploadedImage(null); setManualImageUrl(''); if (uploadInput.current) uploadInput.current.value = ''; }}>Remove image</button>}
            </div>
          </div>
          <label>{t('Product name')}<input ref={nameInput} name="product-name" required maxLength={160} value={name} disabled={looking || busy}
            onChange={(event) => { setName(event.target.value); setImportedName(false); }} /></label>
          <div className="fields">
          <label>{t('Unit price ({currency})', { currency })} <span className="optional">{t('(optional)')}</span>
            <input name="unit-price" inputMode="decimal" maxLength={10} value={price} disabled={looking || busy}
              onChange={(event) => { setPrice(event.target.value); setImportedPrice(false); }} />
          </label>
          <label>{t('Quantity')}<input name="quantity" type="number" min={1} max={999} step={1} required value={quantity} disabled={looking || busy}
            onChange={(event) => setQuantity(event.target.value)} /></label>
          </div>
        </>}
        {error && <p role="alert" className="error">{localError(error)}</p>}
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={close}>{t('Cancel')}</button>
          {showDetails && <button className="primary" disabled={busy || looking}>{t(busy ? 'Saving…' : 'Save product')}</button>}
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

export function PrivacyForm({ close, cleared, signedIn }: { close: () => void; cleared: () => void; signedIn: boolean }) {
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
    <p>{t(signedIn ? 'Saved assessments expire after 365 days. Only your account can access them.' :
      'Saved assessments expire after 365 days. Access is tied to this browser.')}</p>
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
