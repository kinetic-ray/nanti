import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { currencies, parsePrice } from '../shared/wishlist.js';
import type { Currency, Item, ItemSaveInput, WishlistSummary } from '../shared/wishlist.js';
import { safeImportUrl } from '../shared/product-import.js';
import type { ProductImport } from '../shared/product-import.js';
import { api, errorMessage } from './api.js';
import { useLocale } from './locale.js';
import { formatProductPriceInput, normalizeProductPriceInput } from './product-price-input.js';

const dialogHistoryStack: string[] = [];
let pendingDialogHistoryCleanup = 0;

export function Dialog({ title, busy, close, children, className, focusHeading = false, headerAction, closeOnCancel = true }: {
  title: string; busy: boolean; close: () => void; children: ReactNode;
  className?: string; focusHeading?: boolean; headerAction?: ReactNode; closeOnCancel?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const heading = useId();
  const closeRef = useRef(close);
  const busyRef = useRef(busy);
  closeRef.current = close;
  busyRef.current = busy;
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
    // Give each open dialog its own same-page history entry. Android Back
    // closes the topmost dialog instead of leaving the application.
    const marker = crypto.randomUUID();
    const state = { ...((history.state && typeof history.state === 'object') ? history.state : {}), __nantiDialog: marker };
    history.pushState(state, '', location.href);
    dialogHistoryStack.push(marker);
    let consumed = false;
    const onPopState = () => {
      if (pendingDialogHistoryCleanup > 0) {
        pendingDialogHistoryCleanup--;
        return;
      }
      if (consumed || dialogHistoryStack[dialogHistoryStack.length - 1] !== marker) return;
      if (!busyRef.current) {
        consumed = true;
        closeRef.current();
      } else history.pushState(state, '', location.href);
    };
    window.addEventListener('popstate', onPopState);
    if (focusHeading) titleRef.current?.focus();
    return () => {
      window.removeEventListener('popstate', onPopState);
      const index = dialogHistoryStack.lastIndexOf(marker);
      if (index !== -1) dialogHistoryStack.splice(index, 1);
      // Explicit close (button/save) must also remove the synthetic entry.
      if (!consumed && history.state?.__nantiDialog === marker) {
        if (dialogHistoryStack.length > 0) pendingDialogHistoryCleanup++;
        history.back();
      }
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
      if (!busy && closeOnCancel) close();
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

export function ItemForm({ item, initialUrl, listId, currency, existingItems, close, save }: {
  item?: Item;
  initialUrl?: string;
  existingItems?: Item[];
  listId: string;
  currency: Currency;
  close: () => void;
  save: (data: ItemSaveInput, requestKey?: string) => Promise<void>;
}) {
  const { t, money, language, error: localError } = useLocale();
  const [url, setUrl] = useState(item?.url ?? initialUrl ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item?.priceMinor == null ? '' : formatProductPriceInput(language === 'id' ? (item.priceMinor / 100).toFixed(2).replace('.', ',') : (item.priceMinor / 100).toFixed(2), language));
  const [quantity, setQuantity] = useState(item?.quantity.toString() ?? '1');
  const [lookup, setLookup] = useState('');
  const [preview, setPreview] = useState<ProductImport | null>(null);
  const [showDetails, setShowDetails] = useState(Boolean(item));
  const [importedName, setImportedName] = useState(false);
  const [importedPrice, setImportedPrice] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [imageKey, setImageKey] = useState<string | null>(item?.imageKey ?? null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const pastePending = useRef(false);
  const submitting = useRef(false);
  const saveRequestKey = useRef<string | null>(null);
  const saveFingerprint = useRef<string | null>(null);

  async function chooseImage(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP image smaller than 2 MB.');
      return;
    }
    try {
      // Some Android WebViews do not support createImageBitmap; decode through
      // a regular image element so gallery uploads remain available.
      const objectUrl = URL.createObjectURL(file);
      const picture = new Image();
      try {
        await new Promise<void>((resolve, reject) => {
          picture.onload = () => resolve();
          picture.onerror = () => reject(new Error('Could not read this image.'));
          picture.src = objectUrl;
        });
        const scale = Math.min(1, 640 / Math.max(picture.naturalWidth, picture.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Unable to process image.');
        context.drawImage(picture, 0, 0, canvas.width, canvas.height);
        // Compress to the actual 195 KB upload limit rather than relying on
        // a rough Base64 character threshold. Try smaller sizes for detailed photos.
        let compressed = '';
        let fits = false;
        for (const edge of [640, 512, 400, 320]) {
          const ratio = Math.min(1, edge / Math.max(picture.naturalWidth, picture.naturalHeight));
          canvas.width = Math.max(1, Math.round(picture.naturalWidth * ratio));
          canvas.height = Math.max(1, Math.round(picture.naturalHeight * ratio));
          const resized = canvas.getContext('2d');
          if (!resized) throw new Error('Unable to process image.');
          resized.drawImage(picture, 0, 0, canvas.width, canvas.height);
          for (const quality of [0.7, 0.55, 0.4]) {
            compressed = canvas.toDataURL('image/jpeg', quality);
            if (!compressed.startsWith('data:image/jpeg;base64,')) continue;
            // Base64 represents three binary bytes per four encoded characters.
            const encoded = compressed.slice('data:image/jpeg;base64,'.length);
            const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
            if (Math.floor(encoded.length * 3 / 4) - padding <= 195_000) { fits = true; break; }
          }
          if (fits) break;
        }
        if (!fits) throw new Error('Image is too large or could not be compressed.');
        setUploadedImage(compressed);
        setImageKey(null);
        setImageFailed(false);
        setError('');
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (failure) {
      setError(errorMessage(failure));
    }
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
        method: 'POST', data: { url: value.trim() },
      });
      setPreview(result);
      if (result.name && (!name.trim() || (replaced && importedName))) {
        setName(result.name);
        setImportedName(true);
      }
      if (result.price?.currency === currency && (!price.trim() || (replaced && importedPrice))) {
        const value = (result.price.priceMinor / 100).toFixed(2);
        setPrice(formatProductPriceInput(language === 'id' ? value.replace('.', ',') : value, language));
        setImportedPrice(true);
      }
      const timedOut = result.diagnostic?.code === 'timeout' || result.diagnostic?.code === 'destination_timeout';
      if (result.merchant !== 'tokopedia') {
        setLookup(result.status === 'manual_required' ? 'Product details could not be retrieved automatically. You can still save the link by entering a name.'
          : 'Review the product details before saving.');
      } else if (timedOut) {
        setLookup('Tokopedia took too long to respond. Try again or enter the details yourself.');
      } else if (result.status === 'manual_required') {
        setLookup('The link is ready to save. Add a name to finish.');
      } else {
        setLookup(result.name && result.price && result.imagePath && result.sellerName
          ? 'Review the product details before saving.'
          : 'Some details came through. Check them and fill in anything you want to save.');
      }
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
    if (looking || busy || submitting.current) return;
    if (!showDetails && url.trim()) { await findProduct(url); return; }
    setError('');
    if (!name.trim()) { setError('Enter a product name.'); return; }
    if (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 999) {
      setError('Enter a whole number from 1 to 999.'); return;
    }
    const priceMinor = parsePrice(normalizeProductPriceInput(price, language));
    if (price.trim() && priceMinor === null) {
      setError('Enter a price up to 21,474,836.47 with at most two decimal places.');
      return;
    }
    const parsed = url.trim() ? safeImportUrl(url.trim()) : null;
    if (url.trim() && !parsed) {
      setError('Enter a valid HTTP or HTTPS product link, or leave it blank.');
      return;
    }
    const originalUrl = parsed ? url.trim() : null;
    const sellerName = (preview?.merchant === 'tokopedia' || preview?.merchant === 'shopee') && preview.originalUrl === originalUrl
      ? preview.sellerName ?? (item?.url === originalUrl ? item.sellerName : null)
      : item?.url === originalUrl ? item.sellerName : null;
    const saveMarketplaceImage = !item && !imageKey && !uploadedImage && preview?.originalUrl === originalUrl &&
      (preview.canSaveImage === true || preview.merchant === 'tokopedia');
    submitting.current = true;
    setBusy(true);
    try {
      const fingerprintFor = (key: string | null, hasUpload: boolean) => JSON.stringify({ listId, name: name.trim(), url: originalUrl,
        priceMinor, quantity: Number(quantity), sellerName: sellerName ?? null, imageKey: key, hasUploadedImage: hasUpload,
        saveMarketplaceImage, marketplaceImage: saveMarketplaceImage ? preview?.imagePath ?? null : null });
      const fingerprint = fingerprintFor(imageKey, Boolean(uploadedImage));
      if (!item && saveFingerprint.current !== fingerprint) {
        saveFingerprint.current = fingerprint;
        saveRequestKey.current = crypto.randomUUID();
      }
      const requestKey = item ? undefined : saveRequestKey.current ?? (saveRequestKey.current = crypto.randomUUID());
      if (uploadedImage) {
        const blob = await (await fetch(uploadedImage)).blob();
        if (blob.size > 195_000) throw new Error('Image is too large after compression.');
        const result = await fetch('/api/uploads/product-image/content', {
          method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Nanti-Request': '1' }, body: blob,
        }).catch(() => { throw new Error('Could not reach Nanti. Try again.'); });
        const upload = await result.json().catch(() => null);
        if (!result.ok || typeof upload?.key !== 'string') throw new Error(upload?.error ?? 'Image upload failed. Try again.');
        const { key } = upload;
        setUploadedImage(null);
        setImageKey(key);
        saveFingerprint.current = fingerprintFor(key, false);
        await save({ name, url: originalUrl, priceMinor, quantity: Number(quantity), imageKey: key, sellerName,
          ...(importedPrice && priceMinor !== null && { priceSource: 'imported_unverified' }) }, requestKey);
        return;
      }
      await save({ name, url: originalUrl, priceMinor, quantity: Number(quantity), imageKey, sellerName,
        ...(saveMarketplaceImage && { saveMarketplaceImage: true, tokopediaProductUrl: preview?.productUrl,
          ...(preview?.tokopediaImageProof && preview.imagePath && {
            tokopediaImage: { url: preview.imagePath, proof: preview.tokopediaImageProof },
          }),
          ...(preview?.merchant === 'shopee' && preview.productUrl && preview.imagePath && preview.shopeeImageProof && {
            shopeeProductUrl: preview.productUrl,
            shopeeImage: { url: preview.imagePath, proof: preview.shopeeImageProof },
          }) }),
          ...(importedPrice && priceMinor !== null && { priceSource: 'imported_unverified' }) }, requestKey);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog title={t(item ? 'Edit product' : 'Add product')} busy={busy} close={close} className="import-dialog" closeOnCancel={false}>
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
        {!item && preview?.merchant === 'tokopedia' && existingItems?.some(saved => saved.url === preview.originalUrl) &&
          <p className="hint" role="status">{t('This link is already in your wishlist. You can update the quantity there.')}</p>}
        {(!preview || preview.originalUrl !== url || (preview.merchant === 'tokopedia' && preview.status === 'manual_required')) && <div className="actions">
          <button type="button" className={showDetails ? 'lookup' : 'primary'} disabled={looking || busy || !url.trim()}
            onClick={() => void findProduct(url)}>{t(looking ? 'Looking up…' : preview?.merchant === 'tokopedia' && preview.status === 'manual_required' ? 'Try again' : 'Check product link')}</button>
          {!showDetails && <button type="button" onClick={() => {
            setShowDetails(true);
            requestAnimationFrame(() => nameInput.current?.focus());
          }} disabled={looking}>
            {t('Enter details myself')}
          </button>}
        </div>}
        {(lookup || looking) && <p className="hint" role="status">{looking ? t('Checking the product link…') : localError(lookup)}</p>}
        {preview && <div className={preview.status === 'manual_required' ? 'import-fallback' : 'import-preview'}>
          {preview.imagePath && !imageFailed && <img src={preview.imagePath} alt="" width="80" height="64"
            decoding="async" onError={() => setImageFailed(true)} />}
          <div>
            <p className="hint">{t('Store detected: {merchant}', { merchant: {
              shopee: 'Shopee', tokopedia: 'Tokopedia', ikea: 'IKEA', other: preview.hostname,
            }[preview.merchant] })}</p>
            {preview.name && <strong>{preview.name}</strong>}
            {preview.sellerName && <p className="hint">{t('Seller: {seller}', { seller: preview.sellerName })}</p>}
            {preview.price && <p>{money(preview.price.priceMinor, preview.price.currency)}</p>}
            {preview.status !== 'manual_required' && <p className="hint">{t('From the store page · unverified')}</p>}
            {preview.price && preview.price.currency !== currency &&
              <p className="hint">{t('The store uses {currency}. Enter a price in your wishlist’s currency if you want to save one.',
                { currency: preview.price.currency })}</p>}
          </div>
        </div>}
        {preview?.diagnostic && <div className="import-diagnostic" role="status">
          <strong>{(language === 'id' ? 'Diagnostik pratinjau tautan' : 'Link preview diagnostic')}</strong>
          <p>{(() => {
            const messages: Record<string, [string, string]> = {
              http_failure: ['Server toko menolak atau gagal memproses permintaan preview.', 'The store rejected or failed the preview request.'],
              access_blocked: ['Tokopedia membatasi pemeriksaan otomatis. Kamu bisa isi detail secara manual.', 'Tokopedia blocked the automatic lookup. You can enter the details manually.'],
              captcha_required: ['Tokopedia meminta verifikasi manusia. Kamu bisa isi detail secara manual.', 'Tokopedia requested human verification. You can enter the details manually.'],
              authentication_required: ['Tokopedia meminta kamu masuk untuk membuka halaman ini.', 'Tokopedia requires sign-in to open this page.'],
              rate_limited: ['Tokopedia membatasi jumlah permintaan. Coba lagi nanti atau isi detail secara manual.', 'Tokopedia is limiting requests. Try again later or enter the details manually.'],
              short_link_unavailable: ['Tautan pendek sudah tidak tersedia atau kedaluwarsa. Coba URL produk lengkap.', 'This short link is unavailable or expired. Try the full product URL.'],
              short_link_unresolved: ['Tautan pendek belum mengarah ke halaman produk. Coba URL produk lengkap.', 'The short link did not lead to a product page. Try the full product URL.'],
              listing_unavailable: ['Halaman produk sudah tidak tersedia. Kamu bisa isi detail secara manual.', 'The product page is unavailable. You can enter the details manually.'],
              metadata_malformed: ['Detail produk dari Tokopedia tidak bisa dibaca. Kamu bisa isi detail secara manual.', 'Nanti could not read the product details. You can enter them manually.'],
              listing_mismatch: ['Halaman mengarah ke produk lain. Periksa URL atau isi detail secara manual.', 'The page refers to a different product. Check the URL or enter the details manually.'],
              response_too_large: ['Halaman terlalu besar untuk diperiksa. Kamu bisa isi detail secara manual.', 'The page is too large to check. You can enter the details manually.'],
              unsupported_encoding: ['Format halaman tidak bisa dibaca. Kamu bisa isi detail secara manual.', 'Nanti could not read the page format. You can enter the details manually.'],
              timeout: ['Server toko tidak merespons dalam batas waktu.', 'The store did not respond before the timeout.'],
              destination_timeout: ['Tujuan redirect tidak merespons tepat waktu.', 'The redirect destination timed out.'],
              request_error: ['Koneksi server ke toko gagal. Detail jaringan tidak tersedia.', 'The server could not connect to the store. Network details are unavailable.'],
              redirect_disallowed: ['Redirect menuju domain atau protokol yang tidak diizinkan demi keamanan.', 'The redirect targets a domain or protocol that is not allowed for security.'],
              redirect_missing_location: ['Server mengirim redirect tanpa alamat tujuan.', 'The store returned a redirect without a destination.'],
              redirect_limit: ['Terlalu banyak redirect sehingga pemeriksaan dihentikan.', 'Too many redirects; the lookup was stopped.'],
              not_html: ['Toko tidak mengembalikan halaman HTML.', 'The store did not return an HTML page.'],
              empty_response: ['Toko mengembalikan respons tanpa isi halaman.', 'The store returned an empty page response.'],
              metadata_missing: ['Halaman terbuka, tetapi metadata produk tidak ditemukan.', 'The page loaded, but no product metadata was found.'],
              adapter_disabled: ['Pengambilan metadata otomatis belum tersedia untuk format tautan ini.', 'Automatic metadata lookup is not available for this link format.'],
              unsupported_url: ['Toko dikenali, tetapi preview otomatis belum didukung untuk tautan ini.', 'The store was recognized, but automatic preview is not supported for this link.'],
              metadata_unavailable: ['Adapter tidak menghasilkan detail maupun alasan spesifik.', 'The adapter returned no details or specific failure reason.'],
            };
            const message = messages[preview.diagnostic!.code] ?? messages.metadata_unavailable;
            return (message ?? ['Alasan tidak tersedia.', 'Reason unavailable.'])[language === 'id' ? 0 : 1];
          })()}</p>
          <code style={{ overflowWrap: 'anywhere' }}>{preview.diagnostic.code} · {preview.diagnostic.host}{preview.diagnostic.httpStatus ? ` · HTTP ${preview.diagnostic.httpStatus}` : ''}</code>
          <p>{(language === 'id' ? 'Buka tautan di browser, salin URL produk lengkap, lalu periksa lagi. Jika marketplace membatasi akses otomatis, isi detail secara manual.' : 'Open the link in your browser, paste the full product URL and check again. If automated access is blocked, enter details manually.')}</p>
        </div>}
        {showDetails && <>
          <div className="product-image-editor">
            <input ref={uploadInput} type="file" accept="image/jpeg,image/png,image/webp"
              className="product-image-file" aria-label="Upload product image"
              onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; void chooseImage(selected); }} />
            <button type="button" className="product-image-placeholder"
              aria-label="Tambah gambar (opsional), pilih dari galeri"
              disabled={busy || looking} onClick={() => uploadInput.current?.click()}>
              {uploadedImage || (imageKey && item && !imageFailed) || (preview?.imagePath && !imageFailed)
                ? <img src={uploadedImage || (imageKey && item ? `/api/wishlists/${listId}/items/${item.id}/uploaded-image` : '') || preview?.imagePath || ''}
                    alt="Product preview" onError={() => setImageFailed(true)} />
                : <span aria-hidden="true">＋<small>Tambah gambar (opsional)</small></span>}
            </button>
            {!item && preview?.merchant === 'tokopedia' && preview.imagePath && !preview.canSaveImage && !uploadedImage &&
              <p className="hint">{t('Photo storage is unavailable. You can still save the product without a photo.')}</p>}
            {(uploadedImage || imageKey) && <button type="button" className="product-image-remove" disabled={busy || looking}
              onClick={() => { setUploadedImage(null); setImageKey(null); if (uploadInput.current) uploadInput.current.value = ''; }}>
              Hapus gambar
            </button>}
          </div>
          <label>{t('Product name')}<input ref={nameInput} name="product-name" required maxLength={160} value={name} disabled={looking || busy}
            onChange={(event) => { setName(event.target.value); setImportedName(false); }} /></label>
          <div className="fields">
          <label>{t('Unit price ({currency})', { currency })} <span className="optional">{t('(optional)')}</span>
            <input name="unit-price" inputMode="decimal" maxLength={15} value={price} disabled={looking || busy}
              onChange={(event) => { setPrice(formatProductPriceInput(event.target.value, language)); setImportedPrice(false); }} />
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
    {confirm && <p>{t('This clears saved assessments, the waiting preference, and saved financial details. Your wishlists and products stay here.')}</p>}
    {error && <p role="alert" className="error">{localError(error)}</p>}
    <div className="form-actions">
      <button ref={cancel} disabled={busy} onClick={close}>{t(confirm ? 'Cancel' : 'Close')}</button>
      <button className={confirm ? 'danger' : undefined} disabled={busy} onClick={() => confirm ? void clear() : setConfirm(true)}>
        {t(busy ? 'Removing…' : 'Clear assessment data')}
      </button>
    </div>
  </Dialog>;
}
