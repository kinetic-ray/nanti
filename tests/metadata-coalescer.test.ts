import { describe, expect, it, vi } from 'vitest';
import { createMetadataCoalescer } from '../server/metadata-coalescer.js';
import type { previewProductMetadata } from '../server/product-preview.js';

const listing = 'https://www.tokopedia.com/shop/lamp';

describe('Metadata request coalescing', () => {
  it('shares concurrent requests for an identical URL', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockResolvedValue(null);

    const coalesced = createMetadataCoalescer(lookup);

    await Promise.all(
      Array.from({ length: 10 }, () => coalesced(new URL(listing))),
    );

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('keeps different product variants isolated', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockResolvedValue(null);

    const coalesced = createMetadataCoalescer(lookup);

    await Promise.all([
      coalesced(new URL(listing + '?variant=red')),
      coalesced(new URL(listing + '?variant=blue')),
    ]);

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('keeps different affiliate links isolated', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockResolvedValue(null);

    const coalesced = createMetadataCoalescer(lookup);

    await Promise.all([
      coalesced(new URL(listing + '?aff_id=one')),
      coalesced(new URL(listing + '?aff_id=two')),
    ]);

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('replays diagnostics independently for every caller', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockImplementation(async (_url, _request, diagnostic) => {
        diagnostic?.('access_blocked', 'www.tokopedia.com', 403);
        return null;
      });

    const coalesced = createMetadataCoalescer(lookup);
    const first = vi.fn();
    const second = vi.fn();

    await Promise.all([
      coalesced(new URL(listing), undefined, first),
      coalesced(new URL(listing), undefined, second),
    ]);

    expect(lookup).toHaveBeenCalledTimes(1);

    for (const callback of [first, second]) {
      expect(callback).toHaveBeenCalledExactlyOnceWith(
        'access_blocked',
        'www.tokopedia.com',
        403,
      );
    }
  });

  it('removes completed requests from the pending registry', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockResolvedValue(null);

    const coalesced = createMetadataCoalescer(lookup);

    await coalesced(new URL(listing));
    await coalesced(new URL(listing));

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('removes failed requests from the pending registry', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockRejectedValueOnce(new Error('fixture failure'))
      .mockResolvedValueOnce(null);

    const coalesced = createMetadataCoalescer(lookup);

    await expect(coalesced(new URL(listing)))
      .rejects.toThrow('fixture failure');

    await expect(coalesced(new URL(listing)))
      .resolves.toBeNull();

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('does not share requests using custom transports', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockResolvedValue(null);

    const coalesced = createMetadataCoalescer(lookup);
    const transport = vi.fn<typeof fetch>();

    await Promise.all([
      coalesced(new URL(listing), transport),
      coalesced(new URL(listing), transport),
    ]);

    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe('Metadata cache', () => {
  const fixture = () => ({
    title: 'Gaming Monitor',
    image: 'https://images.tokopedia.net/monitor.jpg',
    price: {
      priceMinor: 150000000,
      currency: 'IDR' as const,
    },
    productUrl: listing,
    sellerName: 'Computer Store',
  });

  it('reuses successful metadata within the cache TTL', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockResolvedValue(fixture());

    const cached = createMetadataCoalescer(lookup);

    expect(await cached(new URL(listing))).toEqual(fixture());
    expect(await cached(new URL(listing))).toEqual(fixture());
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('fetches fresh metadata after cache expiration', async () => {
    vi.useFakeTimers();

    try {
      const lookup = vi.fn<typeof previewProductMetadata>()
        .mockResolvedValueOnce(fixture())
        .mockResolvedValueOnce({
          ...fixture(),
          title: 'Updated Monitor',
        });

      const cached = createMetadataCoalescer(lookup);

      await cached(new URL(listing));

      await vi.advanceTimersByTimeAsync(30_001);

      expect((await cached(new URL(listing)))?.title)
        .toBe('Updated Monitor');

      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not extend freshness when a cached entry is accessed', async () => {
    vi.useFakeTimers();

    try {
      const lookup = vi.fn<typeof previewProductMetadata>()
        .mockResolvedValue(fixture());

      const cached = createMetadataCoalescer(lookup);

      await cached(new URL(listing));

      await vi.advanceTimersByTimeAsync(20_000);
      await cached(new URL(listing));

      expect(lookup).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_001);
      await cached(new URL(listing));

      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts the least recently used entry at capacity', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockResolvedValue(fixture());

    const cached = createMetadataCoalescer(lookup);
    const url = (id: number) => new URL(listing + '?variant=' + id);

    for (let id = 0; id < 128; id++) {
      await cached(url(id));
    }

    await cached(url(0));
    await cached(url(128));

    expect(lookup).toHaveBeenCalledTimes(129);

    await cached(url(0));

    expect(lookup).toHaveBeenCalledTimes(129);

    await cached(url(1));

    expect(lookup).toHaveBeenCalledTimes(130);
  });

  it('isolates cached metadata and nested price objects', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockResolvedValue(fixture());

    const cached = createMetadataCoalescer(lookup);
    const first = await cached(new URL(listing));

    expect(first).not.toBeNull();

    first!.title = 'Modified title';
    first!.price!.priceMinor = 1;

    const second = await cached(new URL(listing));

    expect(second).toEqual(fixture());
    expect(second).not.toBe(first);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('does not share cached metadata between variants', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockResolvedValueOnce({
        ...fixture(),
        title: 'Red Monitor',
      })
      .mockResolvedValueOnce({
        ...fixture(),
        title: 'Blue Monitor',
      });

    const cached = createMetadataCoalescer(lookup);

    const red = new URL(listing + '?variant=red');
    const blue = new URL(listing + '?variant=blue');

    await cached(red);
    await cached(blue);

    expect((await cached(red))?.title).toBe('Red Monitor');
    expect((await cached(blue))?.title).toBe('Blue Monitor');

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('does not cache unsuccessful extraction results', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fixture());

    const cached = createMetadataCoalescer(lookup);

    expect(await cached(new URL(listing))).toBeNull();
    expect(await cached(new URL(listing))).toEqual(fixture());
    expect(await cached(new URL(listing))).toEqual(fixture());

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('isolates custom transports from the production cache', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockResolvedValueOnce(fixture())
      .mockResolvedValueOnce({
        ...fixture(),
        title: 'Custom transport result',
      });

    const cached = createMetadataCoalescer(lookup);
    const transport = vi.fn<typeof fetch>();

    await cached(new URL(listing));

    expect((await cached(new URL(listing), transport))?.title)
      .toBe('Custom transport result');

    expect((await cached(new URL(listing)))?.title)
      .toBe('Gaming Monitor');

    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe('Metadata concurrency protection', () => {
  it('limits unique concurrent lookups and recovers capacity', async () => {
    let release!: () => void;

    const gate = new Promise<void>(resolve => {
      release = resolve;
    });

    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockImplementation(async () => {
        await gate;
        return null;
      });

    const cached = createMetadataCoalescer(lookup);

    const url = (id: number) =>
      new URL(listing + '?variant=' + id);

    const active = Array.from(
      { length: 8 },
      (_, id) => cached(url(id)),
    );

    const diagnostic = vi.fn();

    expect(await cached(url(8), undefined, diagnostic))
      .toBeNull();

    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(
      'server_busy',
      'www.tokopedia.com',
    );

    expect(lookup).toHaveBeenCalledTimes(8);

    release();
    await Promise.all(active);

    await cached(url(8));

    expect(lookup).toHaveBeenCalledTimes(9);
  });

  it('allows identical pending requests at full capacity', async () => {
    let release!: () => void;

    const gate = new Promise<void>(resolve => {
      release = resolve;
    });

    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockImplementation(async () => {
        await gate;
        return null;
      });

    const cached = createMetadataCoalescer(lookup);

    const active = Array.from({ length: 8 }, (_, id) =>
      cached(new URL(listing + '?variant=' + id)),
    );

    const diagnostic = vi.fn();

    const shared = cached(
      new URL(listing + '?variant=0'),
      undefined,
      diagnostic,
    );

    await Promise.resolve();

    expect(lookup).toHaveBeenCalledTimes(8);

    release();

    await Promise.all([...active, shared]);

    expect(diagnostic).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledTimes(8);
  });

  it('serves cached metadata while all lookup slots are occupied', async () => {
    let release!: () => void;

    const gate = new Promise<void>(resolve => {
      release = resolve;
    });

    const metadata = {
      title: 'Gaming Monitor',
      image: null,
      price: null,
    };

    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockResolvedValueOnce(metadata)
      .mockImplementation(async () => {
        await gate;
        return null;
      });

    const cached = createMetadataCoalescer(lookup);

    await cached(new URL(listing));

    const active = Array.from({ length: 8 }, (_, id) =>
      cached(new URL(listing + '?variant=' + id)),
    );

    const diagnostic = vi.fn();

    expect(await cached(new URL(listing), undefined, diagnostic))
      .toEqual(metadata);

    expect(diagnostic).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledTimes(9);

    release();
    await Promise.all(active);
  });
});

describe('Circuit breaker integration', () => {
  it('blocks external fetches while preserving cache and other marketplaces', async () => {
    const metadata = {
      title: 'Gaming Monitor',
      image: null,
      price: null,
    };

    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockResolvedValueOnce(metadata)
      .mockImplementation(async (url, _request, diagnostic) => {
        if (url.hostname.includes('tokopedia')) {
          diagnostic?.('timeout', url.hostname);
          return null;
        }

        return metadata;
      });

    const cached = createMetadataCoalescer(lookup);

    await cached(new URL(listing));

    for (let i = 0; i < 5; i++) {
      await cached(new URL(listing + '?variant=' + i));
    }

    const diagnostic = vi.fn();

    expect(await cached(
      new URL(listing + '?variant=blocked'),
      undefined,
      diagnostic,
    )).toBeNull();

    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(
      'marketplace_unavailable',
      'www.tokopedia.com',
    );

    expect(lookup).toHaveBeenCalledTimes(6);

    expect(await cached(new URL(listing))).toEqual(metadata);

    expect(await cached(
      new URL('https://shopee.co.id/product/123/456'),
    )).toEqual(metadata);

    expect(lookup).toHaveBeenCalledTimes(7);
  });

  it('counts coalesced failures only once', async () => {
    const lookup = vi.fn<typeof previewProductMetadata>()
      .mockImplementation(async (url, _request, diagnostic) => {
        diagnostic?.('timeout', url.hostname);
        return null;
      });

    const cached = createMetadataCoalescer(lookup);

    await Promise.all(
      Array.from({ length: 10 }, () =>
        cached(new URL(listing)),
      ),
    );

    expect(lookup).toHaveBeenCalledTimes(1);

    await cached(new URL(listing));

    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
