export async function api<T>(path: string, options: {
  method?: string;
  data?: unknown;
  signal?: AbortSignal;
  requestKey?: string;
} = {}): Promise<T> {
  const { method = 'GET', data, signal, requestKey } = options;
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    ...(method === 'GET' ? {} : {
      headers: { 'Content-Type': 'application/json', 'X-Nanti-Request': '1',
        ...(requestKey && { 'Idempotency-Key': requestKey }) },
      body: JSON.stringify(data ?? {}),
    }),
  }).catch(() => { throw new Error('Could not reach Nanti. Try again.'); });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    if (response.status === 503 && payload?.code === 'database_unavailable') {
      throw new Error('Wishlist sedang mengalami gangguan database. Coba lagi sebentar.');
    }
    throw new Error(payload?.error ?? 'Could not reach Nanti. Try again.');
  }
  if (response.status === 204 || !response.headers.get('content-type')?.includes('application/json')) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}
