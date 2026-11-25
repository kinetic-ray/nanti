// The affiliate landing route supplies candidate IDs, never product metadata.
export function shopeeLandingProductUrl(url: URL): URL | null {
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/^(?:www\.)?shopee\.co\.id$/u.test(url.hostname)) return null;
  const match = /^\/opaanlp\/([1-9]\d{0,19})\/([1-9]\d{0,19})\/?$/u.exec(url.pathname);
  return match ? new URL('/product/' + match[1] + '/' + match[2], url.origin) : null;
}
