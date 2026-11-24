import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { CircleCheck, ClipboardList, ExternalLink, Link2, Package, Search, Store, UserRound, Users } from 'lucide-react';
import type { PlatformAudit, PlatformCreator, PlatformPage, PlatformProduct, PlatformSettingsStatus, PlatformStorefront, PlatformSummary, PlatformUser } from '../shared/admin-workspace.js';
import type { AdminPage, Opportunity } from '../shared/affiliate.js';
import { safeImportUrl } from '../shared/product-import.js';
import { formatPrice } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { WorkspaceEmpty, WorkspaceHeading, WorkspaceLoading, WorkspacePagination, WorkspaceStats, WorkspaceThumbnail } from './admin-workspace.js';
import { productSource, productSources } from './workspace-product-source.js';

const base = '/admin/workspace';
const date = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
type Directory = 'products' | 'users' | 'creators' | 'storefronts';
type OnExpired = () => void;
type State<T> = { data?: T; error?: string };
type Action = { type: 'link'; row: PlatformProduct } | { type: 'unpublish-product'; row: PlatformProduct }
  | { type: 'unpublish-storefront'; row: PlatformStorefront };
const directories = {
  products: { title: 'Produk', description: 'Periksa tautan produk dan tarik publikasi jika diperlukan.', search: 'Nama produk atau kreator' },
  users: { title: 'Pengguna', description: 'Lihat akun Nanti dan peran yang terdaftar.', search: 'Nama pengguna atau ID akun' },
  creators: { title: 'Kreator', description: 'Lihat profil kreator dan jumlah produk di setiap katalog.', search: 'Nama kreator' },
  storefronts: { title: 'Etalase', description: 'Periksa status publikasi dan tarik etalase dari publik jika diperlukan.', search: 'Nama etalase' },
} as const;

function failureMessage(failure: unknown) {
  const message = errorMessage(failure);
  if (message === 'This administrator endpoint could not be found.') return 'Fitur administrasi ini belum tersedia di lingkungan ini.';
  if (message === 'Database temporarily unavailable. Try again shortly.') return 'Database sementara tidak tersedia. Coba lagi.';
  if (/^(Masukkan|Produk|Tautan|Etalase)\b/u.test(message)) return message;
  return 'Permintaan belum berhasil. Coba lagi.';
}

function usePlatformData<T>(path: string, onExpired: OnExpired, change = 0) {
  const [result, setResult] = useState<{ path: string; value: State<T> }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<T>(base + path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({ path, value: { data } });
    }, failure => {
      if (controller.signal.aborted) return;
      if (errorMessage(failure) === 'Administrator sign-in is required.') onExpired();
      else setResult({ path, value: { error: failureMessage(failure) } });
    });
    return () => controller.abort();
  }, [path, revision, onExpired, change]);
  return {
    ...(result?.path === path ? result.value : {}),
    reload: () => { setResult(undefined); setRevision(value => value + 1); },
  };
}

function ReportError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="aw-error aw-actions" role="alert"><span>{message}</span>
    <button type="button" onClick={retry}>Coba lagi</button></div>;
}

function SubmissionQueue({ onExpired, revision }: { onExpired: OnExpired; revision: number }) {
  const [result, setResult] = useState<AdminPage<Opportunity>>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [after, setAfter] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    const search = after ? '?' + new URLSearchParams({ after }) : '';
    api<AdminPage<Opportunity>>('/admin/opportunities' + search, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setResult(data); setError(''); }
    }, failure => {
      if (controller.signal.aborted) return;
      if (errorMessage(failure) === 'Administrator sign-in is required.') onExpired();
      else setError(failureMessage(failure));
    });
    return () => controller.abort();
  }, [after, onExpired, reload, revision]);
  return <section className="aw-card aw-submissions">
    <header className="aw-card-header"><div><h2>Produk yang disimpan pengguna</h2>
      <p>Antrean katalog bersama. Informasi wishlist pribadi tidak ditampilkan.</p></div>
      <button type="button" onClick={() => { setError(''); setResult(undefined); setAfter(undefined); setReload(value => value + 1); }}>Muat ulang</button>
    </header>
    {error ? <ReportError message={error} retry={() => setReload(value => value + 1)} /> : !result ? <WorkspaceLoading /> :
      result.records.length ? <ul className="aw-submission-list">{result.records.map(product => {
        const status = product.submissionStatus === 'affiliate_link_assigned' ? 'Tautan afiliasi ditetapkan' :
          product.submissionStatus === 'reviewed' ? 'Sudah ditinjau' : 'Menunggu tinjauan';
        return <li key={product.id}>
          <div className="aw-submission-copy"><strong>{product.title ?? 'Nama produk belum tersedia'}</strong>
            <span>{product.merchant === 'Other' ? 'Marketplace belum diketahui' : product.merchant} · {product.savedCount} kali disimpan</span>
            <span className="aw-badge" data-live={product.submissionStatus === 'affiliate_link_assigned'}>{status}</span>
          </div>
          <div className="aw-actions">
            <a className="aw-button" href={product.canonicalUrl} target="_blank" rel="noopener noreferrer">Buka tautan asli</a>
            <a className="aw-button aw-primary" href={`/admin?section=links#opportunity-${product.id}`}>Tinjau tautan afiliasi</a>
          </div>
        </li>;
      })}</ul> : <WorkspaceEmpty icon={Package} title="Belum ada produk tersimpan" />}
    {(after || result?.next) && <div className="aw-actions">
      {after && <button type="button" onClick={() => { setResult(undefined); setAfter(undefined); }}>Halaman pertama</button>}
      {result?.next && <button type="button" onClick={() => { setAfter(result.next!); setResult(undefined); }}>Halaman berikutnya</button>}
    </div>}
  </section>;
}

