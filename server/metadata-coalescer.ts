import { productMerchant } from '../shared/product-import.js';
import { createMarketplaceCircuitBreaker } from './marketplace-circuit-breaker.js';
import { classifyNetworkError } from './network-diagnostics.js';
import type { previewProductMetadata } from './product-preview.js';

type Lookup = typeof previewProductMetadata;
type Metadata = Awaited<ReturnType<Lookup>>;
type Diagnostic = {
  reason: string;
  host: string;
  status?: number;
};

type Result = {
  metadata: Metadata;
  diagnostics: Diagnostic[];
};

export function createMetadataCoalescer(lookup: Lookup): Lookup {
  const pending = new Map<string, Promise<Result>>();
  const breaker = createMarketplaceCircuitBreaker();
  const maxPending = 8;
  const maxCached = 128;
  const cacheTtl = 30_000;

  const cache = new Map<string, {
    result: Result;
    expires: number;
  }>();

  return async (url, request, onDiagnostic) => {
    // Custom transports must remain isolated.
    if (request) return lookup(url, request, onDiagnostic);

    const key = url.href;
    const cached = cache.get(key);

    if (cached) {
      cache.delete(key);

      if (cached.expires > Date.now()) {
        // Refresh LRU order without extending freshness.
        cache.set(key, cached);

        for (const diagnostic of cached.result.diagnostics) {
          onDiagnostic?.(
            diagnostic.reason,
            diagnostic.host,
            diagnostic.status,
          );
        }

        return structuredClone(cached.result.metadata);
      }
    }

    let task = pending.get(key);

    if (!task) {
      // Reject excess unique lookups without bypassing the limit.
      // Cache hits and existing pending requests remain available.
      if (pending.size >= maxPending) {
        onDiagnostic?.('server_busy', url.hostname);
        return null;
      }

      const merchant = productMerchant(url.hostname);
      const complete = merchant ? breaker.acquire(merchant) : undefined;

      if (complete === null) {
        onDiagnostic?.('marketplace_unavailable', url.hostname);
        return null;
      }

      const diagnostics: Diagnostic[] = [];

      task = Promise.resolve().then(async () => ({
        metadata: await lookup(
          new URL(key),
          undefined,
          (reason, host, status) => {
            diagnostics.push({ reason, host, status });
          },
        ),
        diagnostics,
      }));

      pending.set(key, task);

      const cleanup = () => {
        if (pending.get(key) === task) pending.delete(key);
      };

      void task.then(result => {
        cleanup();

        complete?.(Boolean(result.metadata), result.diagnostics);

        if (!result.metadata) return;

        const now = Date.now();

        for (const [entryKey, entry] of cache) {
          if (entry.expires <= now) cache.delete(entryKey);
        }

        cache.delete(key);

        while (cache.size >= maxCached) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }

        cache.set(key, {
          result,
          expires: now + cacheTtl,
        });
      }, error => {
        cleanup();
        complete?.(false, [{
          reason: classifyNetworkError(error),
        }]);
      });
    }

    const result = await task;

    for (const diagnostic of result.diagnostics) {
      onDiagnostic?.(
        diagnostic.reason,
        diagnostic.host,
        diagnostic.status,
      );
    }

    return structuredClone(result.metadata);
  };
}
