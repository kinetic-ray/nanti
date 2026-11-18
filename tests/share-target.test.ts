import { describe, expect, it } from 'vitest';
import { sharedProductLink } from '../src/share-target.js';

describe('PWA share target', () => {
  it('accepts an Android share URL', () => {
    const url = new URL('https://nanti.example/share?url=https%3A%2F%2Ftk.tokopedia.com%2FZSp76BWQL%2F');
    expect(sharedProductLink(url)).toBe('https://tk.tokopedia.com/ZSp76BWQL/');
  });
  it('extracts links embedded in share text', () => {
    const url = new URL('https://nanti.example/share?text=Check%20this%20https%3A%2F%2Fs.shopee.co.id%2Fabc%20now');
    expect(sharedProductLink(url)).toBe('https://s.shopee.co.id/abc');
  });
  it('does not interpret unrelated query parameters or unsafe URLs', () => {
    expect(sharedProductLink(new URL('https://nanti.example/?url=https://shopee.co.id/x'))).toBeNull();
    expect(sharedProductLink(new URL('https://nanti.example/share?url=http://localhost/admin'))).toBeNull();
  });
});