function publication(published: boolean, label?: string) {
  return <span className="aw-badge" data-live={published}>{published ? 'Terbit' : label ?? 'Draf'}</span>;
}

function Time({ value }: { value: string }) {
  return <time dateTime={value}>{date.format(new Date(value))}</time>;
}

export function PlatformOverview({ open, onExpired }: { open: (section: 'products' | 'storefronts') => void; onExpired: OnExpired }) {
  const { data, error, reload } = usePlatformData<PlatformSummary>('/overview', onExpired);
  return <>
    <WorkspaceHeading title="Ringkasan" description="Pantau akun, katalog kreator, dan etalase Nanti." />
    {error ? <ReportError message={error} retry={reload} /> : data ? <>
      <WorkspaceStats items={[
        { label: 'Pengguna', value: data.users, icon: UserRound },
        { label: 'Kreator', value: data.creators, icon: Users },
        { label: 'Produk kreator', value: data.products, icon: Package },
        { label: 'Etalase terbit', value: data.liveStorefronts, icon: Store },
      ]} />
      <div className="aw-card">
        <section className="aw-card-header">
          <div><h2>Katalog kreator</h2><p>Periksa produk, sumber, dan tautan etalase.</p></div>
          <button type="button" onClick={() => open('products')}>Lihat produk</button>
        </section>
        <section className="aw-card-header aw-divided">
          <div><h2>Etalase kreator</h2><p>Tinjau etalase yang tersedia untuk pengunjung.</p></div>
          <button type="button" onClick={() => open('storefronts')}>Lihat etalase</button>
        </section>
      </div>
    </> : <WorkspaceLoading label="Memuat ringkasan platform…" />}
  </>;
}

type Column<Row> = { label: string; cell: (row: Row) => ReactNode; className?: string };

function PlatformTable<Row extends { id: string }>({ directory, columns, onExpired, revision, notice }: {
  directory: Directory; columns: Column<Row>[]; onExpired: OnExpired; revision: number; notice: string;
}) {
  const copy = directories[directory];
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, reload } = usePlatformData<PlatformPage<Row>>(
    '/' + directory + '?' + new URLSearchParams({ page: String(page), q: query }), onExpired, revision,
  );

  return <>
    <WorkspaceHeading title={copy.title} description={copy.description} />
    {notice && <p className="aw-notice aw-directory-notice" role="status">{notice}</p>}
    <div className="aw-card">
      <form className="aw-card-header aw-directory-search" onSubmit={event => {
        event.preventDefault();
        if (query === input.trim() && page === 1) return;
        setPage(1);
        setQuery(input.trim());
      }}>
        <label className="aw-field">{copy.search}
          <span className="aw-search"><Search size={16} aria-hidden="true" />
            <input type="search" maxLength={100} value={input} onChange={event => setInput(event.target.value)} /></span>
        </label>
        <button type="submit">Cari</button>
        {query && <button type="button" onClick={() => { setInput(''); setQuery(''); setPage(1); }}>Hapus pencarian</button>}
      </form>
      {error ? <ReportError message={error} retry={reload} /> : !data ? <WorkspaceLoading /> : data.records.length ? <>
        <div role="region" className="aw-table-scroll" aria-label={copy.title} tabIndex={0}>
          <table className="aw-table aw-directory-table" role="table">
            <thead role="rowgroup"><tr role="row">{columns.map(column =>
              <th scope="col" role="columnheader" key={column.label}>{column.label}</th>)}</tr></thead>
            <tbody role="rowgroup">{data.records.map(row => <tr key={row.id} role="row">{columns.map(column =>
              <td key={column.label} role="cell" className={column.className}>
                <span className="aw-mobile-cell-label" aria-hidden="true">{column.label}</span>{column.cell(row)}
              </td>)}</tr>)}</tbody>
          </table>
        </div>
        <div className="aw-table-footer"><span>{data.total.toLocaleString('id-ID')} hasil</span>
          <WorkspacePagination page={data.page} pages={data.pages} onPage={setPage} /></div>
      </> : <WorkspaceEmpty icon={Search} title="Belum ada hasil" description={query ? 'Coba cari dengan kata lain.' : undefined} />}
    </div>
  </>;
}

