import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { variantFields } from '../shared/affiliate.js';
import type {
  AdminNotice, AdminPage, AuditEvent, Mapping, MatchClassification, NoticeKind, Opportunity, OpportunityDetail, VerificationEvidence,
} from '../shared/affiliate.js';
import { safeProductUrl } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { Dialog } from './forms.js';
import { RecommendationAdminPanel } from './RecommendationAdminPanel.js';

import { BarChart3, Bell, ClipboardList, ContactRound, Home, LayoutDashboard, Link2, ListChecks, LogOut, Package, Settings, Store, Users } from 'lucide-react';
import { AdminWorkspace, WorkspaceAnalytics, WorkspaceHeading, useWorkspaceSection } from './admin-workspace.js';
import { PlatformActivity, PlatformDirectory, PlatformOverview, PlatformSettings, affiliateActions } from './platform-workspace.js';

const admin = '/admin';
type Session = { username: string };
type Inbox = AdminPage<AdminNotice> & { unread: number };
type Review = { mapping: Mapping; action: 'approve' | 'revalidate' | 'restore' | 'reject' | 'disable' | 'revoke' | 'invalid' };

const matches: Record<MatchClassification, string> = {
  verified_exact: 'Produk dan varian terverifikasi', potential: 'Kemungkinan cocok, perlu ditinjau',
  mismatch: 'Tidak cocok', insufficient: 'Informasi belum cukup',
};
const notices: Record<NoticeKind, string> = {
  new_opportunity: 'Produk baru menunggu ditinjau', candidate_review: 'Kandidat menunggu ditinjau',
  mapping_revoked: 'Pemetaan dicabut', mapping_invalid: 'Pemetaan ditandai tidak valid',
  new_user: 'Pengguna baru terdaftar', system_failure: 'Gangguan sistem perlu ditinjau',
};
const actions: Record<Review['action'], string> = {
  approve: 'Verifikasi dan setujui', revalidate: 'Verifikasi ulang', restore: 'Pulihkan tautan', reject: 'Tolak', disable: 'Nonaktifkan',
  revoke: 'Cabut', invalid: 'Tandai tidak valid',
};
const variants: Record<string, string> = { color: 'Warna', size: 'Ukuran', capacity: 'Kapasitas', configuration: 'Konfigurasi', other: 'Lainnya' };
const mappingStatuses: Record<string, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak', disabled: 'Dinonaktifkan', revoked: 'Dicabut', invalid: 'Tidak valid' };

