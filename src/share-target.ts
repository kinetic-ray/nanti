import { safeImportUrl } from '../shared/product-import.js';

// Android apps may share the link as a URL field or embed it in plain text.
export function sharedProductLink(address: URL): string | null {
  if (address.pathname !== '/share' && address.pathname !== '/share/') return null;
  const values = [address.searchParams.get('url'), address.searchParams.get('text')];
  for (const value of values) {
    if (!value) continue;
    const candidates = [value.trim(), ...(value.match(/https?:\/\/[^\s<>"']+/giu) ?? [])];
    for (const candidate of candidates) {
      const parsed = safeImportUrl(candidate.replace(/[),.;!?]+$/u, ''));
      if (parsed) return parsed.href;
    }
  }
  return null;
}
