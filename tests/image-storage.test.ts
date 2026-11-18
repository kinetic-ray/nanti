import { describe, expect, it } from 'vitest';
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
    expect(storage.imageUrl(key)).toContain('X-Amz-Expires=120');
    expect(uploadUrl).not.toContain(environment.NANTI_S3_SECRET_ACCESS_KEY);
  });
});