function recordedAt(value: string | null) {
  return value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

function nextPath(path: string, after: string) { return `${path}?after=${encodeURIComponent(after)}`; }

function opportunityHash(id: string) { return `#opportunity-${id}`; }

function opportunityFromLocation() {
  return /^#opportunity-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu.exec(location.hash)?.[1] ?? null;
}

function ExternalLink({ url, children }: { url: string; children: string }) {
  const parsed = safeProductUrl(url);
  if (!parsed || parsed.protocol !== 'https:' || parsed.port) return <span>{children}</span>;
  return <a href={parsed.href} target="_blank" rel="noopener noreferrer">
    {children}<span className="sr-only"> (dibuka di tab baru)</span>
  </a>;
}

const superadminSections = ['overview', 'products', 'creators', 'users', 'storefronts', 'links', 'notifications', 'recommendations', 'audit', 'analytics', 'settings'] as const;

function NotificationBell({ href, open }: { href: string; open: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => api<Inbox>(`${admin}/notifications`).then(value => {
      if (active) setUnread(value.unread);
    }, () => undefined);
    const refresh = () => void load();
    void load();
    const timer = window.setInterval(() => void load(), 45_000);
    window.addEventListener('nanti-admin-notifications-change', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('nanti-admin-notifications-change', refresh); };
  }, []);
  const label = unread ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi';
  return <a className="aw-icon-button aw-notification-link" href={href} onClick={open} aria-label={label} title={label}>
    <Bell size={19} aria-hidden="true" />{unread > 0 && <span className="aw-notification-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
  </a>;
}

export function AdminCenter() {
  const section = useWorkspaceSection(superadminSections, 'overview', url => url.hash.startsWith('#opportunity-') ? 'links' : undefined);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  const onExpired = useCallback(() => {
    setSession(null);
    setError('Sesi Superadmin berakhir. Masuk lagi untuk melanjutkan.');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api<Session>(admin + '/session', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setSession(data);
    }, (failure: unknown) => {
      if (controller.signal.aborted) return;
      const message = errorMessage(failure);
      setError(message === 'Administrator sign-in is required.' ? '' : message);
      setSession(null);
    });
    return () => controller.abort();
  }, [attempt]);

  async function signOut() {
    setBusy(true);
    try {
      await api(admin + '/logout', { method: 'POST' });
      setSession(null);
      setError('');
    } catch (failure) {
      const message = errorMessage(failure);
      if (message === 'Administrator sign-in is required.') onExpired();
      else setError(message);
    } finally { setBusy(false); }
  }

  if (!session) return <div className="aw-gate">
    <main className="aw-card">
      <a className="aw-brand" href="/" aria-label="Beranda Nanti"><span className="brand-symbol" aria-hidden="true" />
        <span className="aw-brand-copy"><strong>nanti<span>.</span></strong></span></a>
      {session === undefined ? <p role="status">Memeriksa sesi Superadmin…</p> :
        <SignIn error={error} onRetry={() => { setSession(undefined); setError(''); setAttempt(value => value + 1); }}
          onSignIn={async (username, password) => {
            setSession(await api<Session>(admin + '/login', { method: 'POST', data: { username, password } }));
            setError('');
          }} />}
      <a href="/admin?view=accounts">Administrasi akun Google</a>
    </main>
  </div>;

  const active = section.active;
  return <AdminWorkspace name="Superadmin" section={section} account={session.username} items={[
    { id: 'overview', label: 'Ringkasan', icon: LayoutDashboard },
    { id: 'products', label: 'Produk', icon: Package },
    { id: 'creators', label: 'Kreator', icon: ContactRound },
    { id: 'users', label: 'Pengguna', icon: Users },
    { id: 'storefronts', label: 'Etalase', icon: Store },
    { id: 'links', label: 'Tautan afiliasi', icon: Link2 },
    { id: 'notifications', label: 'Notifikasi', icon: Bell },
    { id: 'recommendations', label: 'Rekomendasi', icon: ListChecks },
    { id: 'audit', label: 'Aktivitas audit', icon: ClipboardList },
    { id: 'analytics', label: 'Analitik', icon: BarChart3 },
    { id: 'settings', label: 'Pengaturan', icon: Settings },
  ]} secondaryActions={<NotificationBell href={section.href('notifications')} open={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); section.open('notifications');
  }} />} accountActions={<>
    <a href="/"><Home size={16} aria-hidden="true" />Beranda Nanti</a>
    <button type="button" disabled={busy} onClick={() => void signOut()}><LogOut size={16} aria-hidden="true" />Keluar</button>
  </>}>
    {error && <p role="alert" className="aw-error">{adminError(error)}</p>}
    {active === 'overview' && <PlatformOverview open={section.open} onExpired={onExpired} />}
    {(active === 'products' || active === 'creators' || active === 'users' || active === 'storefronts') &&
      <PlatformDirectory key={active} directory={active} onExpired={onExpired} />}
    {active === 'links' && <div className="aw-affiliate">
      <WorkspaceHeading title="Tautan afiliasi" description="Tinjau kandidat tautan dan kelola pemetaan afiliasi yang terverifikasi." />
      <Workspace onExpired={onExpired} />
    </div>}
    {active === 'notifications' && <div className="aw-affiliate">
      <WorkspaceHeading title="Pusat notifikasi" description="Periksa kiriman produk, akun baru, tinjauan afiliasi, dan gangguan yang perlu ditangani." />
      <Workspace onExpired={onExpired} inboxOnly />
    </div>}
    {active === 'recommendations' && <>
      <WorkspaceHeading title="Rekomendasi" />
      <RecommendationAdminPanel onExpired={onExpired} />
    </>}
    {active === 'audit' && <PlatformActivity onExpired={onExpired} />}
    {active === 'analytics' && <WorkspaceAnalytics />}
    {active === 'settings' && <PlatformSettings onExpired={onExpired} />}
  </AdminWorkspace>;
}

