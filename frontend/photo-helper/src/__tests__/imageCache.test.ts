import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getImageCache } from '../utils/imageCache';

/**
 * `Image` double. jsdom's HTMLImageElement never fires `onload` for a `blob:`
 * src, so the cache would hang; this records every construction (that is what
 * "was the image decoded twice?" actually means) and lets each case settle or
 * fail its loads explicitly.
 */
class FakeImage {
  static constructed: FakeImage[] = [];
  static reset() { FakeImage.constructed = []; }

  crossOrigin = '';
  onload: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  width = 800;
  height = 600;
  private _src = '';

  constructor() {
    FakeImage.constructed.push(this);
  }

  set src(value: string) { this._src = value; }
  get src() { return this._src; }

  settle() { this.onload?.(); }
  fail(error: unknown = new Error('load failed')) { this.onerror?.(error); }
}

/** Read the private in-flight map without an `any` cast. */
function inflightSize(): number {
  return (getImageCache() as unknown as { inflight: Map<string, unknown> }).inflight.size;
}

beforeEach(() => {
  FakeImage.reset();
  vi.stubGlobal('Image', FakeImage);
  // Fresh cache state per case — the manager is a module singleton.
  getImageCache().clear();
});

afterEach(() => {
  getImageCache().clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ImageCacheManager.getImageByUrl', () => {
  it('never expires a blob: URL — the bytes behind a live blob cannot change', async () => {
    vi.useFakeTimers();
    const cache = getImageCache();

    const first = cache.getImageByUrl('blob:photo-a');
    FakeImage.constructed[0].settle();
    const imageA = await first;

    // Well past the 5-minute maxAge.
    vi.advanceTimersByTime(6 * 60 * 1000);

    const imageB = await cache.getImageByUrl('blob:photo-a');

    expect(imageB).toBe(imageA);
    expect(FakeImage.constructed).toHaveLength(1);
  });

  it('still expires a non-blob URL, because a server asset can change', async () => {
    vi.useFakeTimers();
    const cache = getImageCache();

    const first = cache.getImageByUrl('https://example.com/a.jpg');
    FakeImage.constructed[0].settle();
    await first;

    vi.advanceTimersByTime(6 * 60 * 1000);

    const second = cache.getImageByUrl('https://example.com/a.jpg');
    expect(FakeImage.constructed).toHaveLength(2);
    FakeImage.constructed[1].settle();
    await second;
  });

  it('de-duplicates concurrent loads of the same URL', async () => {
    const cache = getImageCache();

    // The real shape of the bug: the editor's useCachedImage effect fires
    // before the grid's preload effect, so both ask for the same blob.
    const a = cache.getImageByUrl('blob:photo-b');
    const b = cache.getImageByUrl('blob:photo-b');

    expect(FakeImage.constructed).toHaveLength(1);
    expect(inflightSize()).toBe(1);

    FakeImage.constructed[0].settle();
    const [imageA, imageB] = await Promise.all([a, b]);

    expect(imageA).toBe(imageB);
    expect(inflightSize()).toBe(0);

    // A third call after settling is a plain cache hit.
    await cache.getImageByUrl('blob:photo-b');
    expect(FakeImage.constructed).toHaveLength(1);
  });

  it('rejects every waiter on failure and clears the slot so a retry re-issues', async () => {
    const cache = getImageCache();

    const a = cache.getImageByUrl('blob:broken');
    const b = cache.getImageByUrl('blob:broken');
    FakeImage.constructed[0].fail();

    await expect(a).rejects.toBeDefined();
    await expect(b).rejects.toBeDefined();
    expect(inflightSize()).toBe(0);

    const retry = cache.getImageByUrl('blob:broken');
    expect(FakeImage.constructed).toHaveLength(2);
    FakeImage.constructed[1].settle();
    await expect(retry).resolves.toBeDefined();
  });
});

describe('ImageCacheManager.preloadImages', () => {
  it('loads blob URLs, skips everything else, and logs nothing while debug logging is off', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cache = getImageCache();

    const done = cache.preloadImages([
      { id: 'a', sessionId: 's', url: 'blob:photo-a' },
      { id: 'b', sessionId: 's', url: 'https://example.com/b.jpg' },
      { id: 'c', sessionId: 's' },
    ]);

    // Only the blob URL was fetched.
    expect(FakeImage.constructed).toHaveLength(1);
    FakeImage.constructed[0].settle();
    await done;

    // The hot-path traces are behind `debugLog`, which is off by default.
    expect(logSpy).not.toHaveBeenCalled();
  });
});
