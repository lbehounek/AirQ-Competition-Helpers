/**
 * Covers the three WP2d changes to the pica wrapper:
 *  - an HTMLImageElement now goes straight to pica (no full-resolution
 *    intermediate canvas on the main thread),
 *  - the resize cache is bounded by PIXELS with the size check before the
 *    clone, and
 *  - `intelligentResize`'s per-call `skipCache` lets the PDF export bypass the
 *    cache without disabling it for a concurrent editor redraw.
 *
 * `vi.resetModules()` per case because both the pica instance and the cache
 * live in module-level singletons.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Every `pica.resize` call, in order, as `[source, target, options]`. */
const resizeCalls: { source: unknown; target: HTMLCanvasElement; options: Record<string, unknown> }[] = [];
let resizeShouldReject = false;
/**
 * Park any resize whose target is this wide until `releaseGatedResize` is
 * called. Two resizes overlapping in time is the only way to observe a
 * process-global cache bypass, and the mock otherwise resolves instantly.
 */
let gatedTargetWidth: number | null = null;
let releaseGatedResize: (() => void) | null = null;

vi.mock('pica', () => ({
  default: class {
    resize = vi.fn(async (source: unknown, target: HTMLCanvasElement, options: Record<string, unknown>) => {
      resizeCalls.push({ source, target, options });
      if (resizeShouldReject) throw new Error('pica failed');
      if (gatedTargetWidth !== null && target.width === gatedTargetWidth) {
        await new Promise<void>((resolve) => { releaseGatedResize = resolve; });
      }
      return target;
    });
  },
}));

/** Spy on every canvas 2D op the module performs (clone + fallback draw). */
const drawImage = vi.fn();
let createElementSpy: ReturnType<typeof vi.spyOn>;

/** Count only the canvases the module under test creates. */
const canvasCreateCount = () =>
  createElementSpy.mock.calls.filter((call: unknown[]) => call[0] === 'canvas').length;

/** A fake decoded image of the given intrinsic size. */
const makeImage = (width: number, height: number): HTMLImageElement => {
  const img = document.createElement('img');
  Object.defineProperty(img, 'width', { value: width });
  Object.defineProperty(img, 'height', { value: height });
  Object.defineProperty(img, 'src', { value: `blob:photo-${width}x${height}` });
  return img;
};

/** A canvas of a given size, used as a `setCached` payload. */
const makeCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const loadModule = async () => {
  vi.resetModules();
  return import('../utils/highQualityResize');
};

