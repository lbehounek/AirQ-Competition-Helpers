/**
 * WP2d behaviour of the PDF export: the dedicated GPU context, sequential
 * rendering with progress + yields, Blob-based JPEG embedding, and the
 * in-flight guard that the yields make necessary.
 *
 * Every case imports the module fresh (`vi.resetModules()`), because
 * `exportInFlight` is module-level state — a leftover promise from one case
 * would coalesce the next case's export into it.
 *
 * WP2e note: this file targets `utils/pdfGeneratorImpl` — the heavy module
 * behind the lazy `utils/pdfGenerator` facade. Importing the facade here would
 * only exercise the `import()` wrapper; the facade has its own suite in
 * `pdfGeneratorFacade.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import type { ApiPhoto, ApiPhotoSet } from '../types/api';
import { makeCanvasState } from './support/testHelpers';

// ---------------------------------------------------------------------------
// Mocks. Declared at module scope so each case can reprogram them before the
// dynamic import of the module under test.
// ---------------------------------------------------------------------------

/** Ordered log of the calls whose RELATIVE order matters to a test. */
const callLog: string[] = [];

const toBlobMock = vi.fn(async () => new Blob(['pdf'], { type: 'application/pdf' }));
const pdfMock = vi.fn((..._args: unknown[]) => {
  callLog.push('pdf');
  return { toBlob: toBlobMock };
});

/** Captures every `React.createElement(Image, props)` the module builds. */
const imageProps: Record<string, unknown>[] = [];

vi.mock('@react-pdf/renderer', () => ({
  Document: 'Document',
  Page: 'Page',
  Image: 'Image',
  StyleSheet: { create: (styles: unknown) => styles },
  pdf: (...args: unknown[]) => pdfMock(...args),
}));

/** Stands in for `renderPhotoOnCanvas`; positional args are asserted by index. */
const renderMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock('../components/PhotoEditorApi', () => ({
  BASE_WIDTH: 300,
  drawCircle: vi.fn(),
  renderPhotoOnCanvas: (...args: unknown[]) => renderMock(...args),
}));

vi.mock('../utils/canvasUtils', () => ({ drawLabel: vi.fn() }));

const getImageMock = vi.fn(async (_url: string) => document.createElement('img') as HTMLImageElement);
vi.mock('../utils/imageCache', () => ({
  getImageCache: () => ({ getImageByUrl: (url: string) => getImageMock(url) }),
}));

const disposeMock = vi.fn();
const acquireMock = vi.fn();

/**
 * Build a handle shaped exactly like `acquireDedicatedWebGLContext`'s: its
 * `dispose` is IDEMPOTENT, which is what lets the module dispose eagerly and
 * again from its `finally`. `disposeMock` therefore counts real disposals, not
 * calls.
 */
const makeGlHandle = () => {
  let disposed = false;
  return {
    context: fakeGlContext,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      callLog.push('dispose');
      disposeMock();
    },
  };
};
vi.mock('../utils/webglContextManager', () => ({
  acquireDedicatedWebGLContext: () => acquireMock(),
}));

const yieldMock = vi.fn(async () => {});
vi.mock('../utils/yieldToEventLoop', () => ({ yieldToEventLoop: () => yieldMock() }));


// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal, type-honest `ApiPhoto`. */
const makePhoto = (id: string, overrides: Partial<ApiPhoto> = {}): ApiPhoto => ({
  id,
  url: `blob:${id}`,
  label: id.toUpperCase(),
  canvasState: makeCanvasState(),
  ...overrides,
} as ApiPhoto);

/** A photo set of `count` photos, ids `p1…pN` prefixed per set. */
const makeSet = (title: string, count: number, prefix = 'p'): ApiPhotoSet => ({
  title,
  photos: Array.from({ length: count }, (_, i) => makePhoto(`${prefix}${i + 1}`)),
} as ApiPhotoSet);

const EMPTY_SET: ApiPhotoSet = { title: '', photos: [] } as ApiPhotoSet;

/** A stand-in for the dedicated context handle. */
const fakeGlContext = { marker: 'dedicated-gl' };

const loadModule = async () => {
  vi.resetModules();
  return import('../utils/pdfGeneratorImpl');
};

/**
 * Drain the microtask queue. Everything the export awaits is mocked to resolve
 * immediately (including `yieldToEventLoop`), so a bounded drain is enough to
 * reach the next real suspension point.
 */
const flushMicrotasks = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

/** All `Image` src props that are photos (headers are data:image/png strings). */
const photoSrcs = () =>
  imageProps.filter((p) => typeof p.key === 'string' && p.key.startsWith('photo-')).map((p) => p.src);

