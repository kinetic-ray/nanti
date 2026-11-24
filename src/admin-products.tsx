import { useEffect, useRef, useState } from 'react';
import { Circle, CircleCheck, Package } from 'lucide-react';
import type { AdminCatalogProduct } from '../shared/admin-workspace.js';
import type { AdminPage } from '../shared/affiliate.js';
import { safeImportUrl } from '../shared/product-import.js';
import { formatPrice } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { WorkspaceEmpty, WorkspaceHeading, WorkspaceLoading, WorkspaceThumbnail } from './admin-workspace.js';
import { Dialog } from './forms.js';

type Detail = AdminCatalogProduct & { url: string; originalUrl: string };
const base = '/admin/products';
const title = (product: AdminCatalogProduct) => product.title ?? 'Nama produk belum tersedia';

function ProductSummary({ product }: { product: AdminCatalogProduct }) {
  return <>
    <WorkspaceThumbnail image={product.image} name={title(product)} />
    <div className="aw-submission-copy"><strong>{title(product)}</strong>
      <span>{product.merchant === 'Other' ? 'Marketplace belum diketahui' : product.merchant}</span>
      <span>{product.price ? formatPrice(product.price.priceMinor, product.price.currency, 'id-ID') : 'Harga belum tersedia'}</span>
    </div>
  </>;
}

function productFromLocation() {
  return /^#(?:product|opportunity)-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/iu.exec(location.hash)?.[1] ?? null;
}

export function AdminProducts({ onExpired }: { onExpired: () => void }) {
  const [q, setQuery] = useState('');
  const [state, setState] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const [result, setResult] = useState<AdminPage<AdminCatalogProduct>>();
  const [selected, setSelected] = useState(productFromLocation);
  const [revision, refresh] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const after = pages.at(-1);

  useEffect(() => {
    const sync = () => setSelected(productFromLocation());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ ...(q && { q }), ...(state && { state }), ...(after && { after }) });
    api<AdminPage<AdminCatalogProduct>>(`${base}?${params}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setResult(data); setError(''); }
    }, failure => {
      if (controller.signal.aborted) return;
      if (errorMessage(failure) === 'Administrator sign-in is required.') onExpired();
      else setError('Daftar produk gagal dimuat.');
    });
    return () => controller.abort();
  }, [q, state, after, revision, onExpired]);

  function close() {
    setSelected(null);
  }

  return <>
    <WorkspaceHeading title="Produk" />
    {notice && <p className="aw-notice aw-directory-notice" role="status">{notice}</p>}
    <section className="aw-card aw-submissions">
      <form className="aw-card-header aw-directory-search" onSubmit={event => {
        event.preventDefault();
        const query = String(new FormData(event.currentTarget).get('q')).trim();
        if (query !== q || after) setResult(undefined);
        setPages([]); setQuery(query);
      }}>
        <label className="aw-field">Cari produk <input type="search" name="q" maxLength={160} /></label>
        <button type="submit">Cari</button>
        <label className="aw-field">Status tautan <select value={state} onChange={event => {
          setResult(undefined); setPages([]); setState(event.target.value);
        }}>
          <option value="">Semua</option><option value="original">Belum diganti</option>
          <option value="replacement">Sudah diganti</option>
        </select></label>
      </form>
      {error ? <p role="alert" className="aw-error">{error} <button type="button" onClick={() => refresh(value => value + 1)}>Coba lagi</button></p> :
        !result ? <WorkspaceLoading /> : result.records.length ? <ul className="aw-submission-list">
          {result.records.map(product => <li key={product.id}>
            <div className="aw-catalog-summary"><ProductSummary product={product} /></div>
            <div className="aw-actions">
              <span className="aw-badge aw-replacement-status" data-live={product.replaced}>
                {product.replaced ? <CircleCheck size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
                {product.replaced ? 'Tautan diganti' : 'Belum diganti'}
              </span>
              <button type="button" aria-label={`Edit ${title(product)}`} onClick={() => {
                setNotice(''); setSelected(product.id);
              }}>Edit</button>
            </div>
          </li>)}
        </ul> : <WorkspaceEmpty icon={Package} title="Belum ada produk" />}
      {(after || result?.next) && <nav className="aw-actions" aria-label="Halaman produk">
        {after && <button type="button" onClick={() => {
          setResult(undefined); setPages(values => values.slice(0, -1));
        }}>Sebelumnya</button>}
        {result?.next && <button type="button" onClick={() => {
          setPages([...pages, result.next!]); setResult(undefined);
        }}>Berikutnya</button>}
      </nav>}
    </section>
    {selected && <ProductEditor key={selected} id={selected} onExpired={onExpired} close={close} saved={value => {
      setResult(current => current && ({ ...current, records: current.records
        .filter(row => row.id !== selected || !state || value.replaced === (state === 'replacement'))
        .map(row => row.id === selected ? { ...row, replaced: value.replaced } : row) }));
      refresh(current => current + 1);
      setNotice('Tautan produk berhasil diperbarui.');
      close();
    }} />}
  </>;
}

function ProductEditor({ id, onExpired, close, saved }: {
  id: string; onExpired: () => void; close: () => void; saved: (result: { replaced: boolean }) => void;
}) {
  const [product, setProduct] = useState<Detail>();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const path = `${base}/${id}`;
  const parsed = safeImportUrl(url.trim());
  const valid = url.trim() === product?.originalUrl || Boolean(parsed && parsed.protocol === 'https:' && !parsed.port);
  useEffect(() => {
    const controller = new AbortController();
    api<Detail>(path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setProduct(data); setUrl(data.url); }
    }, failure => {
      if (controller.signal.aborted) return;
      if (errorMessage(failure) === 'Administrator sign-in is required.') onExpired();
      else setError('Produk gagal dimuat.');
    });
    return () => controller.abort();
  }, [path, onExpired]);

  return <Dialog title="Edit produk" className="aw-dialog" busy={saving} close={close} focusHeading>
    {product ? <form onSubmit={async event => {
      event.preventDefault();
      if (pending.current || !valid || url.trim() === product.url) return;
      pending.current = true; setSaving(true); setError('');
      try { saved(await api<{ replaced: boolean }>(path, { method: 'PATCH', data: { url } })); }
      catch (failure) {
        const message = errorMessage(failure);
        if (message === 'Administrator sign-in is required.') onExpired();
        else setError(/^(Masukkan|Produk|Tautan)\b/u.test(message) ? message : 'Tautan gagal disimpan. Coba lagi.');
      } finally { pending.current = false; setSaving(false); }
    }}>
      <div className="aw-catalog-summary"><ProductSummary product={product} /></div>
      <label className="aw-field">URL produk <input type="url" value={url} maxLength={2048} required disabled={saving}
        onChange={event => { setUrl(event.target.value); setError(''); }} /></label>
      {!valid && url !== product.url && <p>Masukkan URL produk HTTPS yang valid.</p>}
      {error && <p role="alert" className="aw-error">{error}</p>}
      <div className="aw-actions">
        <button type="button" disabled={saving} onClick={close}>Batal</button>
        <button type="submit" className="aw-primary" disabled={saving || !valid || url.trim() === product.url}>
          {saving ? 'Menyimpan…' : 'Simpan perubahan'}
        </button>
      </div>
    </form> : error ? <p role="alert">{error}</p> : <WorkspaceLoading />}
  </Dialog>;
}