export function PlatformDirectory({ directory, onExpired }: { directory: Directory; onExpired: OnExpired }) {
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  function finished(message: string) {
    setAction(null);
    setNotice(message);
    setRevision(value => value + 1);
  }

  return <>
    {directory === 'products' && <>
      <WorkspaceHeading title="Produk" description="Tinjau kiriman pengguna dan kelola produk katalog kreator." />
      <SubmissionQueue onExpired={onExpired} revision={revision} />
      <PlatformTable<PlatformProduct> directory={directory} onExpired={onExpired} revision={revision} notice={notice} columns={[
      { label: 'Produk', className: 'aw-product-cell', cell: row => <div className="aw-product-name"><WorkspaceThumbnail image={row.image} name={row.title} /><strong>{row.title}</strong></div> },
      { label: 'Kreator', cell: row => row.creator },
      { label: 'Harga', className: 'aw-nowrap', cell: row => row.priceMinor == null || !row.currency ? '—' : formatPrice(row.priceMinor, row.currency, 'id-ID') },
      { label: 'Sumber', cell: row => productSources[productSource(row.url)] },
      { label: 'Status', cell: row => publication(row.published) },
      { label: 'Tindakan', className: 'aw-actions-cell', cell: row => <div className="aw-actions">
        <button type="button" aria-label={'Ubah tautan ' + row.title} onClick={() => setAction({ type: 'link', row })}>
          <Link2 size={16} aria-hidden="true" />Ubah tautan
        </button>
        {row.published && <button type="button" aria-label={'Tarik produk ' + row.title}
          onClick={() => setAction({ type: 'unpublish-product', row })}>Tarik produk</button>}
      </div> },
    ]} />
    </>}
    {directory === 'users' && <PlatformTable<PlatformUser> directory={directory} onExpired={onExpired} revision={revision} notice={notice} columns={[
      { label: 'Pengguna', className: 'aw-product-cell', cell: row => <div><strong>{row.displayName || 'Akun tanpa nama'}</strong><br /><code>{row.id}</code></div> },
      { label: 'Peran akun', cell: row => row.role === 'admin' ? 'Administrator' : 'Anggota' },
      { label: 'Profil kreator', cell: row => row.creator ?? '—' },
      { label: 'Terdaftar', className: 'aw-nowrap', cell: row => <Time value={row.createdAt} /> },
    ]} />}
    {directory === 'creators' && <PlatformTable<PlatformCreator> directory={directory} onExpired={onExpired} revision={revision} notice={notice} columns={[
      { label: 'Kreator', className: 'aw-product-cell', cell: row => <strong>{row.name}</strong> },
      { label: 'Pemilik akun', cell: row => row.user ?? '—' },
      { label: 'Produk', cell: row => row.products.toLocaleString('id-ID') },
      { label: 'Terdaftar', className: 'aw-nowrap', cell: row => <Time value={row.createdAt} /> },
    ]} />}
    {directory === 'storefronts' && <PlatformTable<PlatformStorefront> directory={directory} onExpired={onExpired} revision={revision} notice={notice} columns={[
      { label: 'Etalase', className: 'aw-product-cell', cell: row => <strong>{row.name}</strong> },
      { label: 'Produk terbit', cell: row => row.products.toLocaleString('id-ID') },
      { label: 'Status', cell: row => publication(row.published, 'Privat') },
      { label: 'Tindakan', className: 'aw-actions-cell', cell: row => row.published ? <div className="aw-actions">
        <a className="aw-button" href={'/store/' + row.handle} target="_blank" rel="noopener noreferrer"
          aria-label={'Buka etalase ' + row.name}><ExternalLink size={16} aria-hidden="true" />Buka</a>
        <button type="button" aria-label={'Tarik etalase ' + row.name} onClick={() => setAction({ type: 'unpublish-storefront', row })}>Tarik publikasi</button>
      </div> : '—' },
    ]} />}
    {action && <PlatformAction action={action} onExpired={onExpired} cancel={() => setAction(null)} finished={finished}
      stale={() => { setAction(null); setRevision(value => value + 1); }} />}
  </>;
}

