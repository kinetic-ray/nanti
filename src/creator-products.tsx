import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff, Package, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { CatalogProduct, CreatorCatalog, CreatorProductInput } from '../shared/creator-catalog.js';
import { safeImportUrl } from '../shared/product-import.js';
import type { ProductImport } from '../shared/product-import.js';
import { currencies } from '../shared/wishlist.js';
import type { Currency } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { creatorJpeg, photoDataUrl } from './creator-photo.js';
import { useLocale } from './locale.js';
import { productSource, productSources as sources } from './workspace-product-source.js';
import { normalizeProductPriceInput } from './product-price-input.js';
import { WorkspaceEmpty, WorkspaceHeading, WorkspacePagination, WorkspaceThumbnail } from './admin-workspace.js';

const base = '/account/creator/catalog/products';
const pageSize = 10;
type Edit = { id: string; item?: CatalogProduct };
const sorts = ['recent', 'oldest', 'name', 'price'] as const;
type Sort = typeof sorts[number];

export function CreatorProducts({ catalog, load, openPublishing, startDraft }: {
  catalog: CreatorCatalog;
  load: () => Promise<void>;
  openPublishing: () => void;
  startDraft: string | null;
}) {
  const { language, locale, money, t, error } = useLocale();
  const l = (id: string, en: string) => language === 'id' ? id : en;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [source, setSource] = useState('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<Edit | null>(null);
  const [deleting, setDeleting] = useState<CatalogProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [showPublishLink, setShowPublishLink] = useState(false);
  const previousDraft = useRef<string | null>(null);
  const editTrigger = useRef<string | null>(null);
  const add = useRef<HTMLButtonElement>(null);
  const confirmation = useRef<HTMLDialogElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const tableLabel = t('Products');
  const search = query.trim().toLocaleLowerCase(locale);
  const products = catalog.products.filter(item =>
    (filter === 'all' || item.published === (filter === 'published')) &&
    (source === 'all' || productSource(item.url) === source) &&
    [item.title, item.category, item.description, item.color, item.productType].some(value => value?.toLocaleLowerCase(locale).includes(search)));
  if (sort === 'oldest') products.reverse();
  if (sort === 'name') products.sort((a, b) => a.title.localeCompare(b.title, locale));
  if (sort === 'price') {
    products.sort((a, b) => {
      if (a.priceMinor == null || b.priceMinor == null) return Number(a.priceMinor == null) - Number(b.priceMinor == null);
      return (a.currency ?? '').localeCompare(b.currency ?? '') || a.priceMinor - b.priceMinor;
    });
  }
  const pages = Math.max(1, Math.ceil(products.length / pageSize));
  const currentPage = Math.min(page, pages);
  const rows = products.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const chosen = rows.filter(item => selected.includes(item.id));

  useEffect(() => {
    if (!startDraft || startDraft === previousDraft.current) return;
    previousDraft.current = startDraft;
    setNotice('');
    setEditor(current => current ?? { id: startDraft });
  }, [startDraft]);

  useEffect(() => {
    if (deleting) {
      confirmation.current?.showModal();
      cancelDelete.current?.focus();
    } else confirmation.current?.close();
  }, [deleting]);

  function resetPage(next = 1) {
    setPage(next);
    setSelected([]);
  }

  async function mutate(ids: string[], action: 'publish' | 'draft' | 'delete') {
    setBusy(true);
    setFailure('');
    setNotice('');
    setShowPublishLink(false);
    try {
      if (action === 'delete') {
        await api(base + '/' + ids[0], { method: 'DELETE' });
        setDeleting(null);
      } else if (ids.length === 1) {
        await api(base + '/' + ids[0] + '/publication', { method: 'PUT', data: { published: action === 'publish' } });
      } else {
        await api('/account/creator/catalog/bulk-publication', { method: 'POST', data: { ids, published: action === 'publish' } });
      }
      setSelected([]);
      const pendingStore = action === 'publish' && !catalog.publishedDesign;
      setShowPublishLink(pendingStore);
      setNotice(action === 'delete' ? t('Product deleted.') : action === 'draft'
        ? ids.length > 1 ? l('Produk dipindahkan ke draf.', 'Products moved to draft.') : t('Product unpublished.')
        : pendingStore ? l('Terbitkan etalase agar produk dapat dilihat pengunjung.', 'Publish your storefront to make these products visible.')
          : ids.length > 1 ? l('Produk diterbitkan.', 'Products published.') : t('Product published.'));
      await load();
      if (action === 'delete') requestAnimationFrame(() => add.current?.focus());
    } catch (problem) {
      setFailure(errorMessage(problem));
    } finally { setBusy(false); }
  }

  function openEditor(item?: CatalogProduct) {
    editTrigger.current = item?.id ?? null;
    setFailure('');
    setNotice('');
    setEditor(item ? { id: item.id, item } : { id: crypto.randomUUID() });
  }

  function closeEditor() {
    setEditor(null);
    requestAnimationFrame(() => {
      const trigger = editTrigger.current ? document.getElementById('edit-' + editTrigger.current) : null;
      (trigger ?? add.current)?.focus();
    });
  }

  return <section>
    <WorkspaceHeading title={editor ? t(editor.item ? 'Edit product' : 'Add product') : tableLabel}
      description={editor ? undefined : l('Kelola produk yang tampil di etalasemu.', 'Manage the products shown in your storefront.')}
      action={!editor && <button type="button" className="aw-primary" ref={add} onClick={() => openEditor()}>
        <Plus size={17} aria-hidden="true" />{t('Add product')}
      </button>} />
    {editor ? <ProductEditor key={editor.id} entry={editor}
      collections={[...new Set(catalog.products.map(item => item.category).filter(Boolean))]}
      close={closeEditor} saved={async () => {
        setNotice(t('Product saved.'));
        closeEditor();
        try { await load(); } catch (problem) { setFailure(errorMessage(problem)); }
      }} /> : <div className="aw-section-stack">
      {failure && !deleting && <p className="aw-error" role="alert">{error(failure)} {failure === 'Sign in to continue.'
        ? <a href="/account?next=creator">{t('Sign in again')}</a>
        : <button type="button" onClick={() => { setFailure(''); void load().catch(problem => setFailure(errorMessage(problem))); }}>{t('Try again')}</button>}</p>}
      {notice && <div className="aw-notice aw-actions"><span role="status">{notice}</span>
        {showPublishLink && !catalog.publishedDesign && <button type="button" onClick={openPublishing}>{l('Buka pengaturan etalase', 'Open storefront settings')}</button>}
      </div>}
      <div className="aw-card">
        <div className="aw-filter-row">
          <label className="aw-field">{t('Search products')}<span className="aw-search"><Search size={16} aria-hidden="true" />
            <input type="search" value={query} placeholder={l('Nama', 'Name')}
              onChange={event => { setQuery(event.target.value); resetPage(); }} />
          </span></label>
          <div className="aw-field"><label htmlFor="catalog-status">{t('Status')}</label>
            <select id="catalog-status" value={filter} onChange={event => { setFilter(event.target.value); resetPage(); }}>
              <option value="all">{l('Semua status', 'All statuses')}</option>
              <option value="draft">{t('Draft')}</option><option value="published">{t('Published')}</option>
            </select>
          </div>
          <div className="aw-field"><label htmlFor="catalog-source">{l('Sumber', 'Source')}</label>
            <select id="catalog-source" value={source} onChange={event => { setSource(event.target.value); resetPage(); }}>
              <option value="all">{l('Semua sumber', 'All sources')}</option>
              {Object.entries(sources).map(([value, label]) => <option key={value} value={value}>{value === 'other' ? l(label, 'Other') : label}</option>)}
            </select>
          </div>
          <div className="aw-field"><label htmlFor="catalog-sort">{l('Urutkan', 'Sort')}</label>
            <select id="catalog-sort" value={sort} onChange={event => { setSort(event.target.value as Sort); resetPage(); }}>
              <option value="recent">{l('Terbaru', 'Newest')}</option>
              <option value="oldest">{l('Terlama', 'Oldest')}</option>
              <option value="name">{l('Nama A–Z', 'Name A–Z')}</option>
              <option value="price">{l('Harga per mata uang', 'Price by currency')}</option>
            </select>
          </div>
        </div>
        {chosen.length > 0 && <div className="aw-card-header aw-actions">
          <span role="status">{chosen.length} {l('dipilih', 'selected')}</span>
          <div className="aw-actions">
            <button type="button" disabled={busy || chosen.every(item => item.published)}
              onClick={() => void mutate(chosen.map(item => item.id), 'publish')}>{t('Publish')}</button>
            <button type="button" disabled={busy || chosen.every(item => !item.published)}
              onClick={() => void mutate(chosen.map(item => item.id), 'draft')}>{l('Jadikan draf', 'Move to draft')}</button>
            <button type="button" disabled={busy} onClick={() => setSelected([])}>{l('Hapus pilihan', 'Clear selection')}</button>
          </div>
        </div>}
        {rows.length ? <>
          <div className="aw-table-scroll" role="region" aria-label={tableLabel} tabIndex={0}>
            <table className="aw-table aw-creator-table" role="table">
              <thead role="rowgroup"><tr role="row">
                <th scope="col" role="columnheader"><label className="aw-check-target"><input type="checkbox" disabled={busy}
                  aria-label={l('Pilih semua produk di halaman ini', 'Select all products on this page')}
                  checked={chosen.length === rows.length} ref={input => { if (input) input.indeterminate = chosen.length > 0 && chosen.length < rows.length; }}
                  onChange={event => setSelected(event.target.checked ? rows.map(item => item.id) : [])} />
                  <span aria-hidden="true">{l('Pilih semua di halaman ini', 'Select all on this page')}</span></label></th>
                <th scope="col" role="columnheader">{t('Product name')}</th><th scope="col" role="columnheader">{t('Price')}</th>
                <th scope="col" role="columnheader">{l('Sumber', 'Source')}</th><th scope="col" role="columnheader">{t('Status')}</th>
                <th scope="col" role="columnheader">{l('Tindakan', 'Actions')}</th>
              </tr></thead>
              <tbody role="rowgroup">{rows.map(item => {
                const merchant = productSource(item.url);
                const visibility = t(item.published ? 'Unpublish' : 'Publish');
                return <tr key={item.id} role="row">
                  <td role="cell"><label className="aw-check-target"><input type="checkbox" checked={selected.includes(item.id)} disabled={busy}
                    aria-label={l('Pilih ', 'Select ') + item.title}
                    onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /></label></td>
                  <td className="aw-product-cell" role="cell"><div className="aw-product-name"><WorkspaceThumbnail image={item.image} name={item.title} />
                    <div><strong>{item.title}</strong>{item.category && <small>{item.category}</small>}</div>
                  </div></td>
                  <td className="aw-nowrap" role="cell">{item.priceMinor != null && item.currency ? money(item.priceMinor, item.currency) : '—'}</td>
                  <td role="cell">{merchant === 'other' ? l('Lainnya', 'Other') : sources[merchant]}</td>
                  <td role="cell"><span className="aw-badge" data-live={item.published}>{t(item.published ? 'Published' : 'Draft')}</span></td>
                  <td role="cell"><div className="aw-table-actions">
                    <button type="button" id={'edit-' + item.id} className="aw-icon-button" disabled={busy} title={t('Edit')} aria-label={t('Edit') + ' ' + item.title}
                      onClick={() => openEditor(item)}><Pencil size={16} aria-hidden="true" /></button>
                    <button type="button" className="aw-icon-button" disabled={busy} title={visibility} aria-label={visibility + ' ' + item.title}
                      onClick={() => void mutate([item.id], item.published ? 'draft' : 'publish')}>
                      {item.published ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                    </button>
                    <button type="button" className="aw-icon-button aw-delete" disabled={busy} title={t('Delete')} aria-label={t('Delete') + ' ' + item.title}
                      onClick={() => { setFailure(''); setDeleting(item); }}><Trash2 size={16} aria-hidden="true" /></button>
                  </div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div className="aw-table-footer"><span>{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, products.length)} {l('dari', 'of')} {products.length} {l('produk', 'products')}</span>
            <WorkspacePagination page={currentPage} pages={pages} onPage={resetPage} language={language} /></div>
        </> : <WorkspaceEmpty icon={Package} title={t(catalog.products.length ? 'No products match your filters.' : 'Add your first product')}
          description={catalog.products.length ? l('Ubah pencarian atau filter untuk melihat hasil lain.', 'Change the search or filters to see other results.')
            : t('Paste a retailer link or enter the details yourself. New products start as drafts.')} />}
      </div>
    </div>}
    <dialog ref={confirmation} className="aw-dialog" aria-labelledby="catalog-delete-title" onCancel={event => {
      event.preventDefault();
      if (!busy) setDeleting(null);
    }}>
      <h2 id="catalog-delete-title">{t('Delete product?')}</h2>
      {deleting && <>
        <p>{l('Produk ini akan dihapus dari katalog dan etalase.', 'This product will be removed from your catalog and storefront.')}</p>
        <p><strong>{deleting.title}</strong></p>
        {failure && <p role="alert" className="aw-error">{error(failure)}</p>}
        <div className="aw-actions">
          <button type="button" ref={cancelDelete} disabled={busy} onClick={() => setDeleting(null)}>{t('Cancel')}</button>
          <button type="button" className="aw-danger" disabled={busy} onClick={() => void mutate([deleting.id], 'delete')}>{t('Delete product')}</button>
        </div>
      </>}
    </dialog>
  </section>;
}

function displayPrice(price: string, language: 'id' | 'en') {
  const match = /^(\d*)(?:\.(\d*))?$/u.exec(price);
  if (!match) return language === 'id' ? price.replace('.', ',') : price;
  const whole = (match[1] ?? '').replace(/\B(?=(\d{3})+(?!\d))/gu, language === 'id' ? '.' : ',');
  return match[2] === undefined ? whole : (whole || '0') + (language === 'id' ? ',' : '.') + match[2];
}

function ProductEditor({ entry, collections, close, saved }: {
  entry: Edit; collections: string[]; close: () => void; saved: () => Promise<void>;
}) {
  const { language, t, error } = useLocale();
  const l = (id: string, en: string) => language === 'id' ? id : en;
  const item = entry.item;
  const [color, setColor] = useState(item?.color ?? '');
  const [productType, setProductType] = useState(item?.productType ?? '');
  const [newCollection, setNewCollection] = useState(false);
  const [importedPhoto, setImportedPhoto] = useState('');
  const [title, setTitle] = useState(item?.title ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [price, setPrice] = useState(item?.priceMinor == null ? '' : String(item.priceMinor / 100));
  const [currency, setCurrency] = useState<Currency>(item?.currency ?? 'IDR');
  const [photo, setPhoto] = useState<File | 'import' | 'remove' | null>(null);
  const [localPhoto, setLocalPhoto] = useState('');
  const [pending, setPending] = useState<'import' | 'save' | null>(null);
  const [dirty, setDirty] = useState(false);
  const [failure, setFailure] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [fields, setFields] = useState<{ title?: string; url?: string; price?: string; photo?: string }>({});
  const linkField = useRef<HTMLInputElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const priceField = useRef<HTMLInputElement>(null);
  const photoField = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => (item ? titleField.current : linkField.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [item]);
  useEffect(() => {
    setLocalPhoto('');
    if (!(photo instanceof File)) return;
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
    setPending('import');
    setImportNotice('');
    setFields(previous => ({ ...previous, url: undefined }));
    try {
      const result = await api<ProductImport>('/products/import', { method: 'POST', data: { url: url.trim() } });
      if (result.status === 'manual_required') {
        setImportNotice(t('The retailer details are unavailable. You can enter them below.'));
        return;
      }
      if (result.name && !title.trim()) setTitle(result.name.slice(0, 160));
      if (result.price && !price) {
        setPrice(String(result.price.priceMinor / 100));
        setCurrency(result.price.currency);
      }
      const canImportPhoto = (photo === null && !item?.image) || photo === 'import';
      if (result.imagePath && canImportPhoto) {
        try {
          setImportedPhoto(await retailerPhoto(url.trim(), result.imagePath,
            result.productUrl, result.shopeeImageProof));
          setPhoto('import');
        } catch {
          setImportNotice(l('Detail diimpor. Foto belum tersedia dan bisa kamu unggah sendiri.', 'Details were imported. You can upload a photo.'));
          setDirty(true);
          return;
        }
      }
      setDirty(true);
      setImportNotice(t('Review the imported details before saving.'));
    } catch {
      setImportNotice(t('Could not import retailer details. Enter them below or try again.'));
    } finally {
      setPending(null);
      requestAnimationFrame(() => importButton.current?.focus());
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const [whole, fraction = ''] = price.split('.');
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    const validPrice = /^\d{1,8}(?:\.\d{1,2})?$/u.test(price) && amount <= 2147483647;
    const errors = {
      title: title.trim() ? undefined : t('Enter a product name.'),
      url: safeImportUrl(url.trim()) ? undefined : t('Enter a valid product link.'),
      price: price.trim() && !validPrice ? l('Masukkan harga yang valid, maksimal 21.474.836,47.', 'Enter a valid price up to 21,474,836.47.') : undefined,
      photo: fields.photo,
    };
    setFields(errors);
    if (errors.url || errors.title || errors.price || errors.photo) {
      (errors.url ? linkField.current : errors.title ? titleField.current : errors.price ? priceField.current : photoField.current)?.focus();
      return;
    }
    setPending('save');
    setFailure('');
    try {
      let encoded: string | null | undefined = photo === 'remove' ? null : undefined;
      if (photo instanceof File) {
        try { encoded = await photoBase64(await creatorJpeg(photo)); }
        catch {
          setFields(previous => ({ ...previous, photo: t('Could not read this photo. Choose another image up to 15 MB.') }));
          requestAnimationFrame(() => photoField.current?.focus());
          return;
        }
      } else if (photo === 'import') encoded = importedPhoto;
      const priceMinor = price.trim() ? amount : null;
      const data: CreatorProductInput = { title, url: url.trim(), description, category, color, productType, priceMinor, currency: priceMinor === null ? null : currency };
      await api(base + '/' + entry.id, { method: item ? 'PATCH' : 'PUT', data: { ...data, photo: encoded } });
      setDirty(false);
      await saved();
    } catch (problem) {
      setFailure(errorMessage(problem));
    } finally { setPending(null); }
  }

  const image = photo instanceof File ? localPhoto : photo === 'import' ? 'data:image/jpeg;base64,' + importedPhoto : photo === 'remove' ? '' : item?.image;
  return <form className="aw-section-stack" onChange={() => setDirty(true)} noValidate onSubmit={event => void save(event)}>
    <section className="aw-card">
      <header className="aw-card-header"><div><h2>{t('Product link')}</h2>
        <p>{l('Impor detail dari Shopee atau Tokopedia, atau isi data sendiri.', 'Import details from Shopee or Tokopedia, or fill them in yourself.')}</p></div></header>
      <fieldset className="aw-card-body aw-fields" disabled={pending !== null}>
        <div className="aw-field aw-full">
          <label htmlFor="catalog-url">{l('URL produk', 'Product URL')}</label>
          <div className="aw-link-input">
            <input id="catalog-url" name="url" autoComplete="off" spellCheck={false} ref={linkField} type="url" required maxLength={2048}
              placeholder="https://…" value={url} aria-invalid={Boolean(fields.url)} aria-describedby={fields.url ? 'catalog-url-error' : undefined}
              onChange={event => {
                setUrl(event.target.value);
                setImportNotice('');
                if (photo === 'import') { setPhoto(null); setImportedPhoto(''); }
              }} />
            <button type="button" ref={importButton} onClick={() => void importProduct()}>{pending === 'import' ? l('Mengimpor…', 'Importing…') : t('Import details')}</button>
          </div>
          {fields.url && <p role="alert" className="aw-error" id="catalog-url-error">{fields.url}</p>}
          {importNotice && <p role="status" className="aw-notice">{importNotice}</p>}
        </div>
      </fieldset>
    </section>
    <section className="aw-card">
      <header className="aw-card-header"><h2>{t('Product details')}</h2></header>
      <fieldset className="aw-card-body aw-fields" disabled={pending !== null}>
        <label className="aw-field aw-full">{t('Product name')}
          <input id="catalog-product-name" name="title" autoComplete="off" ref={titleField} required maxLength={160} value={title}
            aria-invalid={Boolean(fields.title)} aria-describedby={fields.title ? 'catalog-title-error' : undefined} onChange={event => setTitle(event.target.value)} />
          {fields.title && <small role="alert" className="aw-error" id="catalog-title-error">{fields.title}</small>}
        </label>
        <label className="aw-field">{t('Price')}
          <input id="catalog-price" name="price" autoComplete="off" ref={priceField} inputMode="decimal" value={displayPrice(price, language)}
            aria-invalid={Boolean(fields.price)} aria-describedby={fields.price ? 'catalog-price-error' : undefined}
            onChange={event => setPrice(normalizeProductPriceInput(event.target.value, language))} />
          {fields.price && <small role="alert" className="aw-error" id="catalog-price-error">{fields.price}</small>}
        </label>
        <div className="aw-field"><label htmlFor="catalog-currency">{t('Currency')}</label>
          <select id="catalog-currency" value={currency} onChange={event => setCurrency(event.target.value as Currency)}>
            {currencies.map(value => <option key={value}>{value}</option>)}
          </select>
        </div>
        <div className="aw-field"><label htmlFor="catalog-category">{t('Collection (optional)')}</label>
          <select id="catalog-category" value={newCollection ? 'new' : category ? 'existing:' + category : ''} onChange={event => {
            const value = event.target.value;
            setNewCollection(value === 'new');
            setCategory(value.startsWith('existing:') ? value.slice(9) : '');
          }}>
            <option value="">{t('No collection')}</option>
            {collections.map(name => <option key={name} value={'existing:' + name}>{name}</option>)}
            <option value="new">{t('New collection')}</option>
          </select>
        </div>
        {newCollection && <label className="aw-field">{t('Collection name')}<input maxLength={60} value={category} onChange={event => setCategory(event.target.value)} /></label>}
        <details className="aw-details aw-full">
          <summary>{t('Optional product details')}</summary>
          <div className="aw-fields">
            <label className="aw-field">{t('Color')}<input maxLength={60} value={color} onChange={event => setColor(event.target.value)} /></label>
            <label className="aw-field">{t('Product type')}<input maxLength={60} value={productType} onChange={event => setProductType(event.target.value)} /></label>
            <label className="aw-field aw-full">{t('Description')}<textarea rows={3} maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></label>
          </div>
        </details>
      </fieldset>
    </section>
    <section className="aw-card">
      <header className="aw-card-header"><h2>{t('Product photo (optional)')}</h2></header>
      <fieldset className="aw-card-body aw-photo-editor" disabled={pending !== null}>
        {image && <img key={image} className="aw-edit-photo" src={image} alt={t('Product photo')} onError={event => { event.currentTarget.hidden = true; }} />}
        <div className="aw-field">
          <label htmlFor="catalog-photo">{l(image ? 'Ganti foto' : 'Unggah foto', image ? 'Replace photo' : 'Upload photo')}</label>
          <input id="catalog-photo" name="photo" type="file" accept="image/*" ref={photoField}
            aria-invalid={Boolean(fields.photo)} aria-describedby={fields.photo ? 'catalog-photo-error' : undefined}
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (file.size > 15 * 1024 * 1024) {
                setFields(previous => ({ ...previous, photo: l('Pilih foto berukuran maksimal 15 MB.', 'Choose a photo up to 15 MB.') }));
                return;
              }
              setFields(previous => ({ ...previous, photo: undefined }));
              setPhoto(file);
            }} />
          {fields.photo && <small role="alert" className="aw-error" id="catalog-photo-error">{fields.photo}</small>}
          {photo instanceof File && <small role="status">{photo.name}</small>}
          {(image || photo instanceof File || fields.photo) && <button type="button" onClick={() => {
            if (image || photo instanceof File) { setPhoto('remove'); setImportedPhoto(''); setDirty(true); }
            setFields(previous => ({ ...previous, photo: undefined }));
          }}>{t('Continue without photo')}</button>}
        </div>
      </fieldset>
    </section>
    {failure && <p role="alert" className="aw-error">{error(failure)} {failure === 'Sign in to continue.' && <a href="/account?next=creator">{t('Sign in again')}</a>}</p>}
    <div className="aw-actions">
      <button type="submit" className="aw-primary" disabled={pending !== null}>{pending === 'save' ? l('Menyimpan…', 'Saving…') : item ? t('Save changes') : t('Save draft')}</button>
      <button type="button" disabled={pending !== null} onClick={() => {
        if (!dirty || window.confirm(t('Discard unsaved changes?'))) close();
      }}>{t('Cancel')}</button>
    </div>
  </form>;
}


async function photoBase64(blob: Blob) {
  const encoded = (await photoDataUrl(blob)).split(',')[1];
  if (!encoded) throw new Error('Invalid photo');
  return encoded;
}

async function retailerPhoto(url: string, preview: string, productUrl?: string, proof?: string) {
  if (preview.startsWith('/api/products/import/image?')) {
    const response = await fetch(preview, { redirect: 'error' });
    if (response.ok) {
      const blob = await response.blob();
      return photoBase64(await creatorJpeg(new File([blob], 'retailer-photo', { type: blob.type })));
    }
  }
  const response = await fetch('/api/account/creator/catalog/import-photo', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nanti-Request': '1' },
    body: JSON.stringify({ url, ...(productUrl && proof && { productUrl, imageUrl: preview, proof }) }),
  });
  if (response.status === 401) throw new Error('Sign in to continue.');
  if (!response.ok) throw new Error('Retailer photo unavailable');
  return photoBase64(await response.blob());
}