function adminError(message: string) {
  const translations: Record<string, string> = {
    'Administrator sign-in is not configured.': 'Akses Superadmin belum dikonfigurasi.',
    'The username or password is incorrect.': 'Nama pengguna atau kata sandi salah.',
    'Too many sign-in attempts. Try again in 15 minutes.': 'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.',
    'Database temporarily unavailable. Try again shortly.': 'Database sementara tidak tersedia. Coba lagi.',
    'This product identity could not be found.': 'Produk tidak ditemukan.',
  };
  return translations[message] ?? (message.startsWith('Sesi Superadmin') ? message : 'Permintaan belum berhasil. Coba lagi.');
}

function SignIn({ error, onRetry, onSignIn }: {
  error: string; onRetry: () => void; onSignIn: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const isDisabled = error === 'Administrator sign-in is not configured.';
  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(''); setBusy(true);
    try { await onSignIn(username, password); }
    catch (failure) { setFailed(errorMessage(failure)); }
    finally { setBusy(false); setPassword(''); }
  }

  return <section className="aw-section-stack">
    <h1>Masuk sebagai Superadmin</h1>
    {(failed || error) && <p className="aw-error" role="alert">{adminError(failed || error)}</p>}
    {isDisabled ? <button type="button" onClick={onRetry}>Periksa lagi</button> :
      <form onSubmit={submit}>
        <label>Nama pengguna<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)}
          required maxLength={64} disabled={busy} /></label>
        <label>Kata sandi<input type="password" autoComplete="current-password" value={password}
          onChange={(event) => setPassword(event.target.value)} required maxLength={256} disabled={busy} /></label>
        <div className="aw-actions">
          <button className="aw-primary" disabled={busy}>{busy ? 'Sedang masuk…' : 'Masuk'}</button>
          {error && <button type="button" disabled={busy} onClick={onRetry}>Periksa sesi lagi</button>}
        </div>
      </form>}
  </section>;
}