describe('highQualityResize', () => {
  beforeEach(() => {
    resizeCalls.length = 0;
    resizeShouldReject = false;
    gatedTargetWidth = null;
    releaseGatedResize = null;
    drawImage.mockClear();

    // jsdom canvases have no 2D context; supply the minimum the module uses.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    })) as unknown as HTMLCanvasElement['getContext'];

    createElementSpy = vi.spyOn(document, 'createElement');
  });

  describe('image pass-through', () => {
    it('hands the image itself to pica and allocates only the target canvas', async () => {
      const { resizeImageHighQuality } = await loadModule();
      const image = makeImage(4000, 3000);
      createElementSpy.mockClear();

      await resizeImageHighQuality(image, 800, 600);

      expect(resizeCalls).toHaveLength(1);
      expect(resizeCalls[0].source).toBe(image);
      // Exactly one canvas: the resize target. The old code also built a
      // full-resolution 4000x3000 intermediate.
      expect(canvasCreateCount()).toBe(1);
      expect(resizeCalls[0].target.width).toBe(800);
      expect(resizeCalls[0].target.height).toBe(600);
    });

    it('forwards the documented defaults and honours overrides', async () => {
      const { resizeCanvasHighQuality } = await loadModule();

      await resizeCanvasHighQuality(makeCanvas(1000, 800), 500, 400);
      expect(resizeCalls[0].options).toEqual({
        filter: 'lanczos3',
        unsharpAmount: 80,
        unsharpRadius: 0.6,
        unsharpThreshold: 2,
        quality: 3,
      });

      await resizeCanvasHighQuality(makeCanvas(1000, 800), 500, 400, {
        filter: 'mks2013',
        unsharpAmount: 0,
        quality: 1,
      });
      expect(resizeCalls[1].options).toEqual({
        filter: 'mks2013',
        unsharpAmount: 0,
        unsharpRadius: 0.6,
        unsharpThreshold: 2,
        quality: 1,
      });
    });

    it('falls back to browser scaling for an image source when pica rejects', async () => {
      resizeShouldReject = true;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { resizeImageHighQuality } = await loadModule();
      const image = makeImage(4000, 3000);

      const result = await resizeImageHighQuality(image, 800, 600);

      expect(result.width).toBe(800);
      expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 800, 600);
      warn.mockRestore();
    });
  });

  describe('resizeImageMultiPass', () => {
    it('starts from the image and never materialises a full-size canvas', async () => {
      const { resizeImageMultiPass } = await loadModule();
      const image = makeImage(4000, 3000);
      createElementSpy.mockClear();

      await resizeImageMultiPass(image, 800, 600, { unsharpAmount: 80 });

      // 4000x3000 → 2000x1500 → 1000x750 → 800x600. Every step halves and the
      // last one lands exactly on the target, so all three are "intermediate"
      // (unsharpened) — unchanged from the pre-WP2d behaviour.
      expect(resizeCalls).toHaveLength(3);
      expect(resizeCalls[0].source).toBe(image);
      expect(resizeCalls.slice(1).every((call) => call.source instanceof HTMLCanvasElement)).toBe(true);
      for (const call of resizeCalls) {
        expect(call.options.unsharpAmount).toBe(0);
      }
      // One canvas per resize step and nothing else — no 4000x3000 copy.
      expect(canvasCreateCount()).toBe(resizeCalls.length);
    });

    it('applies the caller sharpening on the final exact-size pass', async () => {
      const { resizeImageMultiPass } = await loadModule();
      // 1700x1275 → 850x637 (halved, clamped by neither dimension) then a
      // final 800x600 pass, which is where the caller's unsharp lands.
      const image = makeImage(1700, 1275);

      await resizeImageMultiPass(image, 800, 600, { unsharpAmount: 80 });

      expect(resizeCalls).toHaveLength(2);
      expect(resizeCalls[0].source).toBe(image);
      expect(resizeCalls[0].options.unsharpAmount).toBe(0);
      expect(resizeCalls[1].options.unsharpAmount).toBe(80);
    });
  });

  describe('cache pixel budget', () => {
    it('skips an oversize entry without cloning it', async () => {
      const { getHighQualityResizeCache } = await loadModule();
      const cache = getHighQualityResizeCache();
      // 4800x3600 = 17.28 MP > the 16 MP budget. Built BEFORE the spy reset so
      // only canvases the cache itself would allocate get counted.
      const oversize = makeCanvas(4800, 3600);
      createElementSpy.mockClear();

      cache.setCached('img-a', 4800, 3600, {}, oversize);

      expect(cache.getStats().size).toBe(0);
      // The clone is a full-size drawImage — it must not have happened.
      expect(canvasCreateCount()).toBe(0);
      expect(drawImage).not.toHaveBeenCalled();
    });

    it('evicts oldest-first to stay inside the budget', async () => {
      const { getHighQualityResizeCache } = await loadModule();
      const cache = getHighQualityResizeCache();

      // 2.4 MP each; seven of them = 16.8 MP, one over budget.
      for (let i = 0; i < 7; i++) {
        cache.setCached(`img-${i}`, 1800, 1350, {}, makeCanvas(1800, 1350));
      }

      const stats = cache.getStats();
      expect(stats.totalPixels).toBeLessThanOrEqual(stats.maxTotalPixels);
      expect(stats.size).toBe(6);
      // Newest survives, oldest is gone.
      expect(cache.getCached('img-6', 1800, 1350, {})).not.toBeNull();
      expect(cache.getCached('img-0', 1800, 1350, {})).toBeNull();
    });

    it('misses when the options differ, and clear() resets the budget', async () => {
      const { getHighQualityResizeCache } = await loadModule();
      const cache = getHighQualityResizeCache();

      cache.setCached('img-a', 800, 600, { unsharpAmount: 80 }, makeCanvas(800, 600));
      expect(cache.getCached('img-a', 800, 600, { unsharpAmount: 0 })).toBeNull();
      expect(cache.getCached('img-a', 800, 600, { unsharpAmount: 80 })).not.toBeNull();

      cache.clear();
      expect(cache.getStats().size).toBe(0);
      expect(cache.getStats().totalPixels).toBe(0);
    });
  });

  describe('intelligentResize', () => {
    it('returns a copy on a cache hit and does not resize again', async () => {
      const { intelligentResize } = await loadModule();
      const image = makeImage(1600, 1200);

      const first = await intelligentResize(image, 800, 600);
      const callsAfterFirst = resizeCalls.length;
      const second = await intelligentResize(image, 800, 600);

      expect(resizeCalls.length).toBe(callsAfterFirst);
      expect(second).not.toBe(first);
      expect(second.width).toBe(800);
    });
  });

  describe("intelligentResize — the PDF export's cache bypass", () => {
    it('skipCache bypasses both the read and the write', async () => {
      const { intelligentResize, getHighQualityResizeCache } = await loadModule();
      const image = makeImage(1600, 1200);

      // Seed the cache so we can prove the read is skipped too.
      await intelligentResize(image, 800, 600);
      const seededCalls = resizeCalls.length;
      const seededSize = getHighQualityResizeCache().getStats().size;
      expect(seededSize).toBe(1);

      await intelligentResize(image, 800, 600, { skipCache: true });

      // A real resize ran (cache read skipped) …
      expect(resizeCalls.length).toBeGreaterThan(seededCalls);
      // … and nothing new was written.
      expect(getHighQualityResizeCache().getStats().size).toBe(seededSize);
    });

    it('a bypassing call does not disable caching for a CONCURRENT one', async () => {
      // The reason the bypass is per-call and not a process-wide suspend: the
      // PDF export yields between photos, so the editor stays interactive and
      // its redraws must keep both reading and writing the cache. A global flag
      // made every modal redraw during an export re-run pica for nothing.
      const { intelligentResize, getHighQualityResizeCache } = await loadModule();
      const exportImage = makeImage(4000, 3000);
      const editorImage = makeImage(1600, 1200);

      // Park the export's own resize so the editor's really does overlap it.
      gatedTargetWidth = 1600;
      const exporting = intelligentResize(exportImage, 1600, 1200, { skipCache: true });
      await vi.waitFor(() => expect(releaseGatedResize).not.toBeNull());

      // The editor's redraw, issued while the export's resize is still running.
      await intelligentResize(editorImage, 600, 450);

      releaseGatedResize!();
      await exporting;

      // Exactly one entry — the editor's. The export left nothing behind.
      expect(getHighQualityResizeCache().getStats().size).toBe(1);

      // And that entry is served on the next redraw.
      const callsBefore = resizeCalls.length;
      await intelligentResize(editorImage, 600, 450);
      expect(resizeCalls.length).toBe(callsBefore);
    });
  });
});
