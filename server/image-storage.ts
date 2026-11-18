import { createHmac, createHash, randomUUID } from 'node:crypto';

type Config = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());

export function createImageStorage(environment: NodeJS.ProcessEnv) {
  const vars = ['NANTI_S3_ENDPOINT', 'NANTI_S3_BUCKET', 'NANTI_S3_REGION', 'NANTI_S3_ACCESS_KEY_ID', 'NANTI_S3_SECRET_ACCESS_KEY'] as const;
  if (vars.every(name => !environment[name])) return null;
  if (vars.some(name => !environment[name])) throw new Error('Configure all NANTI_S3_* variables or none.');
  const config: Config = {
    endpoint: environment.NANTI_S3_ENDPOINT!, bucket: environment.NANTI_S3_BUCKET!,
    region: environment.NANTI_S3_REGION!, accessKeyId: environment.NANTI_S3_ACCESS_KEY_ID!,
    secretAccessKey: environment.NANTI_S3_SECRET_ACCESS_KEY!,
  };
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(config.bucket) ||
    !/^[a-z0-9-]{2,40}$/i.test(config.region)) throw new Error('Invalid S3 storage configuration.');
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
  const validKey = (owner: string, key: string) =>
    new RegExp(`^products/${owner}/[0-9a-f-]{36}\\.jpg$`, 'i').test(key);
  return {
    createUpload(owner: string) {
      const key = `products/${owner}/${randomUUID()}.jpg`;
      return { key, uploadUrl: signedUrl('PUT', key, 300, 'image/jpeg') };
    },
    validKey,
    origin: endpoint.origin,
    async exists(key: string) {
      const response = await fetch(signedUrl('HEAD', key, 60), { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      const size = Number(response.headers.get('content-length'));
      return response.ok && Number.isFinite(size) && size > 0 && size <= 195_000 &&
        response.headers.get('content-type')?.startsWith('image/jpeg') === true;
    },
    imageUrl(key: string) { return signedUrl('GET', key, 120); },
  };
}