function Workspace({ onExpired, inboxOnly = false }: { onExpired: () => void; inboxOnly?: boolean }) {
  const [opportunities, setOpportunities] = useState<AdminPage<Opportunity> | null>(null);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [selected, setSelected] = useState(opportunityFromLocation);
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [panel, setPanel] = useState<'opportunities' | 'inbox'>('opportunities');
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const path = selected ? `${admin}/opportunities/${selected}` : null;
  const identity = detail?.id === selected ? detail : null;

  function failure(value: unknown, sink = setError) {
    const message = errorMessage(value);
    if (message === 'Administrator sign-in is required.') onExpired();
    else sink(message);
  }

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<AdminPage<Opportunity>>(`${admin}/opportunities`, { signal: controller.signal }),
      api<Inbox>(`${admin}/notifications`, { signal: controller.signal }),
    ]).then(([queue, notifications]) => {
      if (!controller.signal.aborted) { setOpportunities(queue); setInbox(notifications); }
    }, (problem: unknown) => { if (!controller.signal.aborted) failure(problem); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<OpportunityDetail>(path, { signal: controller.signal }).then(
      (identity) => { if (!controller.signal.aborted) setDetail(identity); },
      (problem: unknown) => { if (!controller.signal.aborted) failure(problem, setDetailError); },
    );
    return () => controller.abort();
  }, [path, reload]);

  useEffect(() => {
    function syncSelection() {
      setSelected(opportunityFromLocation());
      setPanel('opportunities');
      setDetailError('');
      setFeedback('');
    }
    window.addEventListener('hashchange', syncSelection);
    return () => window.removeEventListener('hashchange', syncSelection);
  }, []);
  useEffect(() => {
    if (panel === 'opportunities' && identity) heading.current?.focus();
  }, [panel, identity?.id]);

  function refresh() { setReload((value) => value + 1); }
  function select(id: string) {
    if (location.hash !== opportunityHash(id)) history.pushState(null, '', opportunityHash(id));
    setSelected(id); setPanel('opportunities'); setDetailError(''); setFeedback('');
  }

  async function run(work: () => Promise<unknown>, message?: string) {
    setError(''); setBusy(true); setFeedback('');
    try {
      await work();
      if (message) { setFeedback(message); refresh(); }
      return true;
    } catch (problem) { failure(problem); return false; }
    finally { setBusy(false); }
  }

  async function updateNotice(notice: AdminNotice, action: 'read' | 'unread' | 'dismiss') {
    await run(async () => {
      await api(`${admin}/notifications/${notice.id}`, { method: 'PATCH', data: { action } });
      window.dispatchEvent(new Event('nanti-admin-notifications-change'));
      setInbox((current) => current && ({
        ...current,
        unread: Math.max(0, current.unread + (action === 'unread' && notice.readAt ? 1 : !notice.readAt && action !== 'unread' ? -1 : 0)),
        records: action === 'dismiss' ? current.records.filter(({ id }) => id !== notice.id) :
          current.records.map((row) => row.id === notice.id ? { ...row, readAt: action === 'read' ? new Date().toISOString() : null } : row),
      }));
    });
  }

  async function markAllRead() {
    await run(async () => {
      await api(`${admin}/notifications/read-all`, { method: 'POST' });
      window.dispatchEvent(new Event('nanti-admin-notifications-change'));
      setInbox(current => current ? { ...current, unread: 0,
        records: current.records.map(row => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })) } : current);
    });
  }

  return <>
    {!inboxOnly && <div className="actions admin-tabs" role="group" aria-label="Bagian tautan afiliasi">
      <button type="button" aria-pressed={panel === 'opportunities'} onClick={() => setPanel('opportunities')}>Peluang</button>
      <button type="button" aria-pressed={panel === 'inbox'} onClick={() => setPanel('inbox')}>Kotak masuk{inbox?.unread ? ` (${inbox.unread})` : ''}</button>
      <button type="button" disabled={busy} onClick={() => { setError(''); setDetailError(''); refresh(); }}>Muat ulang</button>
    </div>}
    {error && <p className="error" role="alert">{adminError(error)}</p>}
    <p className="decision-status" role="status">{feedback}</p>
    {inboxOnly || panel === 'inbox' ? <section className="admin-panel">
      <header className="aw-card-header"><h2>Notifikasi</h2><div className="aw-actions">
        <button type="button" disabled={busy || !inbox?.unread} onClick={() => void markAllRead()}>Tandai semua dibaca</button>
        {!inboxOnly && <button type="button" disabled={busy} onClick={() => { setError(''); refresh(); }}>Muat ulang</button>}
      </div></header>
      {!inbox ? <p role="status">Memuat notifikasi…</p> : inbox.records.length === 0 ? <p>Belum ada notifikasi.</p> :
        <ul className="admin-records">{inbox.records.map((notice) => <li key={notice.id}>
          <div><strong>{notices[notice.kind] ?? 'Notifikasi sistem'}</strong>
            <p>{notice.title ?? notice.listingId ?? 'Ada aktivitas baru yang perlu diperiksa.'}</p>
            <small>{notice.readAt ? 'Sudah dibaca' : 'Belum dibaca'} · {recordedAt(notice.createdAt)}</small></div>
          <div className="actions">
            <a className="buy-original" href={notice.targetPath} onClick={event => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              event.stopPropagation();
              window.location.assign(notice.targetPath);
            }}>Buka</a>
            <button type="button" disabled={busy} onClick={() => void updateNotice(notice, notice.readAt ? 'unread' : 'read')}>
              {notice.readAt ? 'Tandai belum dibaca' : 'Tandai sudah dibaca'}
            </button>
            <button type="button" disabled={busy} onClick={() => void updateNotice(notice, 'dismiss')}>Singkirkan</button>
          </div>
        </li>)}</ul>}
      {inbox?.next && <button type="button" disabled={busy} onClick={() => void run(async () => {
        const loaded = await api<Inbox>(nextPath(`${admin}/notifications`, inbox.next!));
        setInbox({ ...loaded, records: [...inbox.records, ...loaded.records] });
      })}>Muat notifikasi sebelumnya</button>}
    </section> : <div className="admin-grid">
      <section className="admin-panel">
        <h2>Peluang afiliasi</h2>
        {!opportunities ? <p role="status">Memuat peluang…</p> : opportunities.records.length === 0
          ? <p>Tautan produk yang didukung akan muncul saat disimpan oleh pengguna.</p>
          : <ul className="admin-queue">{opportunities.records.map((row) => <li key={row.id}>
            <button type="button" aria-pressed={row.id === selected} onClick={() => select(row.id)}>
              <strong>{row.title ?? `${row.merchant} artikel ${row.listingId}`}</strong>
              <span>{row.market.toUpperCase()} · {row.savedCount} kali disimpan · {row.coverage ? 'Ada tautan aktif' : 'Tautan asli'}</span>
              <small>{matches[row.classification]} · Ditinjau {recordedAt(row.reviewedAt)}</small>
            </button>
          </li>)}</ul>}
        {opportunities?.next && <button type="button" disabled={busy} onClick={() => void run(async () => {
          const loaded = await api<AdminPage<Opportunity>>(nextPath(`${admin}/opportunities`, opportunities.next!));
          setOpportunities({ ...loaded, records: [...opportunities.records, ...loaded.records] });
        })}>Muat lebih banyak peluang</button>}
      </section>
      <section className="admin-panel">
        {detailError ? <p role="alert" className="error">{adminError(detailError)}</p> :
          !selected ? <p>Pilih produk untuk meninjau listing, bukti, dan pemetaan tautannya.</p> :
          !identity ? <p role="status">Memuat produk…</p> :
          <>
            <h2 ref={heading} tabIndex={-1}>{identity.title ?? `${identity.merchant} artikel ${identity.listingId}`}</h2>
            <dl className="admin-facts">
              <div><dt>Toko</dt><dd>{identity.merchant}</dd></div>
              <div><dt>Pasar</dt><dd>{identity.market.toUpperCase()}</dd></div>
              <div><dt>ID listing</dt><dd>{identity.listingId}</dd></div>
              <div><dt>Jumlah simpan</dt><dd>{identity.savedCount}</dd></div>
              <div><dt>Pemetaan aktif</dt><dd>{identity.coverage ? 'Pemetaan terverifikasi aktif' : 'Tautan asli saja'}</dd></div>
              <div><dt>Verifikasi</dt><dd>{matches[identity.classification]}</dd></div>
              <div><dt>Terakhir ditinjau</dt><dd>{recordedAt(identity.reviewedAt)}</dd></div>
              {identity.normalizedTitle && <div><dt>Judul baku</dt><dd>{identity.normalizedTitle}</dd></div>}
              {identity.brand && <div><dt>Merek</dt><dd>{identity.brand}</dd></div>}
              {identity.model && <div><dt>Model</dt><dd>{identity.model}</dd></div>}
              {identity.sellerId && <div><dt>ID penjual</dt><dd>{identity.sellerId}</dd></div>}
              {Object.entries(identity.variants ?? {}).map(([key, value]) => <div key={key}><dt className="variant-label">{variants[key] ?? key}</dt><dd>{value}</dd></div>)}
            </dl>
            <p><ExternalLink url={identity.canonicalUrl}>Buka listing asli</ExternalLink></p>
            <CandidateForm key={identity.id} busy={busy} onCandidate={(url) => run(
              () => api(`${path}/mappings`, { method: 'POST', data: { url } }), 'Kandidat disimpan untuk ditinjau.',
            )} />
            <h3>Pemetaan tautan afiliasi</h3>
            {!identity.mappings.length && <p>Belum ada kandidat.</p>}
            {identity.mappings.map((mapping) => <MappingCard key={mapping.id} mapping={mapping} busy={busy}
              onReview={(action) => setReview({ action, mapping })} />)}
            {identity.nextMappings && <button type="button" disabled={busy} onClick={() => void run(async () => {
              const loaded = await api<AdminPage<Mapping>>(nextPath(`${path}/mappings`, identity.nextMappings!));
              setDetail({ ...identity, mappings: [...identity.mappings, ...loaded.records], nextMappings: loaded.next });
            })}>Muat lebih banyak pemetaan</button>}
            <h3>Riwayat verifikasi dan perubahan</h3>
            {!identity.audit.length && <p>Belum ada perubahan administratif.</p>}
            <ul className="admin-records">{identity.audit.map((event) => <li key={event.id}>
              <div><strong>{affiliateActions[event.action] ?? 'Perubahan pemetaan'}</strong>
                <p>{event.actor} · {recordedAt(event.createdAt)}</p>
                <small>Pemetaan {event.mappingId}</small>
                {typeof event.details.reason === 'string' && <p>{event.details.reason}</p>}
                {!!event.details.evidence && <details><summary>Rincian verifikasi</summary>
                  <EvidenceView evidence={event.details.evidence as VerificationEvidence} /></details>}
              </div>
            </li>)}</ul>
            {identity.nextAudit && <button type="button" disabled={busy} onClick={() => void run(async () => {
              const loaded = await api<AdminPage<AuditEvent>>(nextPath(`${path}/audit`, identity.nextAudit!));
              setDetail({ ...identity, audit: [...identity.audit, ...loaded.records], nextAudit: loaded.next });
            })}>Muat perubahan sebelumnya</button>}
          </>}
      </section>
    </div>}
    {review && path && <ReviewDialog review={review} identity={identity} close={() => setReview(null)} onSubmit={async (data) => {
      try {
        await api(`${path}/mappings/${review.mapping.id}`, { method: 'PATCH', data });
        setReview(null); setFeedback('Hasil tinjauan disimpan.'); refresh();
      } catch (problem) {
        if (errorMessage(problem) === 'Administrator sign-in is required.') onExpired();
        throw problem;
      }
    }} />}
  </>;
}

