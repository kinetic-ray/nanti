import { createHmac, createHash, randomUUID } from 'node:crypto';

type Config = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());

export function createImageStorage(environment: NodeJS.ProcessEnv) {
  const s3 = ['NANTI_S3_ENDPOINT', 'NANTI_S3_BUCKET', 'NANTI_S3_REGION', 'NANTI_S3_ACCESS_KEY_ID', 'NANTI_S3_SECRET_ACCESS_KEY'] as const;
  const r2 = ['R2_ACCOUNT_ID', 'R2_ENDPOINT', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const;
  // An existing S3 bucket can still contain referenced objects.
  const provider = s3.some(name => environment[name]) ? 's3' : r2.some(name => environment[name]) ? 'r2' : null;
  if (!provider) return null;
  const required = provider === 's3' ? s3 : r2;
  if (required.some(name => !environment[name]?.trim())) {
    if (provider === 's3') throw new Error('Configure all NANTI_S3_* variables or none.');
    throw new Error('Missing R2 configuration. Check the R2 account, endpoint, bucket and S3 credentials.');
  }
  const config: Config = provider === 's3' ? {
    endpoint: environment.NANTI_S3_ENDPOINT!, bucket: environment.NANTI_S3_BUCKET!,
    region: environment.NANTI_S3_REGION!, accessKeyId: environment.NANTI_S3_ACCESS_KEY_ID!,
    secretAccessKey: environment.NANTI_S3_SECRET_ACCESS_KEY!,
  } : {
    endpoint: environment.R2_ENDPOINT!, bucket: environment.R2_BUCKET_NAME!, region: 'auto',
    accessKeyId: environment.R2_ACCESS_KEY_ID!, secretAccessKey: environment.R2_SECRET_ACCESS_KEY!,
  };
  const parsedEndpoint = URL.parse(config.endpoint);
  const account = environment.R2_ACCOUNT_ID ?? '';
  if (provider === 'r2' && (!/^[a-f0-9]{32}$/i.test(account) ||
      parsedEndpoint?.origin !== 'https://' + account.toLowerCase() + '.r2.cloudflarestorage.com' || parsedEndpoint.pathname !== '/')) {
    throw new Error('Invalid R2 endpoint. Use the HTTPS S3 parsedEndpoint for the configured account.');
  }
  if (!parsedEndpoint || parsedEndpoint.protocol !== 'https:' || parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(config.bucket) ||
    !/^[a-z0-9-]{2,40}$/i.test(config.region)) throw new Error('Invalid S3 storage configuration.');
  const endpoint = parsedEndpoint;
  const prefix = endpoint.pathname.replace(/\/$/, '');
  const canonicalPath = (key: string) => prefix + '/' + encode(config.bucket) + '/' + key.split('/').map(encode).join('/');

  function signedUrl(method: 'PUT' | 'GET' | 'HEAD' | 'DELETE', key: string, expires = 300, contentType?: string) {
    const now = new Date();
    const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = stamp.slice(0, 8);
    const scope = `${date}/${config.region}/s3/aws4_request`;
    const credential = `${config.accessKeyId}/${scope}`;
    const path = canonicalPath(key);
    const signedHeaders = contentType ? 'content-type;host' : 'host';
    const params: [string, string][] = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', credential],
      ['X-Amz-Date', stamp],
      ['X-Amz-Expires', String(expires)],
      ['X-Amz-SignedHeaders', signedHeaders],
    ];
    params.sort(([a], [b]) => a.localeCompare(b));
    const query = params.map(([name, value]) => `${encode(name)}=${encode(value)}`).join('&');
    const headers = contentType ? `content-type:${contentType}\nhost:${endpoint.host}\n` : `host:${endpoint.host}\n`;
    const canonical = [method, path, query, headers, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
    const requestHash = hash(canonical);
    const toSign = ['AWS4-HMAC-SHA256', stamp, scope, requestHash].join('\n');
    const dateKey = hmac('AWS4' + config.secretAccessKey, date);
    const regionKey = hmac(dateKey, config.region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = hmac(signingKey, toSign).toString('hex');
    return `${endpoint.origin}${path}?${query}&X-Amz-Signature=${signature}`;
  }
  const productKey = /^products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i;
  const validKey = (owner: string, key: string) => productKey.test(key) && key.split('/')[1] === owner;
  return {
    provider,
    createUpload(owner: string) {
      const key = `products/${owner}/${randomUUID()}.jpg`;
      return { key, uploadUrl: signedUrl('PUT', key, 300, 'image/jpeg') };
    },
    async storeJpeg(owner: string, bytes: Buffer, key = `products/${owner}/${randomUUID()}.jpg`) {
      if (!validKey(owner, key)) return null;
      const response = await fetch(signedUrl('PUT', key, 60, 'image/jpeg'), {
        method: 'PUT', body: Uint8Array.from(bytes), headers: { 'content-type': 'image/jpeg' },
        redirect: 'error', signal: AbortSignal.timeout(4000),
      });
      void response.body?.cancel().catch(() => {});
      return response.ok ? key : null;
    },
    async discard(key: string) {
      if (!productKey.test(key)) return false;
      const response = await fetch(signedUrl('DELETE', key, 60), {
        method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(4000),
      });
      void response.body?.cancel().catch(() => {});
      return response.ok || response.status === 404;
    },
    validKey,
    origin: endpoint.origin,
    async exists(key: string) {
      if (!productKey.test(key)) return false;
      const response = await fetch(signedUrl('HEAD', key, 60), {
        method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      if (!response) return false;
      const size = Number(response.headers.get('content-length'));
      return response.ok && Number.isFinite(size) && size > 0 && size <= 195_000 &&
        response.headers.get('content-type')?.startsWith('image/jpeg') === true;
    },
    async readJpeg(key: string) {
      if (!productKey.test(key)) return null;
      try {
        const response = await fetch(signedUrl('GET', key, 120), {
          redirect: 'error', signal: AbortSignal.timeout(5000),
        });
        const length = Number(response.headers.get('content-length'));
        if (!response.ok || !response.body || !Number.isInteger(length) || length < 1 || length > 195_000 ||
            response.headers.get('content-type')?.split(';')[0]?.trim() !== 'image/jpeg') {
          void response.body?.cancel().catch(() => {});
          return null;
        }
        const reader = response.body.getReader();
        try {
          const bytes = Buffer.alloc(length);
          let offset = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) return offset === length ? bytes : null;
            if (offset + value.byteLength > length) return null;
            bytes.set(value, offset);
            offset += value.byteLength;
          }
        } finally {
          void reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch {
        return null;
      }
    },
  };
}
