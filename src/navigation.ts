const prefetchedRoutes = new Set<string>();

export function navigateTo(path: string, options: { replace?: boolean } = {}) {
  const target = new URL(path, window.location.href);
  if (target.origin !== window.location.origin) {
    window.location.assign(target.href);
    return;
  }

  const next = `${target.pathname}${target.search}${target.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;

  if (options.replace) window.history.replaceState(window.history.state, '', next);
  else window.history.pushState(window.history.state, '', next);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function prefetchInternalNavigation(event: Event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (!link || (link.target && link.target !== '_self')) return;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') return;

  const route = `${url.pathname}?${['section', 'view', 'onboard'].map(key => `${key}=${url.searchParams.get(key) ?? ''}`).join('&')}`;
  if (prefetchedRoutes.has(route)) return;
  let load: Promise<unknown> | undefined;
  if (url.pathname === '/account' || url.pathname === '/account/financial-profile') {
    load = url.searchParams.get('section') === 'financial-profile'
      ? Promise.all([import('./account-workspace.js'), import('./financial-profile.js')])
      : import('./account-workspace.js');
  } else if (url.pathname === '/creator/studio') {
    load = Promise.all([import('./creator-access.js'), import('./creator-workspace.js')]);
  } else if (url.pathname === '/creator' && url.searchParams.get('onboard') === '1') {
    load = Promise.all([import('./creator-access.js'), import('./creator-workspace.js')]);
  } else if (url.pathname === '/creator') {
    load = import('./creator.js');
  } else if (url.pathname === '/creator/demo') {
    load = import('./creator-storefront.js');
  } else if (url.pathname.startsWith('/store/')) {
    load = import('./creator-workspace.js');
  } else if (url.pathname === '/admin') {
    load = url.searchParams.get('view') === 'accounts' ? import('./account-admin.js') : import('./admin.js');
  }
  if (!load) return;
  prefetchedRoutes.add(route);
  void load.catch(() => prefetchedRoutes.delete(route));
}

export function isInternalNavigationClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return null;

  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return null;
  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
