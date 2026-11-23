import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { isIkeaMetadataLink } from '../shared/product-import.js';

const maxBytes = 512 * 1024;

/** Read only the image hint needed by the IKEA media cache. */
export async function previewIkeaImage(url: URL, request: typeof fetch = fetch): Promise<string | null> {
  if (!isIkeaMetadataLink(url)) return null;
  try {
    const response = await request(new URL(url.pathname, 'https://www.ikea.com'), {
      redirect: 'manual', signal: AbortSignal.timeout(3500), headers: { accept: 'text/html' },
    });
    if (!response.ok || !/^text\/html\b/i.test(response.headers.get('content-type') ?? '') || !response.body) {
      await response.body?.cancel();
      return null;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) return null;
        html += decoder.decode(value, { stream: true });
        if (/<\/head\s*>/i.test(html)) break;
      }
      html += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }

    const document = parse(html);
    const root = document.childNodes.find((node): node is DefaultTreeAdapterTypes.Element =>
      'tagName' in node && node.tagName === 'html');
    const head = root?.childNodes.find((node): node is DefaultTreeAdapterTypes.Element =>
      'tagName' in node && node.tagName === 'head');
    const value = head?.childNodes.find((node): node is DefaultTreeAdapterTypes.Element =>
      'tagName' in node && node.tagName === 'meta' &&
      node.attrs.find(({ name }) => name === 'property')?.value.toLowerCase() === 'og:image')
      ?.attrs.find(({ name }) => name === 'content')?.value.trim();
    return value || null;
  } catch {
    return null;
  }
}
