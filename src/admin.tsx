import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { variantFields } from '../shared/affiliate.js';
import type {
  AdminNotice, AdminPage, AuditEvent, Mapping, MatchClassification, NoticeKind, Opportunity, OpportunityDetail, VerificationEvidence,
} from '../shared/affiliate.js';
import { safeProductUrl } from '../shared/wishlist.js';
import { api, errorMessage } from './api.js';
import { Dialog } from './forms.js';
import { RecommendationAdminPanel } from './RecommendationAdminPanel.js';

const admin = '/admin';
type Session = { username: string };
type Inbox = AdminPage<AdminNotice> & { unread: number };
type Review = { mapping: Mapping; action: 'approve' | 'revalidate' | 'reject' | 'disable' | 'revoke' | 'invalid' };

const matches: Record<MatchClassification, string> = {
  verified_exact: 'Verified exact match', potential: 'Potential match · review required',
  mismatch: 'Mismatch', insufficient: 'Insufficient information',
};
const notices: Record<NoticeKind, string> = {
  new_opportunity: 'New affiliate opportunity', candidate_review: 'Candidate awaiting review',
  mapping_revoked: 'Mapping revoked', mapping_invalid: 'Mapping invalidated',
};
const actions: Record<Review['action'], string> = {
  approve: 'Verify and approve', revalidate: 'Revalidate', reject: 'Reject', disable: 'Disable',
  revoke: 'Revoke', invalid: 'Mark invalid',
};
const auditActions: Record<string, string> = {
  candidate_added: 'Candidate added', approve: 'Approved', revalidate: 'Revalidated',
  reject: 'Rejected', disable: 'Disabled', revoke: 'Revoked', invalid: 'Invalidated',
};

function recordedAt(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
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
    {children}<span className="sr-only"> (opens in a new tab)</span>
  </a>;
}

export function AdminCenter() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api<Session>(`${admin}/session`, { signal: controller.signal }).then(setSession, (failure: unknown) => {
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
      await api(`${admin}/logout`, { method: 'POST' });
      setSession(null);
      setError('');
    } catch (failure) {
      const message = errorMessage(failure);
      if (message === 'Administrator sign-in is required.') setSession(null);
      else setError(message);
    } finally { setBusy(false); }
  }

  return <div className="site admin-site">
    <header className="masthead">
      <div className="brand-group"><span className="brand-symbol" aria-hidden="true" />
        <div className="brand">nanti<span>.</span></div></div>
      <div className="actions">
        <a className="buy-original" href="/admin?view=accounts">Admin dashboard</a>
        <a className="buy-original" href="/">Back to Nanti</a>
        {session && <button type="button" disabled={busy} onClick={() => void signOut()}>Sign out</button>}
      </div>
    </header>
    <main>
      <h1>Affiliate Center</h1>
      {session === undefined ? <p role="status">Checking administrator session…</p>
        : session ? <>
          {error && <p role="alert" className="error">{error}</p>}
          <RecommendationAdminPanel />
          <Workspace username={session.username} onExpired={() => {
            setSession(null); setError('Your administrator session expired. Sign in again.');
          }} />
        </> : <SignIn error={error} onRetry={() => { setSession(undefined); setError(''); setAttempt((value) => value + 1); }}
          onSignIn={async (username, password) => {
            setSession(await api<Session>(`${admin}/login`, { method: 'POST', data: { username, password } }));
            setError('');
          }} />}
    </main>
  </div>;
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

  return <section className="admin-panel admin-signin">
    <h2>Administrator sign-in</h2>
    {(failed || error) && <p className="error" role="alert">{failed || error}</p>}
    {isDisabled ? <p>Configure the administrator credentials on the server, then reload this page.</p> :
      <form onSubmit={submit}>
        <label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)}
          required maxLength={64} disabled={busy} /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password}
          onChange={(event) => setPassword(event.target.value)} required maxLength={256} disabled={busy} /></label>
        <div className="actions">
          <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {error && <button type="button" disabled={busy} onClick={onRetry}>Retry session check</button>}
        </div>
      </form>}
  </section>;
}

