import { describe, expect, it, vi } from 'vitest';
import { createImageStorage } from '../server/image-storage.js';

const environment = {
  NANTI_S3_ENDPOINT: 'https://storage.example.com',
  NANTI_S3_BUCKET: 'nanti-private',
  NANTI_S3_REGION: 'auto',
  NANTI_S3_ACCESS_KEY_ID: 'example-access',
  NANTI_S3_SECRET_ACCESS_KEY: 'example-secret',
};

describe('private product image storage', () => {
  it('stays disabled without storage credentials', () => {
    expect(createImageStorage({})).toBeNull();
  });

  it('rejects partial credentials', () => {
    expect(() => createImageStorage({ NANTI_S3_BUCKET: 'nanti-private' })).toThrow();
  });

  it('rejects insecure storage endpoints', () => {
    expect(() => createImageStorage({ ...environment, NANTI_S3_ENDPOINT: 'http://storage.example.com' })).toThrow();
  });

  it('scopes each upload key to its owner and signs a short-lived PUT', () => {
    const storage = createImageStorage(environment)!;
    const owner = '12345678-1234-4123-8123-123456789abc';
    const other = '12345678-1234-4123-8123-123456789abd';
    const { key, uploadUrl } = storage.createUpload(owner);
    expect(storage.validKey(owner, key)).toBe(true);
    expect(storage.validKey(other, key)).toBe(false);
    expect(storage.validKey(owner, 'products/../../escape.jpg')).toBe(false);
    const url = new URL(uploadUrl);
    expect(url.origin).toBe('https://storage.example.com');
    expect(url.pathname).toContain('/nanti-private/products/');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(uploadUrl).not.toContain(environment.NANTI_S3_SECRET_ACCESS_KEY);
  });

  it('uses a bounded, signed DELETE for unattached uploads', async () => {
    const storage = createImageStorage(environment)!;
    const { key } = storage.createUpload('12345678-1234-4123-8123-123456789abc');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    try {
      await expect(storage.discard(key)).resolves.toBe(true);
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE', redirect: 'error' });
      expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toContain(key);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('stores and reads bounded JPEG bytes without exposing a CDN or object URL', async () => {
    const storage = createImageStorage(environment)!;
    const jpeg = Buffer.from([255, 216, 255, 217]);
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(jpeg, {
        headers: { 'content-type': 'image/jpeg', 'content-length': String(jpeg.length) },
      }))
      .mockResolvedValueOnce(new Response(jpeg, {
        headers: { 'content-type': 'image/jpeg', 'content-length': '2' },
      }));
    try {
      const owner = '12345678-1234-4123-8123-123456789abc';
      const key = await storage.storeJpeg(owner, jpeg);
      expect(storage.validKey(owner, key!)).toBe(true);
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT', redirect: 'error' });
      expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toContain(key);
      await expect(storage.readJpeg(key!)).resolves.toEqual(jpeg);
      await expect(storage.readJpeg(key!)).resolves.toBeNull();
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('Cloudflare R2 image storage configuration', () => {
  const account = 'a'.repeat(32);
  const env = {
    R2_ACCOUNT_ID: account, R2_ENDPOINT: 'https://' + account + '.r2.cloudflarestorage.com',
    R2_BUCKET_NAME: 'fixtures', R2_ACCESS_KEY_ID: 'fixture-key', R2_SECRET_ACCESS_KEY: 'fixture-secret',
  };
  it('configures a private R2 bucket without a public base URL', () => {
    const storage = createImageStorage(env);
    expect(storage?.provider).toBe('r2');
    expect(storage?.origin).toBe(env.R2_ENDPOINT);
  });
  it('rejects incomplete and mismatched R2 configuration with safe errors', () => {
    expect(() => createImageStorage({ ...env, R2_SECRET_ACCESS_KEY: '' })).toThrow('Missing R2 configuration');
    expect(() => createImageStorage({ ...env, R2_ENDPOINT: 'https://fixture-secret@example.com' }))
      .toThrow('Invalid R2 endpoint');
  });
});
