import { useState } from 'react';

export interface CuratedCatalogDraft {
  title: string;
  url: string;
  category: string;
  color: string | null;
  style: string | null;
  useCase: string | null;
  description: string | null;
  priceMinor: number | null;
  currency: 'IDR';
  priority: number;
}
type Step = 'link' | 'review' | 'done';
export interface RecommendationCatalogFormProps {
  /** Admin-only API, authenticated and authorized by the server. */
  importLink: (url: string) => Promise<Partial<CuratedCatalogDraft>>;
  saveDraft: (draft: CuratedCatalogDraft) => Promise<void>;
  initialDraft?: CuratedCatalogDraft;
}
const blank = (url: string): CuratedCatalogDraft => ({
  title: '', url, category: '', color: null, style: null,
  useCase: null, description: null, priceMinor: null, currency: 'IDR', priority: 0,
});
export function RecommendationCatalogForm({ importLink, saveDraft, initialDraft }: RecommendationCatalogFormProps) {
  const [step, setStep] = useState<Step>(initialDraft ? 'review' : 'link');
  const [link, setLink] = useState(initialDraft?.url ?? '');
  const [draft, setDraft] = useState<CuratedCatalogDraft | null>(initialDraft ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fetchDetails = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const parsed = new URL(link.trim());
      if (parsed.protocol !== 'https:') throw new Error('Gunakan link HTTPS yang valid.');
      const imported = await importLink(parsed.href);
      setDraft({ ...blank(parsed.href), ...imported, url: parsed.href, currency: 'IDR', priority: 0 });
      setStep('review');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Detail produk belum bisa diambil. Coba lagi.');
    } finally { setBusy(false); }
  };
  const submit = async () => {
    if (!draft || busy) return;
    if (!draft.title.trim() || !draft.category.trim()) {
      setError('Isi nama dan kategori produk dulu, ya.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await saveDraft(draft);
      setStep('done');
    } catch {
      setError('Draf belum tersimpan. Periksa koneksi dan coba lagi.');
    } finally { setBusy(false); }
  };
  return (
    <section aria-label={initialDraft ? 'Edit rekomendasi' : 'Tambah rekomendasi'} className="recommendation-catalog-form">
      <h2>{initialDraft ? 'Edit rekomendasi' : 'Tambah rekomendasi'}</h2>
      <p>Tempel link produk, lalu lengkapi detailnya. Nama produk dicoba diambil otomatis dari marketplace. Kalau tidak tersedia, isi manual saja.</p>
      {step === 'link' && (
        <form onSubmit={event => { event.preventDefault(); void fetchDetails(); }}>
          <label htmlFor="recommendation-link">Link produk</label>
          <input id="recommendation-link" type="url" inputMode="url" autoComplete="url"
            required placeholder="https://..." value={link} onChange={event => setLink(event.target.value)} />
          <button type="submit" disabled={busy}>{busy ? 'Mengambil detail…' : 'Lanjut'}</button>
        </form>
      )}
      {step === 'review' && draft && (
        <form onSubmit={event => { event.preventDefault(); void submit(); }}>
          <p>Periksa dulu, lalu simpan sebagai draf. Produk belum tampil untuk pengguna.</p>
          <label htmlFor="recommendation-product-url">Link produk</label>
          <input id="recommendation-product-url" type="url" required maxLength={2048}
            value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} />
          <label htmlFor="recommendation-title">Nama produk</label>
          <input id="recommendation-title" required maxLength={160} value={draft.title}
            onChange={event => setDraft({ ...draft, title: event.target.value })} />
          <label htmlFor="recommendation-category">Kategori</label>
          <input id="recommendation-category" required maxLength={80} value={draft.category}
            placeholder="Misalnya sneakers" onChange={event => setDraft({ ...draft, category: event.target.value })} />
          <label htmlFor="recommendation-color">Warna (opsional)</label>
          <input id="recommendation-color" maxLength={80} value={draft.color ?? ''}
            placeholder="Misalnya putih" onChange={event => setDraft({ ...draft, color: event.target.value || null })} />
          <label htmlFor="recommendation-style">Gaya (opsional)</label>
          <input id="recommendation-style" maxLength={80} value={draft.style ?? ''}
            placeholder="Misalnya retro" onChange={event => setDraft({ ...draft, style: event.target.value || null })} />
          <label htmlFor="recommendation-use-case">Kegunaan (opsional)</label>
          <input id="recommendation-use-case" maxLength={80} value={draft.useCase ?? ''}
            placeholder="Misalnya sehari-hari" onChange={event => setDraft({ ...draft, useCase: event.target.value || null })} />
          <label htmlFor="recommendation-description">Catatan produk (opsional)</label>
          <textarea id="recommendation-description" maxLength={1000} value={draft.description ?? ''}
            onChange={event => setDraft({ ...draft, description: event.target.value || null })} />
          <label htmlFor="recommendation-price">Harga (opsional, rupiah)</label>
          <input id="recommendation-price" inputMode="numeric" value={draft.priceMinor === null ? '' : new Intl.NumberFormat('id-ID').format(draft.priceMinor / 100)}
            onChange={event => {
              const digits = event.target.value.replace(/\D/gu, '');
              const amount = digits ? Number(digits) : null;
              setDraft({ ...draft, priceMinor: amount !== null && Number.isSafeInteger(amount * 100) ? amount * 100 : null });
            }} />
          <p>Harga yang diisi belum dianggap terverifikasi sampai diperiksa di listing.</p>
          <button type="button" disabled={busy} onClick={() => setStep('link')}>Kembali</button>
          <button type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan draf'}</button>
        </form>
      )}
      {step === 'done' && <p role="status">Draf tersimpan. Periksa harga dan terbitkan dari katalog saat sudah siap.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
