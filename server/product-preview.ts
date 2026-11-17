import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';

const MAX_BYTES = 512 * 1024;

export async function previewProduct(url: URL, request = fetch): Promise<string | null> {
  return (await previewProductMetadata(url, request))?.title ?? null;
}

export async function previewProductMetadata(url: URL, request = fetch) {
  if (url.origin !== 'https://www.ikea.com' ||
      !/^\/[a-z]{2}\/[a-z]{2}\/p\/[a-z0-9-]+-\d{8}\/?$/i.test(url.pathname)) {
    return null;
  }

  try {
    // Rebuild the request from a fixed origin, dropping user-supplied query and fragment.
    const response = await request(new URL(url.pathname, 'https://www.ikea.com'), {
      redirect: 'manual',
      signal: AbortSignal.timeout(3500),
      headers: { accept: 'text/html' },
    });
    if (!response.ok || !/^text\/html\b/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      return null;
    }
    if (!response.body) return null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        html += decoder.decode(value.subarray(0, Math.max(0, MAX_BYTES - bytes + value.byteLength)), { stream: true });
        if (bytes >= MAX_BYTES || /<\/head\s*>/i.test(html)) break;
      }
    } finally {
      await reader.cancel();
    }

    const document = parse(html + decoder.decode());
    const root = document.childNodes.find((node): node is DefaultTreeAdapterTypes.Element =>
      'tagName' in node && node.tagName === 'html');
    const head = root?.childNodes.find((node): node is DefaultTreeAdapterTypes.Element =>
      'tagName' in node && node.tagName === 'head');
    let title: string | null = null;
    let image: string | null = null;
    for (const node of head?.childNodes ?? []) {
      if (!('tagName' in node) || node.tagName !== 'meta') continue;
      const property = node.attrs.find((attr) => attr.name === 'property')?.value;
      if (property !== 'og:title' && property !== 'og:image') continue;
      const content = node.attrs.find((attr) => attr.name === 'content')?.value.trim();
      if (content && property === 'og:title') title ??= content.slice(0, 160);
      if (content && property === 'og:image') image ??= content.slice(0, 2048);
    }
    return { title, image };
  } catch {
    return null;
  }
}
