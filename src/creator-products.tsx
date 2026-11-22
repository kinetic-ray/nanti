import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { CatalogProduct, CreatorCatalog, CreatorProductInput } from '../shared/creator-catalog.js';
import type { ProductImport } from '../shared/product-import.js';
import { safeImportUrl } from '../shared/product-import.js';
import { currencies, formatPrice, parsePrice } from '../shared/wishlist.js';
import type { Currency } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { creatorJpeg, photoDataUrl } from './creator-photo.js';
import { useLocale } from './locale.js';

const base = '/account/creator/catalog/products';
type Edit = { id: string; item?: CatalogProduct };

export function CreatorProducts({ catalog, load, openPublishing }: {
  catalog: CreatorCatalog; load: () => Promise<void>; openPublishing: () => void;
}) {
  const { language, t } = useLocale();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [editor, setEditor] = useState<Edit | null>(null);
  const [deleting, setDeleting] = useState<CatalogProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [showPublishLink, setShowPublishLink] = useState(false);
  const add = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmation = useRef<HTMLDialogElement>(null);
  const products = catalog.products.filter(item =>
    (filter === 'all' || item.published === (filter === 'published')) &&
    [item.title, item.category, item.description, item.color, item.productType].some(value => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));

  useEffect(() => {
    if (deleting) confirmation.current?.showModal();
    else confirmation.current?.close();
  }, [deleting]);

  async function change(item: CatalogProduct, remove = false) {
    setBusy(true);
    setFailure('');
    setNotice('');
    setShowPublishLink(false);
    try {
      await api(base + '/' + item.id + (remove ? '' : '/publication'), remove
        ? { method: 'DELETE' } : { method: 'PUT', data: { published: !item.published } });
      if (remove) setDeleting(null);
      await load();
      const pendingStore = !remove && !item.published && !catalog.publishedDesign;
      setShowPublishLink(pendingStore);
      setNotice(remove ? t('Product deleted.') : item.published
        ? t('Product unpublished.') : pendingStore
          ? t('Product is ready. Publish your storefront to make it public.') : t('Product published.'));
      if (remove) requestAnimationFrame(() => heading.current?.focus());
    } catch (error) {
      setFailure(errorMessage(error));
    } finally { setBusy(false); }
  }

  function closeEditor() {
    setEditor(null);
    requestAnimationFrame(() => add.current?.focus());
  }

  return <section className="creator-catalog" aria-labelledby="catalog-title">
    <div className="catalog-heading"><h1 id="catalog-title" ref={heading} tabIndex={-1}>{t('Products')}</h1>
      {!editor && <button className="catalog-primary" ref={add} onClick={() => { setNotice(''); setEditor({ id: crypto.randomUUID() }); }}>{t('Add product')}</button>}
    </div>
    {editor ? <ProductEditor key={editor.id} entry={editor} collections={[...new Set(catalog.products.map(item => item.category).filter(Boolean))]} load={load} close={closeEditor} saved={() => {
      setNotice(t('Product saved.'));
      closeEditor();
    }} /> : <>
      {failure && <p className="catalog-error" role="alert">{failure} {failure === 'Sign in to continue.' && <a href="/account?next=creator">{t('Sign in again')}</a>}</p>}
      {notice && <div className="catalog-notice catalog-actions"><span role="status">{notice}</span>
        {showPublishLink && !catalog.publishedDesign && <button type="button" onClick={openPublishing}>{t('Go to publishing')}</button>}</div>}
      {catalog.products.length ? <>
        <div className="catalog-filters">
          <label>{t('Search products')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <div className="catalog-filter-field"><label htmlFor="catalog-status">{t('Status')}</label>
            <select id="catalog-status" value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">{t('All products')}</option>
            <option value="draft">{t('Draft')}</option><option value="published">{t('Published')}</option>
            </select>
          </div>
        </div>
        {products.length ? <ul className="catalog-list">{products.map(item => <li key={item.id} className="catalog-card">
          <div className="catalog-thumbnail">{item.image ? <img src={item.image} alt="" loading="lazy"
            onError={event => { event.currentTarget.hidden = true; }} /> : null}<span aria-hidden="true">{item.title.slice(0, 1)}</span></div>
          <div className="catalog-card-copy"><span className="catalog-badge" data-published={item.published}>{item.published ? t('Published') : t('Draft')}</span>
            <h2>{item.title}</h2>
            {item.priceMinor != null && item.currency && <strong>{formatPrice(item.priceMinor, item.currency, language === 'id' ? 'id-ID' : 'en-US')}</strong>}
            {[item.color, item.productType, item.category].some(Boolean) && <p>{[item.color, item.productType, item.category].filter(Boolean).join(' · ')}</p>}
          </div>
          <div className="catalog-actions">
            <button disabled={busy} onClick={() => setEditor({ id: item.id, item })}>{t('Edit')}<span className="catalog-sr-only"> {item.title}</span></button>
            <button disabled={busy} onClick={() => void change(item)}>{item.published ? t('Unpublish') : t('Publish')}<span className="catalog-sr-only"> {item.title}</span></button>
            <button disabled={busy} onClick={() => { setFailure(''); setDeleting(item); }}>{t('Delete')}<span className="catalog-sr-only"> {item.title}</span></button>
          </div>
        </li>)}</ul> : <p role="status">{t('No products match your filters.')}</p>}
      </> : <div className="catalog-panel"><h2>{t('Add your first product')}</h2>
        <p>{t('Paste a retailer link or enter the details yourself. New products start as drafts.')}</p></div>}
    </>}
    <dialog ref={confirmation} className="catalog-dialog" aria-labelledby="catalog-delete-title" onCancel={event => {
      event.preventDefault();
      if (!busy) setDeleting(null);
    }}>
      <h2 id="catalog-delete-title">{t('Delete product?')}</h2>
      {deleting && <><p>{deleting.title}</p>{failure && <p role="alert" className="catalog-error">{failure}</p>}
        <div className="catalog-actions"><button autoFocus disabled={busy} onClick={() => setDeleting(null)}>{t('Cancel')}</button>
          <button className="catalog-danger" disabled={busy} onClick={() => void change(deleting, true)}>{t('Delete product')}</button></div></>}
    </dialog>
  </section>;
}

function ProductEditor({ entry, collections, load, close, saved }: {
  entry: Edit; collections: string[]; load: () => Promise<void>; close: () => void; saved: () => void;
}) {
  const { language, t } = useLocale();
  const item = entry.item;
  const [step, setStep] = useState(item ? 1 : 0);
  const [furthest, setFurthest] = useState(item ? 2 : 0);
  const [color, setColor] = useState(item?.color ?? '');
  const [productType, setProductType] = useState(item?.productType ?? '');
  const [newCollection, setNewCollection] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [importedPhoto, setImportedPhoto] = useState('');
  const [title, setTitle] = useState(item?.title ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [price, setPrice] = useState(item?.priceMinor == null ? '' : String(item.priceMinor / 100).replace('.', language === 'id' ? ',' : '.'));
  const [currency, setCurrency] = useState<Currency>(item?.currency ?? 'IDR');
  const [photo, setPhoto] = useState<File | 'import' | 'remove' | null>(null);
  const [localPhoto, setLocalPhoto] = useState('');
  const [pending, setPending] = useState(false);
  const [persisted, setPersisted] = useState(Boolean(item));
  const [dirty, setDirty] = useState(false);
  const [failure, setFailure] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [fields, setFields] = useState<{ title?: string; url?: string; price?: string }>({});
  const linkField = useRef<HTMLInputElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const path = base + '/' + entry.id;

  useEffect(() => {
    if (pending) return;
    (step === 0 ? linkField.current : step === 1 ? titleField.current : document.getElementById('catalog-category'))?.focus();
  }, [step, pending]);
  useEffect(() => {
    setLocalPhoto('');
    if (!(photo instanceof File) || photo.size > 15 * 1024 * 1024) return;
    let active = true;
    void photoDataUrl(photo).then(source => { if (active) setLocalPhoto(source); }, () => {});
    return () => { active = false; };
  }, [photo]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function importProduct() {
    if (!safeImportUrl(url.trim())) {
      setFields(previous => ({ ...previous, url: t('Enter a valid product link.') }));
      linkField.current?.focus();
      return;
    }
    setPending(true);
    setImportNotice('');
    setFields({});
    let hasPhoto = Boolean(item?.image || photo instanceof File || importedPhoto);
    try {
      const result = await api<ProductImport>('/products/import', { method: 'POST', data: { url: url.trim() } });
      if (result.status === 'manual_required') {
        setImportNotice(t('The retailer details are unavailable. You can enter them below.'));
        return;
      }
      if (result.name && !title.trim()) setTitle(result.name.slice(0, 160));
      if (result.price && !price) {
        setPrice(String(result.price.priceMinor / 100).replace('.', language === 'id' ? ',' : '.'));
        setCurrency(result.price.currency);
      }
      if (result.imagePath && !hasPhoto) {
        try {
          setImportedPhoto(await retailerPhoto(result.productUrl ?? url.trim(), result.imagePath));
          setPhoto('import');
          hasPhoto = true;
        } catch {
          hasPhoto = false;
        }
      }
      setDirty(true);
      setImportNotice(t('Review the imported details before saving.'));
    } catch {
      setImportNotice(t('Could not import retailer details. Enter them below or try again.'));
    } finally {
      setShowUpload(!hasPhoto);
      setStep(1);
      setFurthest(previous => Math.max(1, previous));
      setPending(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const priceMinor = price.trim() ? parsePrice(price.replace(',', '.')) : null;
    const errors = {
      title: title.trim() ? undefined : t('Enter a product name.'),
      url: safeImportUrl(url.trim()) ? undefined : t('Enter a valid product link.'),
      price: price.trim() && priceMinor === null ? t('Enter a price with up to two decimal places.') : undefined,
    };
    setFields(errors);
    if (errors.url || errors.title || errors.price) {
      setStep(errors.url ? 0 : 1);
      requestAnimationFrame(() => (errors.url ? linkField.current : errors.title ? titleField.current : document.getElementById('catalog-price'))?.focus());
      return;
    }
    setPending(true);
    setFailure('');
    try {
      let encoded: string | null | undefined = photo === 'remove' ? null : undefined;
      if (photo instanceof File) {
        encoded = await creatorJpeg(photo).then(photoBase64).catch(() => {
          throw new Error(t('Could not read this photo. Choose another image up to 15 MB.'));
        });
      } else if (photo === 'import') {
        encoded = importedPhoto;
      }
      const data: CreatorProductInput = { title, url, description, category, color, productType, priceMinor, currency: priceMinor === null ? null : currency };
      await api(path, { method: persisted ? 'PATCH' : 'PUT', data: { ...data, photo: encoded } });
      setPersisted(true);
      setDirty(false);
      await load();
      saved();
    } catch (error) {
      setFailure(errorMessage(error));
      if (photo instanceof File) setStep(1);
    } finally { setPending(false); }
  }

  const image = photo instanceof File ? localPhoto : photo === 'import' ? 'data:image/jpeg;base64,' + importedPhoto : photo === 'remove' ? '' : item?.image;
  const labels = [t('Product link'), t('Product details'), t('Organize')];

  return <form className="catalog-panel catalog-form" noValidate onChange={() => setDirty(true)} onSubmit={event => {
    event.preventDefault();
    if (pending) return;
    if (step === 0) void importProduct();
    else if (step === 2) void save(event);
    else if (title.trim()) { setStep(2); setFurthest(2); }
    else { setFields(previous => ({ ...previous, title: t('Enter a product name.') })); titleField.current?.focus(); }
  }}>
    <h2>{item ? t('Edit product') : t('Add product')}</h2>
    <ol className="catalog-steps" aria-label={t('Product setup')}>
      {labels.map((label, index) => <li key={label}>
        <button type="button" disabled={pending || index > furthest} aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}>{index + 1}. {label}</button>
      </li>)}
    </ol>
    <fieldset disabled={pending} hidden={step !== 0}>
      <label htmlFor="catalog-url">{t('Product link')}</label>
      <input id="catalog-url" name="url" autoComplete="off" spellCheck={false} ref={linkField} type="url" required maxLength={2048}
        placeholder="https://..." value={url} aria-invalid={Boolean(fields.url)} aria-describedby={fields.url ? 'catalog-url-error' : undefined}
        onChange={event => { setUrl(event.target.value); setFurthest(0); if (photo === 'import') { setPhoto(null); setImportedPhoto(''); } }} />
      {fields.url && <p role="alert" className="catalog-error" id="catalog-url-error">{fields.url}</p>}
    </fieldset>
    <fieldset disabled={pending} hidden={step !== 1}>
      {importNotice && <p role="status">{importNotice}</p>}
      <label htmlFor="catalog-product-name">{t('Product name')}</label>
      <input id="catalog-product-name" name="title" autoComplete="off" ref={titleField} required maxLength={160} value={title}
        aria-invalid={Boolean(fields.title)} aria-describedby={fields.title ? 'catalog-title-error' : undefined} onChange={event => setTitle(event.target.value)} />
      {fields.title && <p role="alert" className="catalog-error" id="catalog-title-error">{fields.title}</p>}
      <div className="catalog-price-row">
        <label>{t('Price')}<input id="catalog-price" name="price" autoComplete="off" inputMode="decimal" value={price} aria-invalid={Boolean(fields.price)}
          aria-describedby={fields.price ? 'catalog-price-error' : undefined} onChange={event => setPrice(event.target.value)} /></label>
        <label>{t('Currency')}<select value={currency} onChange={event => setCurrency(event.target.value as Currency)}>
          {currencies.map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      {fields.price && <p role="alert" className="catalog-error" id="catalog-price-error">{fields.price}</p>}
      {image && <img key={image} className="catalog-edit-photo" src={image} alt={t('Product photo')} onError={event => { event.currentTarget.hidden = true; setShowUpload(true); }} />}
      {item && !showUpload && <button type="button" onClick={() => setShowUpload(true)}>{t(image ? 'Replace photo' : 'Add photo')}</button>}
      {showUpload && <div className="catalog-upload">
        {!image && !item && <p>{t('No retailer photo is available. Add your own if you have one.')}</p>}
        <label htmlFor="catalog-photo">{t('Product photo (optional)')}</label>
        <input id="catalog-photo" name="photo" type="file" accept="image/*" onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) setPhoto(file);
        }} />
        {photo instanceof File && <p role="status">{photo.name}</p>}
        {(image || photo instanceof File) && <button type="button" onClick={() => { setPhoto('remove'); setImportedPhoto(''); setDirty(true); }}>{t('Continue without photo')}</button>}
      </div>}
      <details>
        <summary>{t('Optional product details')}</summary>
        <label>{t('Color')}<input maxLength={60} value={color} onChange={event => setColor(event.target.value)} /></label>
        <label>{t('Product type')}<input maxLength={60} value={productType} onChange={event => setProductType(event.target.value)} /></label>
        <label>{t('Description')}<textarea rows={3} maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></label>
      </details>
    </fieldset>
    <fieldset disabled={pending} hidden={step !== 2}>
      <label htmlFor="catalog-category">{t('Collection (optional)')}</label>
      <select id="catalog-category" value={newCollection ? 'new' : category ? 'existing:' + category : ''} onChange={event => {
        const value = event.target.value;
        setNewCollection(value === 'new');
        setCategory(value.startsWith('existing:') ? value.slice(9) : '');
      }}>
        <option value="">{t('No collection')}</option>
        {collections.map(name => <option key={name} value={'existing:' + name}>{name}</option>)}
        <option value="new">{t('New collection')}</option>
      </select>
      {newCollection && <label>{t('Collection name')}
        <input maxLength={60} value={category} onChange={event => setCategory(event.target.value)} />
      </label>}
    </fieldset>
    {failure && <p role="alert" className="catalog-error">{failure} {failure === 'Sign in to continue.' && <a href="/account?next=creator">{t('Sign in again')}</a>}</p>}
    {pending && <p role="status">{t('Working…')}</p>}
    <div className="catalog-actions"><button className="catalog-primary" disabled={pending}>{step === 0 ? t('Import details') : step === 1 ? t('Continue') : item ? t('Save changes') : t('Save draft')}</button>
      <button type="button" disabled={pending} onClick={() => {
        if (!dirty || window.confirm(t('Discard unsaved changes?'))) close();
      }}>{t('Cancel')}</button></div>
  </form>;
}

async function photoBase64(blob: Blob) {
  const encoded = (await photoDataUrl(blob)).split(',')[1];
  if (!encoded) throw new Error('Invalid photo');
  return encoded;
}

async function retailerPhoto(url: string, preview: string) {
  if (preview.startsWith('/api/products/import/image?')) {
    const response = await fetch(preview, { redirect: 'error' });
    if (response.ok) {
      const blob = await response.blob();
      return photoBase64(await creatorJpeg(new File([blob], 'retailer-photo', { type: blob.type })));
    }
  }
  const response = await fetch('/api/account/creator/catalog/import-photo', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nanti-Request': '1' },
    body: JSON.stringify({ url }),
  });
  if (response.status === 401) throw new Error('Sign in to continue.');
  if (!response.ok) throw new Error('Retailer photo unavailable');
  return photoBase64(await response.blob());
}
