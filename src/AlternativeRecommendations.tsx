import { useState } from 'react';
import type { RecommendationMatch } from '../server/recommendation-matching.js';

type RequestState = 'idle' | 'submitting' | 'sent' | 'error';
export interface AlternativeRecommendationsProps {
  /** The parent purchase-decision flow decides whether alternatives are appropriate. */
  eligible: boolean;
  load: () => Promise<RecommendationMatch[]>;
  requestRecommendation: () => Promise<void>;
  onOpenProduct: (url: string) => void;
  canNotify: boolean;
  currency?: string;
}
export function AlternativeRecommendations({
  eligible, load, requestRecommendation, onOpenProduct, canNotify, currency = 'IDR',
}: AlternativeRecommendationsProps) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'empty' | 'error'>('idle');
  const [matches, setMatches] = useState<RecommendationMatch[]>([]);
  const [requestState, setRequestState] = useState<RequestState>('idle');
  if (!eligible) return null;
  const fetchAlternatives = async () => {
    if (status === 'loading') return;
    setExpanded(true);
    setStatus('loading');
    try {
      const result = await load();
      setMatches(result.slice(0, 3));
      setStatus(result.length ? 'success' : 'empty');
    } catch {
      setStatus('error');
    }
  };
  const sendRequest = async () => {
    if (requestState === 'submitting' || requestState === 'sent') return;
    setRequestState('submitting');
    try {
      await requestRecommendation();
      setRequestState('sent');
    } catch {
      setRequestState('error');
    }
  };
  return (
    <section aria-label="Alternatif lebih hemat" className="alternative-recommendations">
      {!expanded ? (
        <button type="button" onClick={fetchAlternatives}>Lihat alternatif lebih hemat</button>
      ) : (
        <>
          <button type="button" onClick={() => setExpanded(false)} aria-label="Tutup alternatif">Kembali ke hasil</button>
          <h3>Pilihan yang lebih hemat</h3>
          {status === 'loading' && <p role="status">Sebentar, kami cari pilihan yang cocok…</p>}
          {status === 'error' && (
            <div role="alert">
              <p>Ups, pilihannya belum bisa dimuat. Coba lagi sebentar, ya.</p>
              <button type="button" onClick={fetchAlternatives}>Coba lagi</button>
            </div>
          )}
          {status === 'empty' && (
            <div>
              <h4>Yah, belum nemu yang cocok nih.</h4>
              <p>Daripada asal kasih pilihan, mending kami cari yang benar-benar relevan.</p>
              {requestState === 'sent' ? (
                <p role="status">Siap, permintaanmu sudah dicatat. {canNotify ? 'Kami kabari lewat Nanti kalau sudah ada pilihan yang cocok.' : 'Masuk lagi dengan akunmu nanti untuk melihat pembaruan.'}</p>
              ) : (
                <>
                  <button type="button" disabled={requestState === 'submitting'} onClick={sendRequest}>
                    {requestState === 'submitting' ? 'Mengirim…' : 'Kasih tahu tim Nanti'}
                  </button>
                  {requestState === 'error' && <p role="alert">Belum berhasil dikirim. Boleh coba sekali lagi?</p>}
                  {!canNotify && <p>Tanpa akun, kami belum bisa menjanjikan notifikasi lintas perangkat.</p>}
                </>
              )}
            </div>
          )}
          {status === 'success' && (
            <>
              <ul>
                {matches.map(({ product, reasons }) => (
                  <li key={product.id}>
                    <strong>{product.title}</strong>
                    <p>{reasons.join(' · ')}</p>
                    {product.priceMinor !== null && <p><strong>{new Intl.NumberFormat('id-ID', {
                      style: 'currency', currency,
                    }).format(product.priceMinor / 100)}</strong></p>}
                    <button type="button" onClick={() => onOpenProduct(product.url)}>
                      Lihat produk
                    </button>
                  </li>
                ))}
              </ul>
              <p>Nggak harus beli sekarang. Pilihan ini hanya untuk membantu membandingkan.</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
