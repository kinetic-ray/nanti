import { useEffect, useState } from 'react';
import { api, errorMessage } from './api.js';
import { RecommendationCatalogForm, type CuratedCatalogDraft } from './RecommendationCatalogForm.js';

type CatalogItem = CuratedCatalogDraft & {
  id: string; published: boolean; priceVerified: boolean; priceVerifiedAt: string | null;
};
type PendingRequest = { id: string; productName: string; status: string; createdAt: string };
const base = '/admin/recommendations';
export function RecommendationAdminPanel() {
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const [verificationPrice, setVerificationPrice] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<{ products: CatalogItem[] }>(`${base}/catalog`, { signal: controller.signal }),
      api<{ requests: PendingRequest[] }>(`${base}/requests`, { signal: controller.signal }),
    ]).then(([catalog, pending]) => {
      setProducts(catalog.products); setRequests(pending.requests); setUnavailable(false); setError('');
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const message = errorMessage(failure);
      if (/not found|not configured|administrator endpoint/i.test(message)) setUnavailable(true);
      else setError(message);
    });
    return () => controller.abort();
  }, [refresh]);
  async function mutate(id: string, operation: () => Promise<unknown>) {
    setBusy(id); setError('');
    try { await operation(); setRefresh(value => value + 1); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(''); }
  }
  if (unavailable) return null;
  return <section className="admin-panel" aria-label="Rekomendasi produk">
    <h2>Rekomendasi produk</h2>
    <p>Kurasi alternatif yang relevan. Produk baru selalu disimpan sebagai draf.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <RecommendationCatalogForm
      importLink={async url => {
        const result = await api<{ name?: string; price?: number }>(
          '/products/import', { method: 'POST', data: { url } });
        return { title: result.name ?? '', priceMinor: null };
      }}
      saveDraft={async (draft) => {
        await api(`${base}/catalog`, { method: 'POST', data: draft });
        setRefresh(value => value + 1);
      }}
    />
    <h3>Katalog ({products.length})</h3>
    {products.length === 0 ? <p>Belum ada produk rekomendasi.</p> : <ul>
      {products.map(product => <li key={product.id}>
        <strong>{product.title}</strong>
        <p>{product.category} · {product.published ? 'Terbit' : 'Draf'} · {product.priceVerified ? 'Harga dikonfirmasi' : 'Harga belum diverifikasi'}</p>
        {product.priceMinor !== null && <p>{new Intl.NumberFormat('id-ID', { style: 'currency', currency: product.currency }).format(product.priceMinor / 100)}</p>}
        {!product.published && <form onSubmit={event => {
          event.preventDefault();
          const digits = (verificationPrice[product.id] ?? '').replace(/\\D/gu, '');
          const amount = Number(digits);
          if (!Number.isSafeInteger(amount * 100) || amount <= 0) {
            setError('Isi harga produk yang valid.');
            return;
          }
          void mutate(product.id, () => api(`${base}/catalog/${product.id}/verify-price`, {
            method: 'POST', data: { priceMinor: amount * 100, checkedUrl: product.url, confirmedOnListing: true },
          }));
        }}>
          <label>Harga terbaru setelah dicek di listing
            <input inputMode="numeric" required placeholder="Contoh: 750.000"
              value={verificationPrice[product.id] ?? ''}
              onChange={event => {
                const digits = event.target.value.replace(/\\D/gu, '');
                setVerificationPrice(current => ({
                  ...current, [product.id]: digits ? new Intl.NumberFormat('id-ID').format(Number(digits)) : '',
                }));
              }} />
          </label>
          <a href={product.url} target="_blank" rel="noopener noreferrer">Periksa listing</a>
          <button type="submit" disabled={busy !== ''}>Konfirmasi harga</button>
        </form>}
        {!product.published && <button type="button" disabled={busy !== '' || !product.priceVerified}
          onClick={() => void mutate(product.id, () => api(`${base}/catalog/${product.id}/publication`, {
            method: 'PATCH', data: { published: true },
          }))}>Terbitkan</button>}
        {product.published && <button type="button" disabled={busy !== ''}
          onClick={() => void mutate(product.id, () => api(`${base}/catalog/${product.id}/publication`, {
            method: 'PATCH', data: { published: false },
          }))}>Tarik publikasi</button>}
      </li>)}
    </ul>}
    <h3>Permintaan pengguna ({requests.filter(request => request.status === 'pending').length} menunggu)</h3>
    {requests.length === 0 ? <p>Belum ada permintaan.</p> : <ul>
      {requests.map(request => <li key={request.id}>{request.productName} · {request.status === 'pending' ? 'Menunggu' : 'Terpenuhi'}</li>)}
    </ul>}
  </section>;
}
