import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { RecommendationWorkspaceProduct } from '../shared/recommendation-workspace.js';
import { formatPrice } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { WorkspaceEmpty, WorkspaceHeading, WorkspaceLoading, WorkspacePagination, WorkspaceThumbnail } from './admin-workspace.js';
import { RecommendationCatalogForm } from './RecommendationCatalogForm.js';

export const recommendationWorkspacePath = '/admin/recommendations/workspace';
type Catalog = { products: RecommendationWorkspaceProduct[]; total: number; categories: string[] };
const statusLabels = { draft: 'Draf', active: 'Terbit', archived: 'Diarsipkan' };
const size = 20;

export function RecommendationAdminPanel({ onExpired }: { onExpired: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<RecommendationWorkspaceProduct | 'new' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    if (query) params.set('q', query);
    if (status) params.set('status', status);
    if (category) params.set('category', category);
    setLoading(true);
    setError('');
    api<Catalog>(recommendationWorkspacePath + '?' + params, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(result.total / size));
      if (page > lastPage) return setPage(lastPage);
      setCatalog(result);
      setLoading(false);
    }).catch(failure => {
      if (controller.signal.aborted) return;
      if (errorMessage(failure) === 'Administrator sign-in is required.') onExpired();
      else setError('Rekomendasi belum dapat dimuat.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [category, onExpired, page, query, refresh, status]);

  return <div className="aw-section-stack">
    <WorkspaceHeading title="Rekomendasi" description="Kurasi produk marketplace untuk pilihan alternatif di Nanti."
      action={<button type="button" className="aw-primary" onClick={() => setEditor('new')}>Tambahkan saran produk</button>} />
    {notice && <p className="aw-notice" role="status">{notice}</p>}
    <section className="aw-card" aria-label="Daftar rekomendasi" aria-busy={loading}>
      <form className="aw-card-header aw-directory-search aw-recommendation-filters" onSubmit={event => {
        event.preventDefault();
        setPage(1);
        setQuery(search.trim());
      }}>
        <label className="aw-field">Cari produk
          <span className="aw-search"><Search size={16} aria-hidden="true" />
            <input type="search" value={search} maxLength={160} onChange={event => setSearch(event.target.value)} />
          </span>
        </label>
        <button type="submit" className="aw-button">Cari</button>
        <label className="aw-field">Status publikasi
          <select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
            <option value="">Semua status</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="aw-field">Kategori
          <select value={category} onChange={event => { setCategory(event.target.value); setPage(1); }}>
            <option value="">Semua kategori</option>
            {catalog?.categories.map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
      </form>
      {loading && !catalog ? <WorkspaceLoading label="Memuat rekomendasi…" /> : error ? <div className="aw-error aw-actions" role="alert">
        <span>{error}</span><button type="button" className="aw-button" onClick={() => setRefresh(value => value + 1)}>Coba lagi</button>
      </div> : catalog?.products.length ? <>
        <div role="region" className="aw-table-scroll" aria-label="Produk rekomendasi" tabIndex={0}>
          <table className="aw-table aw-directory-table" role="table">
            <thead><tr>{['Produk', 'Harga marketplace', 'Marketplace', 'Kategori', 'Status', 'Tindakan'].map(label =>
              <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>{catalog.products.map(product => {
              const title = product.importedTitle ?? product.title;
              return <tr key={product.id}>
                <td className="aw-product-cell"><div className="aw-product-name"><WorkspaceThumbnail name={title} image={product.image} /><strong>{title}</strong></div></td>
                <td className="aw-nowrap"><span className="aw-mobile-cell-label" aria-hidden="true">Harga marketplace</span>
                  {product.price ? formatPrice(product.price.priceMinor, product.price.currency, 'id-ID') : 'Belum tersedia'}</td>
                <td><span className="aw-mobile-cell-label" aria-hidden="true">Marketplace</span>{product.marketplace ?? 'Belum tersedia'}</td>
                <td><span className="aw-mobile-cell-label" aria-hidden="true">Kategori</span>{product.category || 'Belum diisi'}</td>
                <td><span className="aw-mobile-cell-label" aria-hidden="true">Status</span>
                  <span className="aw-badge" data-live={product.status === 'active'}>{statusLabels[product.status]}</span></td>
                <td className="aw-actions-cell"><button type="button" className="aw-button" aria-label={'Edit ' + title}
                  onClick={() => setEditor(product)}>Edit</button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="aw-table-footer"><span>{catalog.total.toLocaleString('id-ID')} hasil</span>
          <WorkspacePagination page={page} pages={Math.ceil(catalog.total / size)} onPage={setPage} /></div>
      </> : <WorkspaceEmpty title={query || status || category ? 'Produk tidak ditemukan' : 'Belum ada produk rekomendasi'}
        description={query || status || category ? 'Coba kata kunci atau filter lain.' : 'Tambahkan produk dari marketplace untuk memulai.'} />}
    </section>
    {editor && <RecommendationCatalogForm product={editor === 'new' ? null : editor} base={recommendationWorkspacePath}
      close={() => setEditor(null)} onExpired={onExpired} onSaved={message => {
        setEditor(null);
        setNotice(message);
        setRefresh(value => value + 1);
      }} />}
  </div>;
}