function PlatformAction({ action, onExpired, cancel, finished, stale }: {
  action: Action; onExpired: OnExpired; cancel: () => void; finished: (message: string) => void; stale: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const link = action.type === 'link' ? safeImportUrl(action.row.url) : null;
  const lostUpdate = error === 'Tautan sudah berubah. Muat ulang daftar produk.' || error === 'Produk tidak ditemukan.';
  const isStorefront = action.type === 'unpublish-storefront';
  useEffect(() => { dialog.current?.showModal(); }, []);
  function close(next: () => void) {
    dialog.current?.close();
    next();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const reason = String(fields.get('reason') ?? '').trim();
    const url = String(fields.get('url') ?? '').trim();
    const candidate = safeImportUrl(url);
    if (action.type === 'link' && (candidate?.protocol !== 'https:' || candidate.port)) {
      setError('Masukkan tautan produk HTTPS yang valid.');
      return;
    }
    if (action.type === 'link' && url === action.row.url) {
      setError('Masukkan tautan yang berbeda dari tautan saat ini.');
      return;
    }
    if (reason.length < 3) {
      setError('Masukkan alasan perubahan.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (action.type === 'link') {
        await api(`${base}/products/${action.row.id}/link`, { method: 'PATCH', data: { url, expectedUrl: action.row.url, reason } });
        close(() => finished('Tautan produk diperbarui.'));
      } else {
        const endpoint = isStorefront ? 'storefronts' : 'products';
        await api(`${base}/${endpoint}/${action.row.id}/unpublish`, { method: 'POST', data: { reason } });
        close(() => finished(isStorefront ? 'Publikasi etalase ditarik.' : 'Publikasi produk ditarik.'));
      }
    } catch (failure) {
      if (errorMessage(failure) === 'Administrator sign-in is required.') onExpired();
      else setError(failureMessage(failure));
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="aw-dialog" aria-labelledby="platform-action-title" onCancel={event => {
    event.preventDefault();
    if (!busy) close(cancel);
  }}>
    <h2 id="platform-action-title">{action.type === 'link' ? 'Ubah tautan produk' : isStorefront ? 'Tarik publikasi etalase?' : 'Tarik publikasi produk?'}</h2>
    <p><strong>{isStorefront ? action.row.name : action.row.title}</strong></p>
    {action.type === 'link' ? <p>Tautan baru akan menggantikan tautan produk di etalase.
      {link && <> <a href={link.href} target="_blank" rel="noopener noreferrer">Buka tautan saat ini</a>.</>}</p>
      : <p>{isStorefront ? 'Pengunjung tidak bisa membuka etalase sampai kreator menerbitkannya lagi.'
        : 'Produk akan kembali ke draf dan disembunyikan dari etalase.'}</p>}
    <form onSubmit={event => void submit(event)}>
      {action.type === 'link' && <label className="aw-field">Tautan produk baru
        <input autoFocus name="url" type="url" required maxLength={2048} defaultValue={action.row.url} disabled={busy || lostUpdate} />
      </label>}
      <label className="aw-field">Alasan perubahan
        <textarea name="reason" rows={3} minLength={3} maxLength={600} required disabled={busy || lostUpdate} />
      </label>
      {error && <p className="aw-error" role="alert">{error}</p>}
      <div className="aw-actions">
        <button type="button" autoFocus={action.type !== 'link'} disabled={busy} onClick={() => close(cancel)}>Batal</button>
        {lostUpdate ? <button type="button" onClick={() => close(stale)}>Muat ulang</button> : <button type="submit"
          className={action.type === 'link' ? 'aw-primary' : 'aw-danger'} disabled={busy}>
          {busy ? 'Menyimpan…' : action.type === 'link' ? 'Simpan tautan' : 'Tarik publikasi'}
        </button>}
      </div>
    </form>
  </dialog>;
}

const workspaceActions: Record<string, string> = {
  product_link_updated: 'Tautan produk diubah', product_unpublished: 'Publikasi produk ditarik',
  storefront_unpublished: 'Publikasi etalase ditarik',
};
export const affiliateActions: Record<string, string> = {
  candidate_added: 'Kandidat ditambahkan', approve: 'Disetujui', revalidate: 'Diverifikasi ulang',
  reject: 'Ditolak', disable: 'Dinonaktifkan', revoke: 'Dicabut', invalid: 'Ditandai tidak valid',
};

export function PlatformActivity({ onExpired }: { onExpired: OnExpired }) {
  const { data, error, reload } = usePlatformData<PlatformAudit>('/audit', onExpired);
  return <>
    <WorkspaceHeading title="Aktivitas audit" description="Hingga 30 perubahan terakhir untuk setiap jenis aktivitas." />
    {error ? <ReportError message={error} retry={reload} /> : data ? <div className="aw-section-stack">
      <section className="aw-card"><header className="aw-card-header"><h2>Perubahan produk dan etalase</h2></header>
        {data.workspace.length ? <ul className="aw-activity">{data.workspace.map(event => <li key={event.id}>
          <CircleCheck size={17} aria-hidden="true" />
          <div><strong>{workspaceActions[event.action] ?? 'Perubahan administratif'} · {event.subject}</strong><p className="aw-muted">{event.actor} · {event.reason}</p></div>
          <Time value={event.createdAt} />
        </li>)}</ul> : <WorkspaceEmpty icon={ClipboardList} title="Belum ada perubahan tercatat" />}
      </section>
      <section className="aw-card"><header className="aw-card-header"><h2>Perubahan tautan afiliasi</h2></header>
        {data.affiliate.length ? <ul className="aw-activity">{data.affiliate.map(event => <li key={event.id}>
          <Link2 size={17} aria-hidden="true" />
          <div><strong>{affiliateActions[event.action] ?? 'Perubahan tautan'} · {event.title}</strong><p className="aw-muted">{event.actor}</p></div>
          <Time value={event.createdAt} />
        </li>)}</ul> : <WorkspaceEmpty icon={Link2} title="Belum ada perubahan tautan afiliasi" />}
      </section>
    </div> : <WorkspaceLoading label="Memuat aktivitas audit…" />}
  </>;
}

export function PlatformSettings({ onExpired }: { onExpired: OnExpired }) {
  const { data, error, reload } = usePlatformData<PlatformSettingsStatus>('/settings/status', onExpired);
  const checks = [
    { key: 'databaseConfigured', label: 'Database', detail: 'Koneksi database dikonfigurasi pada server.' },
    { key: 'administratorLoginConfigured', label: 'Masuk Superadmin', detail: 'Akun Superadmin tersedia pada server.' },
    { key: 'googleSignInConfigured', label: 'Masuk dengan Google', detail: 'Kredensial Google dan alamat callback dikonfigurasi.' },
    { key: 'appleSignInConfigured', label: 'Masuk dengan Apple', detail: 'Kredensial Apple dan alamat callback dikonfigurasi.' },
    { key: 'accountRecoveryConfigured', label: 'Email pemulihan akun', detail: 'Pengiriman email pemulihan dikonfigurasi.' },
    { key: 'imageStorageConfigured', label: 'Penyimpanan gambar produk', detail: 'Penyimpanan gambar katalog memakai database aplikasi.' },
    { key: 'recommendationManagementEnabled', label: 'Kelola tautan rekomendasi', detail: 'Fitur administrasi tautan rekomendasi diaktifkan.' },
  ] as const;
  return <>
    <WorkspaceHeading title="Pengaturan platform" description="Periksa kesiapan konfigurasi tanpa menampilkan nilai rahasia." />
    <div className="aw-section-stack">
      {error ? <section className="aw-card"><ReportError message={error} retry={reload} /></section> : !data ? <WorkspaceLoading label="Memeriksa konfigurasi platform…" /> : <>
        <section className="aw-card aw-settings-card"><header className="aw-card-header"><div><h2>Kesiapan layanan</h2>
          <p>Lingkungan: <strong>{data.environment === 'production' ? 'Produksi' : 'Nonproduksi'}</strong></p></div>
          <button type="button" onClick={reload}>Periksa lagi</button></header>
          <ul className="aw-settings-list">{checks.map(check => {
            const ready = data.checks[check.key];
            return <li key={check.key}><div><strong>{check.label}</strong><p>{check.detail}</p></div>
              <span className={'aw-settings-status ' + (ready ? 'is-ready' : 'is-missing')} role="status">{ready ? 'Dikonfigurasi' : 'Belum diatur'}</span>
            </li>;
          })}</ul>
          <p className="aw-settings-privacy">Halaman ini hanya menerima status ya/tidak. Nilai konfigurasi dan kredensial tidak dikirim ke browser.</p>
        </section>
      </>}
      <section className="aw-card"><header className="aw-card-header"><div><h2>Administrasi akun Google</h2>
        <p>Lihat akun dan aktivitas masuk yang memiliki peran administrator.</p></div>
        <a className="aw-button" href="/admin?view=accounts">Buka administrasi akun</a></header></section>
    </div>
  </>;
}
