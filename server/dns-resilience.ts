import { Resolver } from 'node:dns/promises';

type Resolve = (hostname: string, signal: AbortSignal) => Promise<string[]>;

const retryable = new Set([
  'ESERVFAIL',
  'ETIMEOUT',
  'EAI_AGAIN',
  'ECONNREFUSED',
]);

async function resolveAttempt(
  hostname: string,
  signal: AbortSignal,
  server?: string,
): Promise<string[]> {
  signal.throwIfAborted();

  const resolver = new Resolver({
    timeout: 1000,
    tries: 1,
  });

  if (server) resolver.setServers([server]);

  return new Promise<string[]>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(signal.reason);
      resolver.cancel();
    };

    timer = setTimeout(() => {
      cleanup();

      reject(Object.assign(
        new Error('DNS resolution deadline exceeded'),
        { code: 'ETIMEOUT' },
      ));

      resolver.cancel();
    }, 1000);

    signal.addEventListener('abort', onAbort, { once: true });

    resolver.resolve4(hostname).then(
      addresses => {
        cleanup();
        resolve(addresses);
      },
      error => {
        cleanup();
        reject(error);
      },
    );
  });
}

export function createResilientResolver(
  primary: Resolve = (hostname, signal) =>
    resolveAttempt(hostname, signal),
  fallback: Resolve = (hostname, signal) =>
    resolveAttempt(hostname, signal, '8.8.8.8'),
): Resolve {
  return async (hostname, signal) => {
    signal.throwIfAborted();

    try {
      return await primary(hostname, signal);
    } catch (error) {
      signal.throwIfAborted();

      const code = (error as NodeJS.ErrnoException)?.code;

      if (!code || !retryable.has(code)) throw error;

      return fallback(hostname, signal);
    }
  };
}

export const resolveResilientIpv4 = createResilientResolver();
