import { describe, expect, it, vi, afterEach } from 'vitest';
import { createMarketplaceCircuitBreaker } from '../server/marketplace-circuit-breaker.js';

const failure = [{ reason: 'timeout' }];

describe('Marketplace circuit breaker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function openCircuit(
    breaker: ReturnType<typeof createMarketplaceCircuitBreaker>,
    merchant = 'tokopedia',
  ) {
    for (let i = 0; i < 5; i++) {
      breaker.acquire(merchant)!(false, failure);
    }
  }

  it('opens after five consecutive transient failures', () => {
    const breaker = createMarketplaceCircuitBreaker();

    openCircuit(breaker);

    expect(breaker.acquire('tokopedia')).toBeNull();
  });

  it('isolates failures between marketplaces', () => {
    const breaker = createMarketplaceCircuitBreaker();

    openCircuit(breaker);

    expect(breaker.acquire('tokopedia')).toBeNull();
    expect(breaker.acquire('shopee')).not.toBeNull();
    expect(breaker.acquire('ikea')).not.toBeNull();
  });

  it('resets consecutive failures after success', () => {
    const breaker = createMarketplaceCircuitBreaker();

    for (let i = 0; i < 4; i++) {
      breaker.acquire('tokopedia')!(false, failure);
    }

    breaker.acquire('tokopedia')!(true, []);

    for (let i = 0; i < 4; i++) {
      breaker.acquire('tokopedia')!(false, failure);
    }

    expect(breaker.acquire('tokopedia')).not.toBeNull();
  });

  it.each([
    'dns_unsafe',
    'access_blocked',
    'listing_unavailable',
    'metadata_missing',
    'listing_mismatch',
    'redirect_disallowed',
    'server_busy',
  ])('does not open for %s', reason => {
    const breaker = createMarketplaceCircuitBreaker();

    for (let i = 0; i < 10; i++) {
      breaker.acquire('tokopedia')!(false, [{ reason }]);
    }

    expect(breaker.acquire('tokopedia')).not.toBeNull();
  });

  it('opens for repeated upstream HTTP 503 responses', () => {
    const breaker = createMarketplaceCircuitBreaker();

    for (let i = 0; i < 5; i++) {
      breaker.acquire('tokopedia')!(false, [{
        reason: 'http_failure',
        status: 503,
      }]);
    }

    expect(breaker.acquire('tokopedia')).toBeNull();
  });

  it('allows only one recovery probe after cooldown', () => {
    vi.useFakeTimers();

    const breaker = createMarketplaceCircuitBreaker();

    openCircuit(breaker);

    vi.advanceTimersByTime(29_999);

    expect(breaker.acquire('tokopedia')).toBeNull();

    vi.advanceTimersByTime(1);

    const probe = breaker.acquire('tokopedia');

    expect(probe).not.toBeNull();
    expect(breaker.acquire('tokopedia')).toBeNull();

    probe!(true, []);

    expect(breaker.acquire('tokopedia')).not.toBeNull();
    expect(breaker.acquire('tokopedia')).not.toBeNull();
  });

  it('reopens after a failed recovery probe', () => {
    vi.useFakeTimers();

    const breaker = createMarketplaceCircuitBreaker();

    openCircuit(breaker);

    vi.advanceTimersByTime(30_000);

    breaker.acquire('tokopedia')!(false, failure);

    expect(breaker.acquire('tokopedia')).toBeNull();

    vi.advanceTimersByTime(30_000);

    expect(breaker.acquire('tokopedia')).not.toBeNull();
  });

  it('releases the recovery probe after an inconclusive result', () => {
    vi.useFakeTimers();

    const breaker = createMarketplaceCircuitBreaker();

    openCircuit(breaker);

    vi.advanceTimersByTime(30_000);

    breaker.acquire('tokopedia')!(false, [{
      reason: 'metadata_missing',
    }]);

    expect(breaker.acquire('tokopedia')).toBeNull();

    vi.advanceTimersByTime(30_000);

    expect(breaker.acquire('tokopedia')).not.toBeNull();
  });

  it('ignores stale completions after opening the circuit', () => {
    const breaker = createMarketplaceCircuitBreaker();

    const stale = breaker.acquire('tokopedia')!;

    openCircuit(breaker);

    stale(true, []);

    expect(breaker.acquire('tokopedia')).toBeNull();
  });

  it('ignores duplicate completion callbacks', () => {
    const breaker = createMarketplaceCircuitBreaker();

    const complete = breaker.acquire('tokopedia')!;

    for (let i = 0; i < 10; i++) {
      complete(false, failure);
    }

    expect(breaker.acquire('tokopedia')).not.toBeNull();
  });
});
