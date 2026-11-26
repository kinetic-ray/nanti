import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  UserRound,
  WalletCards,
} from 'lucide-react';

import type { AccountStatus } from '../shared/account.js';
import { AccountPanel, authNotices } from './account.js';
import type { AuthNotice } from './account.js';

import {
  AdminWorkspace,
  useWorkspaceSection,
} from './admin-workspace.js';

import { LanguagePicker, useLocale } from './locale.js';
import type { Message } from './messages.js';

import './account-workspace.css';

const sections = [
  'information',
  'financial-profile',
  'security',
] as const;

const FinancialProfile = lazy(() =>
  import('./financial-profile.js').then(module => ({
    default: module.FinancialProfile,
  }))
);

export function AccountWorkspace({
  status,
  notice,
  update,
  signOut,
  statusMessage,
  requestSignOut,
}: {
  status: AccountStatus;
  notice: AuthNotice | null;
  update: (status: AccountStatus) => void;
  signOut: () => Promise<void>;
  statusMessage: Message | '';
  requestSignOut: () => void;
}) {
  const { t } = useLocale();

  const section = useWorkspaceSection(
    sections,
    'information'
  );

  const financial = section.active === 'financial-profile';

  const [visitedFinancial, setVisitedFinancial] =
    useState(financial);

  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(section.active);

  const language =
    t('My profile') === 'My profile' ? 'en' : 'id';

  const items = [
    {
      id: 'information',
      label: t('Account information'),
      icon: UserRound,
    },
    {
      id: 'financial-profile',
      label: t('Financial profile'),
      icon: WalletCards,
    },
    {
      id: 'security',
      label: t('Security'),
      icon: ShieldCheck,
    },
  ] as const;

  const currentItem = items.find(
    item => item.id === section.active
  )!;

  const accountName =
    status.account?.displayName?.trim() ||
    status.account?.email ||
    t('Account');

  useEffect(() => {
    if (financial) {
      setVisitedFinancial(true);
    }

    if (previous.current !== section.active) {
      heading.current?.focus();
      previous.current = section.active;
    }
  }, [financial, section.active]);

  return (
    <AdminWorkspace
      name={t('My profile')}
      language={language}
      items={items}
      section={section}
      account={accountName}
      secondaryActions={<LanguagePicker />}
      accountActions={
        <>
          <a href="/">
            <ArrowLeft size={16} aria-hidden="true" />
            {t('Back to wishlists')}
          </a>

          <a href="/creator/studio">
            <LayoutDashboard size={16} aria-hidden="true" />
            Creator Studio
          </a>

          <button type="button" onClick={requestSignOut}>
            <LogOut size={16} aria-hidden="true" />
            {t('Sign out')}
          </button>
        </>
      }
    >
      <div className="consumer account-workspace">

        {notice && (
          <p
            role={notice === 'failed' ? 'alert' : 'status'}
            className={notice === 'failed' ? 'aw-error' : 'aw-notice'}
          >
            {t(authNotices[notice])}
          </p>
        )}

        {statusMessage && (
          <p
            role={
              statusMessage === 'Could not load your account. Try again.'
                ? 'alert'
                : 'status'
            }
          >
            {t(statusMessage)}
          </p>
        )}

        <section
          className="account-workspace-content"
          aria-labelledby="account-section-heading"
        >
          <h1
            id="account-section-heading"
            className="account-section-title"
            tabIndex={-1}
            ref={heading}
          >
            {currentItem.label}
          </h1>

          {section.active !== 'financial-profile' && (
            <AccountPanel
              status={status}
              section={section.active}
              update={update}
              signOut={signOut}
            />
          )}

          {(financial || visitedFinancial) && (
            <div hidden={!financial}>
              <Suspense
                fallback={
                  <p role="status">
                    {t('Loading your financial profile…')}
                  </p>
                }
              >
                <FinancialProfile />
              </Suspense>
            </div>
          )}
        </section>
      </div>
    </AdminWorkspace>
  );
}
