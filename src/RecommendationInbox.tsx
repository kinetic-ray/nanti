import { useEffect, useState } from 'react';
import { api, errorMessage } from './api.js';

type Notice = {
  id: string; readAt: string | null; createdAt: string;
  request: { productName: string };
  product: { id: string; title: string; url: string; priceMinor: number | null; currency: string };
};
export function RecommendationInbox({ close }: { close: () => void }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<{ notices: Notice[] }>('/recommendations/notifications', { signal: controller.signal })
      .then(result => { setNotices(result.notices); setError(''); }, failure => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  async function markRead(id: string) {
    try {
      await api(`/recommendations/notifications/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
      });
      setNotices(current => current.map(notice =>
        notice.id === id ? { ...notice, readAt: new Date().toISOString() } : notice));
    } catch (failure) { setError(errorMessage(failure)); }
  }
  return <section className="admin-panel recommendation-inbox" aria-label="Kabar alternatif produk">
    <div className="actions"><h2>Kabar alternatif</h2><button type="button" onClick={close}>Tutup</button></div>
    <p>Pilihan baru untuk produk yang pernah kamu minta. Cek lagi harga dan kebutuhanmu sebelum membeli.</p>
    {loading && <p role="status">Memuat kabar…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setReload(value => value + 1)}>Coba lagi</button></div>}
    {!loading && !error && notices.length === 0 && <p>Belum ada kabar baru.</p>}
    <ul>
      {notices.map(notice => <li key={notice.id}>
        <strong>{notice.product.title}</strong>
        <p>Alternatif untuk {notice.request.productName}</p>
        {notice.product.priceMinor !== null && <p>{new Intl.NumberFormat('id-ID', {
          style: 'currency', currency: notice.product.currency,
        }).format(notice.product.priceMinor / 100)}</p>}
        <a href={notice.product.url} target="_blank" rel="noopener noreferrer"
          onClick={() => { if (!notice.readAt) void markRead(notice.id); }}>Lihat produk</a>
        {!notice.readAt && <button type="button" onClick={() => void markRead(notice.id)}>Tandai dibaca</button>}
      </li>)}
    </ul>
  </section>;
}
