import { useEffect, useRef, useState } from 'react';
import type { RecommendationAction, RecommendationCuration, RecommendationPreview, RecommendationWorkspaceProduct } from '../shared/recommendation-workspace.js';
import { formatPrice } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { WorkspaceThumbnail } from './admin-workspace.js';
import { Dialog } from './forms.js';

const blank: RecommendationCuration = { title: '', category: '', color: null, style: null, useCase: null, description: null };
const descriptors = [
  ['style', 'Gaya', 'Minimalis, modern'],
  ['useCase', 'Kegunaan', 'Hemat ruang, portabel'],
  ['color', 'Karakteristik', 'Putih, kayu, lipat'],
] as const;
const actions = {
  publish: ['Terbitkan', 'Rekomendasi diterbitkan.'],
  unpublish: ['Tarik publikasi', 'Publikasi ditarik.'],
  archive: ['Arsipkan', 'Rekomendasi diarsipkan.'],
  restore: ['Pulihkan sebagai draf', 'Rekomendasi dipulihkan sebagai draf.'],
} as const;

export function RecommendationCatalogForm({ product, base, close, onSaved, onExpired }: {
  product: RecommendationWorkspaceProduct | null; base: string; close: () => void;
  onSaved: (message: string) => void; onExpired: () => void;
}) {
  const [url, setUrl] = useState(product?.url ?? '');
  const [preview, setPreview] = useState<RecommendationPreview | null>(null);
  const [review, setReview] = useState(Boolean(product));
  const [draft, setDraft] = useState<RecommendationCuration>(() => product ? {
    title: product.title, category: product.category, color: product.color, style: product.style,
    useCase: product.useCase, description: product.description,
  } : blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const endpoint = product ? base + '/' + product.id : base;
  const metadata = preview?.metadata ?? (product ? { title: product.importedTitle, image: product.image, price: product.price } : null);

  useEffect(() => { field.current?.focus(); }, [review]);

  async function run(operation: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (failure) {
      const message = errorMessage(failure);
      if (message === 'Administrator sign-in is required.') onExpired();
      else setError(message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function importProduct() {
    return run(async () => {
      const imported = await api<RecommendationPreview>(base + '/preview', { method: 'POST', data: { url } });
      setPreview(imported);
      setDraft(current => ({ ...current, title: current.title || imported.metadata.title || '' }));
      setReview(true);
    });
  }

  function lifecycle(action: RecommendationAction) {
    return run(async () => {
      await api(endpoint + '/lifecycle', { method: 'PATCH', data: { action } });
      onSaved(actions[action][1]);
    });
  }

  const availableActions: RecommendationAction[] = product?.status === 'archived' ? ['restore'] :
    [product?.status === 'active' ? 'unpublish' : 'publish', 'archive'];
  return <Dialog title={product ? 'Edit rekomendasi' : 'Tambahkan saran produk'} busy={busy} close={close} className="aw-dialog"
    headerAction={<button type="button" className="aw-button" onClick={close} disabled={busy}>Tutup</button>}>
    {error && <p className="aw-error" role="alert">{error}</p>}
    {!review ? <form onSubmit={event => {
      event.preventDefault();
      void importProduct();
    }}>
      <label className="aw-field">Tautan produk
        <input ref={field} type="url" required maxLength={2048} value={url} onChange={event => setUrl(event.target.value)} />
      </label>
      <div className="aw-actions"><button type="submit" className="aw-primary" disabled={busy}>
        {busy ? 'Mengambil detail…' : 'Ambil detail produk'}
      </button></div>
    </form> : <>
      <section aria-label="Detail dari marketplace" className="aw-card aw-card-body">
        <h3>Detail dari marketplace</h3>
        <div className="aw-product-name">
          <WorkspaceThumbnail name={metadata?.title ?? ''} image={metadata?.image ?? null} />
          <div><strong>{metadata?.title ?? 'Nama belum tersedia'}</strong>
            <p>{metadata?.price ? formatPrice(metadata.price.priceMinor, metadata.price.currency, 'id-ID') : 'Harga belum tersedia'}</p></div>
        </div>
        <div className="aw-actions">
          {product && <button type="button" className="aw-button" disabled={busy} onClick={() => void importProduct()}>Ambil ulang detail</button>}
          {!product && <button type="button" className="aw-button" disabled={busy} onClick={() => {
            if (draft.title === preview?.metadata.title) setDraft({ ...draft, title: '' });
            setPreview(null);
            setError('');
            setReview(false);
          }}>Ubah tautan</button>}
        </div>
      </section>
      <form className="aw-section-stack" onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          await api(endpoint, { method: product ? 'PATCH' : 'POST', data: { curation: draft, ...(preview && { preview }) } });
          onSaved(product ? 'Perubahan tersimpan.' : 'Draf tersimpan.');
        });
      }}>
        <h3>Kurasi</h3>
        <div className="aw-fields">
          <label className="aw-field">Nama kurasi
            <input required maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label className="aw-field">Kategori utama
            <input ref={field} required maxLength={80} value={draft.category}
              onChange={event => setDraft({ ...draft, category: event.target.value })} />
          </label>
          {descriptors.map(([name, label, placeholder]) => <label key={name} className="aw-field">{label}
            <input maxLength={80} placeholder={placeholder} value={draft[name] ?? ''}
              onChange={event => setDraft({ ...draft, [name]: event.target.value || null })} />
          </label>)}
        </div>
        <label className="aw-field">Catatan kurasi
          <textarea maxLength={1000} value={draft.description ?? ''}
            onChange={event => setDraft({ ...draft, description: event.target.value || null })} />
        </label>
        <div className="aw-actions"><button type="submit" className="aw-primary" disabled={busy}>
          {busy ? 'Memproses…' : product ? 'Simpan perubahan' : 'Simpan draf'}
        </button></div>
      </form>
      {product && <div className="aw-actions aw-divided aw-card-body">
        {availableActions.map(action => <button key={action} type="button" className="aw-button"
          disabled={busy} onClick={() => void lifecycle(action)}>{actions[action][0]}</button>)}
      </div>}
    </>}
  </Dialog>;
}
