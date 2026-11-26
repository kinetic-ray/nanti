import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ShieldCheck, UserRound, WalletCards } from 'lucide-react';
import type { AccountStatus } from '../shared/account.js';
import { AccountPanel, authNotices } from './account.js';
import type { AuthNotice } from './account.js';
import { useWorkspaceSection } from './admin-workspace.js';
import { HeaderActions } from './header-actions.js';
import { useLocale } from './locale.js';
import type { Message } from './messages.js';
import './account-workspace.css';

const sections = ['information', 'financial-profile', 'security'] as const;
const FinancialProfile = lazy(() => import('./financial-profile.js').then(module => ({ default: module.FinancialProfile })));

export function AccountWorkspace({ status, notice, update, signOut, statusMessage, requestSignOut }: {
  status: AccountStatus;
  notice: AuthNotice | null;
  update: (status: AccountStatus) => void;
  signOut: () => Promise<void>;
  statusMessage: Message | '';
  requestSignOut: () => void;
}) {
  const { t } = useLocale();
  const section = useWorkspaceSection(sections, 'information');
  const financial = section.active === 'financial-profile';
  const [visitedFinancial, setVisitedFinancial] = useState(financial);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(section.active);
  const items = {
    information: { label: t('Account information'), Icon: UserRound },
    'financial-profile': { label: t('Financial profile'), Icon: WalletCards },
    security: { label: t('Security'), Icon: ShieldCheck },
  };

  useEffect(() => {
    if (financial) setVisitedFinancial(true);
    if (previous.current !== section.active) {
      heading.current?.focus();
      previous.current = section.active;
    }
  }, [financial, section.active]);

  return <div className="site consumer">
    <header className="masthead">
      <a className="brand-group account-home" href="/" aria-label="Nanti">
        <span className="brand-symbol" aria-hidden="true" /><span className="brand">nanti<span>.</span></span>
      </a>
      <HeaderActions account={status.account} ready unread={0} alertsEnabled={false}
        openAlerts={() => undefined} signIn={() => location.reload()} signOut={requestSignOut} />
    </header>
    <main className="account-workspace">
      <a className="account-back" href="/"><ArrowLeft size={16} aria-hidden="true" />{t('Back to wishlists')}</a>
      <h1>{t('My profile')}</h1>
      {notice && <p role={notice === 'failed' ? 'alert' : 'status'} className={notice === 'failed' ? 'error' : undefined}>
        {t(authNotices[notice])}
      </p>}
      {statusMessage && <p role={statusMessage === 'Could not load your account. Try again.' ? 'alert' : 'status'}>{t(statusMessage)}</p>}
      <div className="account-workspace-grid">
        <nav className="account-workspace-nav" aria-label={t('Account navigation')}>
          {sections.map(id => {
            const { Icon, label } = items[id];
            return <a key={id} href={section.href(id)} aria-current={section.active === id ? 'page' : undefined}
              onClick={event => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                section.open(id);
              }}>
              <Icon size={18} aria-hidden="true" /><span>{label}</span>
            </a>;
          })}
        </nav>
        <section className="account-workspace-content" aria-labelledby="account-section-heading">
          <h2 id="account-section-heading" tabIndex={-1} ref={heading}>{items[section.active].label}</h2>
          {section.active !== 'financial-profile' && <AccountPanel status={status} section={section.active} update={update} signOut={signOut} />}
          {(financial || visitedFinancial) && <div hidden={!financial}>
            <Suspense fallback={<p role="status">{t('Loading your financial profile…')}</p>}>
              <FinancialProfile />
            </Suspense>
          </div>}
        </section>
      </div>
    </main>
  </div>;
}
