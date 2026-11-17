export async function api<T>(path: string, options: {
  method?: string;
  data?: unknown;
  signal?: AbortSignal;
} = {}): Promise<T> {
  const { method = 'GET', data, signal } = options;
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    ...(method === 'GET' ? {} : {
      headers: { 'Content-Type': 'application/json', 'X-Nanti-Request': '1' },
      body: JSON.stringify(data ?? {}),
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
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