function Workspace({ username, onExpired }: { username: string; onExpired: () => void }) {
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
      setInbox((current) => current && ({
        ...current,
        unread: Math.max(0, current.unread + (action === 'unread' && notice.readAt ? 1 : !notice.readAt && action !== 'unread' ? -1 : 0)),
        records: action === 'dismiss' ? current.records.filter(({ id }) => id !== notice.id) :
          current.records.map((row) => row.id === notice.id ? { ...row, readAt: action === 'read' ? new Date().toISOString() : null } : row),
      }));
    });
  }

  return <>
    <div className="actions admin-tabs" role="group" aria-label="Affiliate Center sections">
      <button type="button" aria-pressed={panel === 'opportunities'} onClick={() => setPanel('opportunities')}>Opportunities</button>
      <button type="button" aria-pressed={panel === 'inbox'} onClick={() => setPanel('inbox')}>Inbox{inbox?.unread ? ` (${inbox.unread})` : ''}</button>
      <button type="button" disabled={busy} onClick={() => { setError(''); setDetailError(''); refresh(); }}>Refresh</button>
      <span className="hint">Signed in as {username}</span>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <p className="decision-status" role="status">{feedback}</p>
    {panel === 'inbox' ? <section className="admin-panel">
      <h2>Notification inbox</h2>
      {!inbox ? <p role="status">Loading notifications…</p> : inbox.records.length === 0 ? <p>There are no notifications in your inbox.</p> :
        <ul className="admin-records">{inbox.records.map((notice) => <li key={notice.id}>
          <div><strong>{notices[notice.kind]}</strong>
            <p>{notice.title ?? notice.listingId}</p>
            <small>{notice.readAt ? 'Read' : 'Unread'} · {recordedAt(notice.createdAt)}</small></div>
          <div className="actions">
            <a className="buy-original" href={opportunityHash(notice.identityId)} onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              select(notice.identityId);
            }}>Open product</a>
            <button type="button" disabled={busy} onClick={() => void updateNotice(notice, notice.readAt ? 'unread' : 'read')}>
              {notice.readAt ? 'Mark unread' : 'Mark read'}
            </button>
            <button type="button" disabled={busy} onClick={() => void updateNotice(notice, 'dismiss')}>Dismiss</button>
          </div>
        </li>)}</ul>}
      {inbox?.next && <button type="button" disabled={busy} onClick={() => void run(async () => {
        const loaded = await api<Inbox>(nextPath(`${admin}/notifications`, inbox.next!));
        setInbox({ ...loaded, records: [...inbox.records, ...loaded.records] });
      })}>Load older notifications</button>}
    </section> : <div className="admin-grid">
      <section className="admin-panel">
        <h2>Affiliate opportunities</h2>
        {!opportunities ? <p role="status">Loading opportunities…</p> : opportunities.records.length === 0
          ? <p>Supported public product links appear here as shoppers save them.</p>
          : <ul className="admin-queue">{opportunities.records.map((row) => <li key={row.id}>
            <button type="button" aria-pressed={row.id === selected} onClick={() => select(row.id)}>
              <strong>{row.title ?? `${row.merchant} article ${row.listingId}`}</strong>
              <span>{row.market.toUpperCase()} · {row.savedCount} saved · {row.coverage ? 'Covered' : 'Uncovered'}</span>
              <small>{matches[row.classification]} · Reviewed {recordedAt(row.reviewedAt)}</small>
            </button>
          </li>)}</ul>}
        {opportunities?.next && <button type="button" disabled={busy} onClick={() => void run(async () => {
          const loaded = await api<AdminPage<Opportunity>>(nextPath(`${admin}/opportunities`, opportunities.next!));
          setOpportunities({ ...loaded, records: [...opportunities.records, ...loaded.records] });
        })}>Load more opportunities</button>}
      </section>
      <section className="admin-panel">
        {detailError ? <p role="alert" className="error">{detailError}</p> :
          !selected ? <p>Choose a product to review its listing, evidence, and mappings.</p> :
          !identity ? <p role="status">Loading product…</p> :
          <>
            <h2 ref={heading} tabIndex={-1}>{identity.title ?? `${identity.merchant} article ${identity.listingId}`}</h2>
            <dl className="admin-facts">
              <div><dt>Merchant</dt><dd>{identity.merchant}</dd></div>
              <div><dt>Market</dt><dd>{identity.market.toUpperCase()}</dd></div>
              <div><dt>Listing ID</dt><dd>{identity.listingId}</dd></div>
              <div><dt>Saved occurrences</dt><dd>{identity.savedCount}</dd></div>
              <div><dt>Coverage</dt><dd>{identity.coverage ? 'Active verified mapping' : 'Original listing only'}</dd></div>
              <div><dt>Verification</dt><dd>{matches[identity.classification]}</dd></div>
              <div><dt>Last reviewed</dt><dd>{recordedAt(identity.reviewedAt)}</dd></div>
              {identity.normalizedTitle && <div><dt>Normalized title</dt><dd>{identity.normalizedTitle}</dd></div>}
              {identity.brand && <div><dt>Brand</dt><dd>{identity.brand}</dd></div>}
              {identity.model && <div><dt>Model</dt><dd>{identity.model}</dd></div>}
              {identity.sellerId && <div><dt>Seller identifier</dt><dd>{identity.sellerId}</dd></div>}
              {Object.entries(identity.variants ?? {}).map(([key, value]) => <div key={key}><dt className="variant-label">{key}</dt><dd>{value}</dd></div>)}
            </dl>
            <p><ExternalLink url={identity.canonicalUrl}>Open original merchant listing</ExternalLink></p>
            <CandidateForm key={identity.id} busy={busy} onCandidate={(url) => run(
              () => api(`${path}/mappings`, { method: 'POST', data: { url } }), 'Candidate saved for review.',
            )} />
            <h3>Affiliate mappings</h3>
            {!identity.mappings.length && <p>No candidates have been added.</p>}
            {identity.mappings.map((mapping) => <MappingCard key={mapping.id} mapping={mapping} busy={busy}
              onReview={(action) => setReview({ action, mapping })} />)}
            {identity.nextMappings && <button type="button" disabled={busy} onClick={() => void run(async () => {
              const loaded = await api<AdminPage<Mapping>>(nextPath(`${path}/mappings`, identity.nextMappings!));
              setDetail({ ...identity, mappings: [...identity.mappings, ...loaded.records], nextMappings: loaded.next });
            })}>Load more mappings</button>}
            <h3>Verification and change history</h3>
            {!identity.audit.length && <p>No administrative changes have been recorded.</p>}
            <ul className="admin-records">{identity.audit.map((event) => <li key={event.id}>
              <div><strong>{auditActions[event.action] ?? event.action}</strong>
                <p>{event.actor} · {recordedAt(event.createdAt)}</p>
                <small>Mapping {event.mappingId}</small>
                {typeof event.details.reason === 'string' && <p>{event.details.reason}</p>}
                {!!event.details.evidence && <details><summary>Verification snapshot</summary>
                  <EvidenceView evidence={event.details.evidence as VerificationEvidence} /></details>}
              </div>
            </li>)}</ul>
            {identity.nextAudit && <button type="button" disabled={busy} onClick={() => void run(async () => {
              const loaded = await api<AdminPage<AuditEvent>>(nextPath(`${path}/audit`, identity.nextAudit!));
              setDetail({ ...identity, audit: [...identity.audit, ...loaded.records], nextAudit: loaded.next });
            })}>Load older changes</button>}
          </>}
      </section>
    </div>}
    {review && path && <ReviewDialog review={review} identity={identity} close={() => setReview(null)} onSubmit={async (data) => {
      try {
        await api(`${path}/mappings/${review.mapping.id}`, { method: 'PATCH', data });
        setReview(null); setFeedback('Mapping review recorded.'); refresh();
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
    <label>Candidate affiliate URL<input type="url" value={url} required maxLength={2048} disabled={busy}
      placeholder="https://" onChange={(event) => setUrl(event.target.value)} /></label>
    <p className="hint">Use a real, direct merchant link supplied by your affiliate program. A matching title is insufficient.</p>
    <div><button className="primary" disabled={busy}>Add candidate</button></div>
  </form>;
}

function MappingCard({ mapping, busy, onReview }: { mapping: Mapping; busy: boolean; onReview: (action: Review['action']) => void }) {
  const steps: Review['action'][] = [];
  if ((mapping.status === 'pending' || mapping.status === 'disabled') && mapping.eligible) steps.push('approve');
  if (mapping.status === 'pending') steps.push('reject');
  if (mapping.status === 'approved' && mapping.eligible) steps.push('revalidate', 'disable');
  if (mapping.status === 'approved' || mapping.status === 'disabled') steps.push('revoke', 'invalid');
  return <article className="admin-mapping">
    <h4 className="variant-label">{mapping.status} · {mapping.active ? 'active' : 'inactive'}</h4>
    <p>{matches[mapping.classification]}</p>
    <p className="admin-url">{mapping.affiliateUrl}</p>
    {mapping.eligible && <p><ExternalLink url={mapping.affiliateUrl}>Inspect candidate listing</ExternalLink></p>}
    {mapping.approvedBy && <p className="hint">Approved by {mapping.approvedBy} · {recordedAt(mapping.approvedAt)}</p>}
    <p className="hint">Last validated {recordedAt(mapping.validatedAt)}</p>
    {mapping.evidence && <details><summary>Verification evidence</summary><EvidenceView evidence={mapping.evidence} /></details>}
    <div className="actions">{steps.map((action) => <button key={action} type="button" disabled={busy}
      onClick={() => onReview(action)}>{actions[action]}</button>)}</div>
  </article>;
}

function EvidenceView({ evidence }: { evidence: VerificationEvidence }) {
  return <>
    <p>{evidence.title}{evidence.brand ? ` · ${evidence.brand}` : ''}{evidence.model ? ` · ${evidence.model}` : ''}</p>
    {evidence.sellerId && <p>Seller identifier {evidence.sellerId}</p>}
    {!!Object.keys(evidence.variants).length && <ul>
      {Object.entries(evidence.variants).map(([field, value]) => <li key={field}><span className="variant-label">{field}</span> · {value}</li>)}
    </ul>}
    <p>{evidence.notes}</p>
    {evidence.evidenceUrl && <p><ExternalLink url={evidence.evidenceUrl}>Open supporting evidence</ExternalLink></p>}
  </>;
}

function ReviewDialog({ review, identity, onSubmit, close }: {
  review: Review; identity: OpportunityDetail | null; onSubmit: (data: unknown) => Promise<void>; close: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isVerification = review.action === 'approve' || review.action === 'revalidate';
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
          <p>Check the article number, market, and all relevant options on both listings. Record only details you can verify.</p>
          <div className="actions">
            <ExternalLink url={review.mapping.originalUrl}>Original listing</ExternalLink>
            <ExternalLink url={review.mapping.affiliateUrl}>Candidate listing</ExternalLink>
          </div>
          <label>Verified product title<input name="title" defaultValue={existing?.title ?? identity?.title ?? ''} maxLength={160} required /></label>
          <div className="admin-fields">
            <label>Brand<input name="brand" defaultValue={existing?.brand ?? identity?.brand ?? ''} maxLength={120} /></label>
            <label>Model<input name="model" defaultValue={existing?.model ?? identity?.model ?? ''} maxLength={120} /></label>
            <label>Seller identifier<input name="sellerId" defaultValue={existing?.sellerId ?? identity?.sellerId ?? ''} maxLength={120} /></label>
            {variantFields.map((key) => <label key={key} className="variant-label">{key}
              <input name={key} defaultValue={existing?.variants[key] ?? identity?.variants?.[key] ?? ''}
                maxLength={key === 'other' ? 240 : 120} /></label>)}
          </div>
          <label>Verification notes<textarea name="notes" rows={3} required minLength={12} maxLength={2000} /></label>
          <label>Supporting evidence URL <span className="optional">(optional)</span>
            <input type="url" name="evidenceUrl" maxLength={2048} defaultValue={existing?.evidenceUrl ?? ''} /></label>
          <label className="check-label"><input type="checkbox" name="confirmedExact" required />
            I checked both listings and confirmed the same product and variant. This is an authorized affiliate link.
          </label>
        </> : <label>Reason<textarea name="reason" rows={3} required minLength={3} maxLength={600} /></label>}
      </fieldset>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="form-actions">
        <button type="button" disabled={busy} onClick={close}>Cancel</button>
        <button className={isVerification ? 'primary' : 'danger'} disabled={busy}>{busy ? 'Saving…' : actions[review.action]}</button>
      </div>
    </form>
  </Dialog>;
}