describe('generatePDF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callLog.length = 0;
    imageProps.length = 0;

    acquireMock.mockImplementation(() => makeGlHandle());
    renderMock.mockImplementation(async () => {});
    toBlobMock.mockImplementation(async () => new Blob(['pdf'], { type: 'application/pdf' }));
    getImageMock.mockImplementation(async (_url: string) => document.createElement('img') as HTMLImageElement);

    // Record every Image element the module builds. `React.createElement` is
    // the only route from the module to @react-pdf, so this is a complete log.
    vi.spyOn(React, 'createElement').mockImplementation(((type: unknown, props: Record<string, unknown>, ...children: unknown[]) => {
      if (type === 'Image' && props) imageProps.push(props);
      return { type, props, children } as unknown as ReturnType<typeof React.createElement>;
    }) as typeof React.createElement);

    // jsdom has no canvas backend: supply just enough 2D API for the
    // placeholder cell + the header rasteriser.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 10 })),
      scale: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
      clearRect: vi.fn(),
    })) as unknown as HTMLCanvasElement['getContext'];
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback, type?: string) => {
      cb(new Blob(['jpeg'], { type: type ?? 'image/jpeg' }));
    }) as unknown as HTMLCanvasElement['toBlob'];
    HTMLCanvasElement.prototype.toDataURL = vi.fn((type?: string) =>
      type === 'image/png' ? 'data:image/png;base64,x' : 'data:image/jpeg;base64,x',
    ) as unknown as HTMLCanvasElement['toDataURL'];

    URL.createObjectURL = vi.fn(() => 'blob:pdf');
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GPU wiring', () => {
    it('passes the dedicated context (and never a manager) to every render', async () => {
      const { generatePDF } = await loadModule();
      const set1 = makeSet('Set 1', 3);
      // A photo still carrying `whiteBalance.auto` goes down the same path —
      // the shader ignores `auto`, which the editor has already resolved.
      set1.photos[2].canvasState = makeCanvasState({
        whiteBalance: { temperature: 0, tint: 0, auto: true },
      });

      await generatePDF(set1, EMPTY_SET, 's1');

      expect(renderMock).toHaveBeenCalledTimes(3);
      for (const call of renderMock.mock.calls) {
        expect(call[7]).toBe(fakeGlContext);
        expect(call[8]).toBeUndefined();
        expect(call[12]).toBe(true); // useHighQuality
      }
    });

    it('falls back to a null context when acquisition fails', async () => {
      acquireMock.mockReturnValue(null);
      const { generatePDF } = await loadModule();

      await generatePDF(makeSet('Set 1', 2), EMPTY_SET, 's1');

      expect(renderMock).toHaveBeenCalledTimes(2);
      expect(renderMock.mock.calls[0][7]).toBeNull();
      expect(pdfMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('context disposal', () => {
    it('disposes before composing the PDF on the happy path', async () => {
      const { generatePDF } = await loadModule();

      await generatePDF(makeSet('Set 1', 2), EMPTY_SET, 's1');

      expect(disposeMock).toHaveBeenCalledTimes(1);
      expect(callLog).toEqual(['dispose', 'pdf']);
    });

    it('disposes when renders fail and the export aborts', async () => {
      renderMock.mockImplementation(async (...args: unknown[]) => {
        const canvas = args[0] as HTMLCanvasElement;
        // Fail two of nine by inspecting the label we drew onto the canvas.
        void canvas;
        throw new Error('render exploded');
      });
      const { generatePDF } = await loadModule();

      await expect(generatePDF(makeSet('Set 1', 2), EMPTY_SET, 's1')).rejects.toMatchObject({
        renderFailures: expect.any(Array),
      });

      expect(disposeMock).toHaveBeenCalledTimes(1);
      expect(pdfMock).not.toHaveBeenCalled();
    });

    it('disposes when PDF composition rejects', async () => {
      toBlobMock.mockRejectedValue(new Error('compose failed'));
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { generatePDF } = await loadModule();

      await expect(generatePDF(makeSet('Set 1', 2), EMPTY_SET, 's1')).rejects.toThrow('compose failed');

      expect(disposeMock).toHaveBeenCalledTimes(1);
      error.mockRestore();
    });
  });

  describe('sequential rendering', () => {
    it('renders one photo at a time', async () => {
      const deferreds: (() => void)[] = [];
      renderMock.mockImplementation(
        () => new Promise<void>((resolve) => deferreds.push(() => resolve())),
      );
      const { generatePDF } = await loadModule();

      const running = generatePDF(makeSet('Set 1', 3), EMPTY_SET, 's1');

      // Prefetch, then the FIRST render only — the other two must be waiting
      // on this one rather than running alongside it.
      await flushMicrotasks();
      expect(renderMock).toHaveBeenCalledTimes(1);

      deferreds[0]();
      await flushMicrotasks();
      expect(renderMock).toHaveBeenCalledTimes(2);

      // Drain the rest so the module's in-flight promise settles.
      while (deferreds.length) {
        deferreds.shift()!();
        await flushMicrotasks();
      }
      await running;
    });

    it('yields after every photo and once before composing', async () => {
      const { generatePDF } = await loadModule();

      await generatePDF(makeSet('Set 1', 3), EMPTY_SET, 's1');

      // 3 photos + 1 pre-compose yield.
      expect(yieldMock).toHaveBeenCalledTimes(4);
    });

    it('prefetches every non-placeholder image before the first render', async () => {
      const order: string[] = [];
      getImageMock.mockImplementation(async (url: string) => {
        order.push(`fetch:${url}`);
        return document.createElement('img') as HTMLImageElement;
      });
      renderMock.mockImplementation(async () => {
        order.push('render');
      });
      const { generatePDF } = await loadModule();

      await generatePDF(makeSet('Set 1', 3), EMPTY_SET, 's1');

      // All three prefetches happen first, before any render. (A fourth
      // `getImageByUrl` follows for photo 1 — `getPhotoDataUrl` asks the cache
      // again, which is a hit by then.)
      expect(order.slice(0, 3)).toEqual(['fetch:blob:p1', 'fetch:blob:p2', 'fetch:blob:p3']);
      expect(order.indexOf('render')).toBeGreaterThan(2);
    });

    it('surfaces a photo whose image cannot be loaded as a render failure', async () => {
      getImageMock.mockImplementation(async (url: string) => {
        if (url === 'blob:p2') throw new Error('image gone');
        return document.createElement('img') as HTMLImageElement;
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { generatePDF } = await loadModule();

      await expect(generatePDF(makeSet('Set 1', 3), EMPTY_SET, 's1')).rejects.toMatchObject({
        renderFailures: [{ photoId: 'p2' }],
      });
      expect(pdfMock).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('progress reporting', () => {
    it('reports every render then compose then save', async () => {
      const onProgress = vi.fn();
      const { generatePDF } = await loadModule();

      await generatePDF(makeSet('Set 1', 3), makeSet('Set 2', 2, 'q'), 's1', 4 / 3, undefined, 'landscape', undefined, 'track', undefined, { onProgress });

      const events = onProgress.mock.calls.map(([p]) => p);
      expect(events.slice(0, 5)).toEqual([
        { phase: 'render', done: 1, total: 5 },
        { phase: 'render', done: 2, total: 5 },
        { phase: 'render', done: 3, total: 5 },
        { phase: 'render', done: 4, total: 5 },
        { phase: 'render', done: 5, total: 5 },
      ]);
      expect(events[5]).toEqual({ phase: 'compose', done: 5, total: 5 });
      expect(events[6]).toEqual({ phase: 'save', done: 5, total: 5 });
    });

    it('counts placeholders and ignores empty sets', async () => {
      const onProgress = vi.fn();
      const set1 = makeSet('Set 1', 2);
      set1.photos[1] = makePhoto('ph', { isPlaceholder: true } as Partial<ApiPhoto>);
      const { generatePDF } = await loadModule();

      await generatePDF(set1, EMPTY_SET, 's1', 4 / 3, undefined, 'landscape', undefined, 'track', undefined, { onProgress });

      const renderEvents = onProgress.mock.calls.map(([p]) => p).filter((p) => p.phase === 'render');
      expect(renderEvents).toHaveLength(2);
      expect(renderEvents.at(-1)).toEqual({ phase: 'render', done: 2, total: 2 });
      // The placeholder never reaches renderPhotoOnCanvas.
      expect(renderMock).toHaveBeenCalledTimes(1);
    });

    it('still finishes at done === total when a set carries a hole', async () => {
      const onProgress = vi.fn();
      const set1 = makeSet('Set 1', 3);
      // Defensive data: an undefined entry. Cast because ApiPhotoSet does not
      // model holes — the render loop nonetheless handles them.
      (set1.photos as (ApiPhoto | undefined)[])[1] = undefined;
      const { generatePDF } = await loadModule();

      await generatePDF(set1, EMPTY_SET, 's1', 4 / 3, undefined, 'landscape', undefined, 'track', undefined, { onProgress });

      const renderEvents = onProgress.mock.calls.map(([p]) => p).filter((p) => p.phase === 'render');
      expect(renderEvents.at(-1)!.done).toBe(renderEvents.at(-1)!.total);
    });
  });

  describe('JPEG embedding', () => {
    it('embeds photo cells as image/jpeg Blobs', async () => {
      const { generatePDF } = await loadModule();

      await generatePDF(makeSet('Set 1', 2), EMPTY_SET, 's1');

      const srcs = photoSrcs();
      expect(srcs).toHaveLength(2);
      for (const src of srcs) {
        expect(src).toBeInstanceOf(Blob);
        expect((src as Blob).type).toBe('image/jpeg');
      }
      expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        'image/jpeg',
        0.95,
      );
    });

    it('falls back to a data URL when toBlob yields null', async () => {
      HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback) => {
        cb(null);
      }) as unknown as HTMLCanvasElement['toBlob'];
      const { generatePDF } = await loadModule();

      await generatePDF(makeSet('Set 1', 1), EMPTY_SET, 's1');

      expect(photoSrcs()).toEqual(['data:image/jpeg;base64,x']);
    });

    it('falls back to a data URL when toBlob throws', async () => {
      HTMLCanvasElement.prototype.toBlob = vi.fn(() => {
        throw new Error('no encoder');
      }) as unknown as HTMLCanvasElement['toBlob'];
      const { generatePDF } = await loadModule();

      await generatePDF(makeSet('Set 1', 1), EMPTY_SET, 's1');

      expect(photoSrcs()).toEqual(['data:image/jpeg;base64,x']);
    });

    it('keeps header rasters as PNG data URLs', async () => {
      const { generatePDF } = await loadModule();

      // 16:9 takes the top-header branch, which rasterises the merged title.
      await generatePDF(makeSet('Set 1', 2), EMPTY_SET, 's1', 16 / 9, 'Cup');

      const headerSrc = imageProps.find((p) => String(p.key).startsWith('merged-title-'))?.src;
      expect(headerSrc).toBe('data:image/png;base64,x');
    });
  });

  describe('in-flight guard', () => {
    it('coalesces a concurrent second call onto the running export', async () => {
      const { generatePDF } = await loadModule();
      const set1 = makeSet('Set 1', 3);

      const first = generatePDF(set1, EMPTY_SET, 's1');
      const second = generatePDF(set1, EMPTY_SET, 's1');

      expect(second).toBe(first);
      await first;

      expect(renderMock).toHaveBeenCalledTimes(3);
      expect(acquireMock).toHaveBeenCalledTimes(1);
      expect(pdfMock).toHaveBeenCalledTimes(1);
    });

    it('allows a fresh export once the previous one settled', async () => {
      const { generatePDF } = await loadModule();
      const set1 = makeSet('Set 1', 1);

      await generatePDF(set1, EMPTY_SET, 's1');
      await generatePDF(set1, EMPTY_SET, 's1');

      expect(acquireMock).toHaveBeenCalledTimes(2);
    });

    it('releases the guard after a rejected export', async () => {
      toBlobMock.mockRejectedValueOnce(new Error('compose failed'));
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { generatePDF } = await loadModule();
      const set1 = makeSet('Set 1', 1);

      await expect(generatePDF(set1, EMPTY_SET, 's1')).rejects.toThrow('compose failed');
      await expect(generatePDF(set1, EMPTY_SET, 's1')).resolves.toBeUndefined();

      expect(acquireMock).toHaveBeenCalledTimes(2);
      error.mockRestore();
    });
  });

  describe('compatibility', () => {
    it('accepts the original nine-argument call', async () => {
      const { generatePDF } = await loadModule();

      await expect(
        generatePDF(makeSet('Set 1', 2), EMPTY_SET, 's1', 4 / 3, 'Cup', 'portrait', undefined, 'turningpoint', 'comp-1'),
      ).resolves.toBeUndefined();
    });

    it('renders every cell of both pages with the resize cache bypassed', async () => {
      const { generatePDF } = await loadModule();

      await generatePDF(makeSet('Set 1', 2), makeSet('Set 2', 2, 'q'), 's1');

      expect(renderMock).toHaveBeenCalledTimes(4);
      // 16th positional arg = `skipResizeCache`. Per-call rather than a
      // process-wide suspend, so an editor redraw during the export (the yields
      // between photos keep the UI live) still populates the cache.
      for (const call of renderMock.mock.calls) {
        expect(call[15]).toBe(true);
      }
    });

    it('renders every cell even with User Timing unavailable', async () => {
      const originalMark = performance.mark;
      // @ts-expect-error deliberately removing an API the instrumentation guards for
      delete performance.mark;
      try {
        const { generatePDF } = await loadModule();

        await generatePDF(makeSet('Set 1', 3), EMPTY_SET, 's1');

        expect(photoSrcs()).toHaveLength(3);
        expect(pdfMock).toHaveBeenCalledTimes(1);
      } finally {
        performance.mark = originalMark;
      }
    });
  });
});
