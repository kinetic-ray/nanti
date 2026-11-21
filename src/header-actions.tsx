import { useEffect, useRef, useState } from 'react';
import type { AccountStatus } from '../shared/account.js';
import { LanguagePicker, useLocale } from './locale.js';
import { Icon } from './visual.js';

type Account = NonNullable<AccountStatus['account']>;
type Disclosure = 'profile' | 'navigation';

function Avatar({ src, initials }: { src?: string | null; initials: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="masthead-avatar" aria-hidden="true">
    {src && !failed ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : initials || <Icon name="person" />}
  </span>;
}

export function HeaderActions({ account, ready, unread, openAlerts, signIn, signOut }: {
  account?: Account | null;
  ready: boolean;
  unread: number;
  openAlerts: () => void;
  signIn: () => void;
  signOut: () => void;
}) {
  const { t, number } = useLocale();
  const [open, setOpen] = useState<Disclosure | null>(null);
  const profile = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLButtonElement>(null);
  const name = account?.displayName?.trim();
  const initials = (name || account?.email?.split('@')[0] || '').split(/\s+/u).slice(0, 2)
    .map(part => Array.from(part)[0]?.toLocaleUpperCase()).join('');
  const trigger = open === 'profile' ? profile : navigation;

  useEffect(() => {
    if (!open) return;
    function onOutsideClick(event: MouseEvent) {
      const disclosure = trigger.current?.parentElement;
      if (disclosure && !event.composedPath().includes(disclosure)) {
        if (document.activeElement === document.body) trigger.current?.focus();
        setOpen(null);
      }
    }
    const onNavigate = () => setOpen(null);
    document.addEventListener('click', onOutsideClick);
    window.addEventListener('popstate', onNavigate);
    window.addEventListener('pagehide', onNavigate);
    return () => {
      document.removeEventListener('click', onOutsideClick);
      window.removeEventListener('popstate', onNavigate);
      window.removeEventListener('pagehide', onNavigate);
    };
  }, [open, trigger]);

  const toggle = (value: Disclosure) => setOpen(current => current === value ? null : value);
  return <div className="masthead-controls" onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    trigger.current?.focus();
    setOpen(null);
  }} onBlur={event => {
    if (open && event.relatedTarget && !trigger.current?.parentElement?.contains(event.relatedTarget)) setOpen(null);
  }}>
    <button className="icon-button price-alert-entry" type="button" aria-label={t('Price alerts')}
      title={t('Price alerts')} disabled={!ready} onClick={openAlerts}>
      <Icon name="bell" />{unread > 0 && <span aria-hidden="true">{number(Math.min(99, unread))}</span>}
    </button>
    <LanguagePicker />
    {account ? <div className="masthead-profile">
      <button className="masthead-action" type="button" ref={profile} aria-label={t('Profile menu')}
        title={t('Profile menu')} aria-expanded={open === 'profile'} aria-controls="masthead-profile"
        onClick={() => toggle('profile')}>
        <Avatar key={account.avatarUrl} src={account.avatarUrl} initials={initials} />
      </button>
      <div className="masthead-menu-panel masthead-profile-panel" id="masthead-profile" hidden={open !== 'profile'}>
        <div className="masthead-identity">
          <Avatar key={account.avatarUrl} src={account.avatarUrl} initials={initials} />
          <div>
            <strong>{name || (account.email ? null : t('Account'))}</strong>
            {account.email && <span>{account.email}</span>}
          </div>
        </div>
        <a href="/account" onClick={() => setOpen(null)}>{t('My profile')}</a>
        <a href="/account?view=settings" onClick={() => setOpen(null)}>{t('Account settings')}</a>
        <a href="/creator/studio" onClick={() => setOpen(null)}>Creator Studio</a>
        <div className="masthead-sign-out">
          <button type="button" onClick={() => {
            profile.current?.focus();
            setOpen(null);
            signOut();
          }}>{t('Sign out')}</button>
        </div>
      </div>
    </div> : <button className="masthead-action" type="button" disabled={!ready}
      aria-label={t('Sign in')} title={t('Sign in')} onClick={signIn}><Icon name="person" /></button>}
    <div className="masthead-menu">
      <button className="masthead-menu-toggle" type="button" ref={navigation} aria-label={t('Open menu')}
        title={t('Open menu')} aria-expanded={open === 'navigation'} aria-controls="masthead-navigation"
        onClick={() => toggle('navigation')}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M2.5 4.5h13m-13 4.5h13m-13 4.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <nav className="masthead-menu-panel" id="masthead-navigation" aria-label={t('Site navigation')} hidden={open !== 'navigation'}>
        <a href="/creator" onClick={() => setOpen(null)}>{t('Creator')}</a>
      </nav>
    </div>
  </div>;
}