function CandidateForm({ busy, onCandidate }: { busy: boolean; onCandidate: (url: string) => Promise<boolean> }) {
  const [url, setUrl] = useState('');
  return <form className="admin-candidate" onSubmit={(event) => {
    event.preventDefault();
    void onCandidate(url).then((ok) => { if (ok) setUrl(''); });
  }}>
    <label>URL kandidat afiliasi<input type="url" value={url} required maxLength={2048} disabled={busy}
      placeholder="https://" onChange={(event) => setUrl(event.target.value)} /></label>
    <p className="hint">Gunakan tautan langsung dari program afiliasimu. Periksa produk dan variannya di kedua listing.</p>
    <div><button className="aw-primary" disabled={busy}>Tambahkan kandidat</button></div>
  </form>;
}

function MappingCard({ mapping, busy, onReview }: { mapping: Mapping; busy: boolean; onReview: (action: Review['action']) => void }) {
  const steps: Review['action'][] = [];
  if (mapping.status === 'pending' && mapping.eligible) steps.push('approve');
  if (['disabled', 'revoked', 'invalid'].includes(mapping.status) && mapping.eligible) steps.push('restore');
  if (mapping.status === 'pending') steps.push('reject');
  if (mapping.status === 'approved' && mapping.eligible) steps.push('revalidate', 'disable');
  if (mapping.status === 'approved' || mapping.status === 'disabled') steps.push('revoke', 'invalid');
  return <article className="admin-mapping">
    <h4 className="variant-label">{mappingStatuses[mapping.status] ?? 'Status tidak diketahui'} · {mapping.active ? 'aktif' : 'nonaktif'}</h4>
    <p>{matches[mapping.classification]}</p>
    <p className="admin-url">{mapping.affiliateUrl}</p>
    {mapping.eligible && <p><ExternalLink url={mapping.affiliateUrl}>Buka listing kandidat</ExternalLink></p>}
    {mapping.approvedBy && <p className="hint">Disetujui oleh {mapping.approvedBy} · {recordedAt(mapping.approvedAt)}</p>}
    <p className="hint">Terakhir diverifikasi {recordedAt(mapping.validatedAt)}</p>
    {mapping.evidence && <details><summary>Bukti verifikasi</summary><EvidenceView evidence={mapping.evidence} /></details>}
    <div className="actions">{steps.map((action) => <button key={action} type="button" disabled={busy}
      onClick={() => onReview(action)}>{actions[action]}</button>)}</div>
  </article>;
}

function EvidenceView({ evidence }: { evidence: VerificationEvidence }) {
  return <>
    <p>{evidence.title}{evidence.brand ? ` · ${evidence.brand}` : ''}{evidence.model ? ` · ${evidence.model}` : ''}</p>
    {evidence.sellerId && <p>ID penjual {evidence.sellerId}</p>}
    {!!Object.keys(evidence.variants).length && <ul>
      {Object.entries(evidence.variants).map(([field, value]) => <li key={field}><span className="variant-label">{variants[field] ?? field}</span> · {value}</li>)}
    </ul>}
    <p>{evidence.notes}</p>
    {evidence.evidenceUrl && <p><ExternalLink url={evidence.evidenceUrl}>Buka bukti pendukung</ExternalLink></p>}
  </>;
}

function ReviewDialog({ review, identity, onSubmit, close }: {
  review: Review; identity: OpportunityDetail | null; onSubmit: (data: unknown) => Promise<void>; close: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isVerification = review.action === 'approve' || review.action === 'revalidate' || review.action === 'restore';
  const existing = review.mapping.evidence;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const field = (key: string) => String(form.get(key) ?? '').trim() || undefined;
    const data = isVerification ? {
      action: review.action, revision: review.mapping.revision, evidence: {
        title: field('title'), brand: field('brand'), model: field('model'), sellerId: field('sellerId'),
        variants: Object.fromEntries(variantFields.flatMap((key) => field(key) ? [[key, field(key)]] : [])),
        notes: field('notes'), evidenceUrl: field('evidenceUrl'), confirmedExact: form.get('confirmedExact') === 'on',
      },
    } : { action: review.action, revision: review.mapping.revision, reason: field('reason') };
    try { await onSubmit(data); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <Dialog title={actions[review.action]} busy={busy} close={close} focusHeading className="decision">
    <form onSubmit={submit}>
      <fieldset className="decision-inputs" disabled={busy}>
        {isVerification ? <>
          <p>Check the artikel number, market, and all relevant options on both listings. Record only details you can verify.</p>
          <div className="actions">
            <ExternalLink url={review.mapping.originalUrl}>Listing asli</ExternalLink>
            <ExternalLink url={review.mapping.affiliateUrl}>Listing kandidat</ExternalLink>
          </div>
          <label>Nama produk terverifikasi<input name="title" defaultValue={existing?.title ?? identity?.title ?? ''} maxLength={160} required /></label>
          <div className="admin-fields">
            <label>Merek<input name="brand" defaultValue={existing?.brand ?? identity?.brand ?? ''} maxLength={120} /></label>
            <label>Model<input name="model" defaultValue={existing?.model ?? identity?.model ?? ''} maxLength={120} /></label>
            <label>ID penjual<input name="sellerId" defaultValue={existing?.sellerId ?? identity?.sellerId ?? ''} maxLength={120} /></label>
            {variantFields.map((key) => <label key={key} className="variant-label">{variants[key] ?? key}
              <input name={key} defaultValue={existing?.variants[key] ?? identity?.variants?.[key] ?? ''}
                maxLength={key === 'other' ? 240 : 120} /></label>)}
          </div>
          <label>Catatan verifikasi<textarea name="notes" rows={3} required minLength={12} maxLength={2000} /></label>
          <label>URL bukti pendukung <span className="optional">(opsional)</span>
            <input type="url" name="evidenceUrl" maxLength={2048} defaultValue={existing?.evidenceUrl ?? ''} /></label>
          <label className="check-label"><input type="checkbox" name="confirmedExact" required />
            Saya sudah memeriksa kedua listing dan memastikan produk dan variannya sama. Tautan ini berasal dari program afiliasi resmi.
          </label>
        </> : <label>Alasan<textarea name="reason" rows={3} required minLength={3} maxLength={600} /></label>}
      </fieldset>
      {error && <p role="alert" className="error">{adminError(error)}</p>}
      <div className="form-actions">
        <button type="button" disabled={busy} onClick={close}>Batal</button>
        <button className={isVerification ? 'aw-primary' : 'aw-danger'} disabled={busy}>{busy ? 'Menyimpan…' : actions[review.action]}</button>
      </div>
    </form>
  </Dialog>;
}
