import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { AspectRatioProvider } from '../contexts/AspectRatioContext';
import { PhotoEditorApi } from '../components/PhotoEditorApi';
import { __resetUserActivityForTests, USER_IDLE_DELAY_MS } from '../hooks/useUserActivity';
import { makeCanvasState } from './support/testHelpers';
import type { ApiPhoto } from '../types/api';

// This is the file that pins the WP's actual claim: a canvas redraws when THIS
// photo changed, and at no other time. Everything below counts `drawImage`
// calls on the fake 2D context belonging to the visible `canvas[data-photo-id]`
// — `renderCanvas` composes into an off-screen buffer and blits it onto the
// visible canvas exactly once per completed render, so that count IS the redraw
// count.

/** Per-canvas fake 2D contexts, so each canvas can be counted independently. */
const contexts = new WeakMap<object, FakeCtx>();

interface FakeCtx {
  drawImage: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  /** Ordered log of paints/blanks, so interleaving between two in-flight renders is observable. */
  ops: Array<'draw' | 'clear' | 'put'>;
}

function fakeCtxFor(canvas: object): FakeCtx {
  let ctx = contexts.get(canvas);
  if (!ctx) {
    const ops: FakeCtx['ops'] = [];
    ctx = {
      drawImage: vi.fn(() => { ops.push('draw'); }),
      clearRect: vi.fn(() => { ops.push('clear'); }),
      // Tiny buffer: the CPU effect loops iterate over `data.length`, so one
      // pixel is enough to exercise the branch without a 600×450 allocation.
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
      putImageData: vi.fn(() => { ops.push('put'); }),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      ops,
    };
    contexts.set(canvas, ctx);
  }
  return ctx;
}

// Mocking canvasUtils rather than spying on `getContext` keeps the whole 2D
// surface out of the test: `getCanvasContext` is the single door every draw in
// this component goes through, and `drawLabel` needs a real font/measureText.
vi.mock('../utils/canvasUtils', () => ({
  getCanvasContext: (canvas: object | null) => (canvas ? fakeCtxFor(canvas) : null),
  drawLabel: vi.fn(),
}));

// The pool is "exhausted" so every draw takes the deterministic CPU path.
vi.mock('../utils/webglContextManager', () => ({
  getWebGLContextManager: () => ({
    requestContext: () => null,
    releaseContext: vi.fn(),
    getAvailableContextCount: () => 0,
  }),
}));

const intelligentResize = vi.fn(async () => document.createElement('canvas'));
vi.mock('../utils/highQualityResize', () => ({
  intelligentResize: (...args: unknown[]) => intelligentResize(...(args as [])),
}));

// The editor's image source. Overridable per case so the "image arrives late"
// branch (the reason useElementWidth takes an element, not a ref) is reachable.
let cachedImage: { image: unknown; loading: boolean; error: Error | null } = {
  image: { width: 800, height: 600 },
  loading: false,
  error: null,
};
// A spy, not a plain arrow: its call count IS the render count of
// `PhotoEditorApiImpl` (one call per render), which is what pins React.memo.
const useCachedImageSpy = vi.fn(() => cachedImage);
vi.mock('../utils/imageCache', () => ({
  useCachedImage: () => useCachedImageSpy(),
  getImageCache: () => ({ preloadImages: vi.fn(async () => {}) }),
}));

/** ResizeObserver double: reports only for elements passed to `observe()`. */
class TestResizeObserver {
  static observed: Element[] = [];
  static disconnects = 0;
  static callbacks = new Map<Element, ResizeObserverCallback>();
  cb: ResizeObserverCallback;
  // Explicit assignment: `erasableSyntaxOnly` forbids parameter properties.
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    TestResizeObserver.observed.push(el);
    TestResizeObserver.callbacks.set(el, this.cb);
  }
  unobserve() {}
  disconnect() { TestResizeObserver.disconnects += 1; }
  static trigger(el: Element, width: number) {
    const cb = TestResizeObserver.callbacks.get(el);
    cb?.([{ target: el, contentRect: { width } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
  }
  static reset() {
    TestResizeObserver.observed = [];
    TestResizeObserver.disconnects = 0;
    TestResizeObserver.callbacks = new Map();
  }
}

function makePhoto(id: string, overrides: Partial<ApiPhoto['canvasState']> = {}): ApiPhoto {
  return {
    id,
    sessionId: 'sess-1',
    url: `blob:${id}`,
    filename: `${id}.jpg`,
    canvasState: makeCanvasState(overrides),
    label: '',
  };
}

/** The visible canvas for a photo id, and the draw counter attached to it. */
function drawCount(container: HTMLElement, photoId: string): number {
  const canvas = container.querySelector<HTMLCanvasElement>(`canvas[data-photo-id="${photoId}"]`);
  if (!canvas) return 0;
  return fakeCtxFor(canvas).drawImage.mock.calls.length;
}

function canvasFor(container: HTMLElement, photoId: string): HTMLCanvasElement {
  const canvas = container.querySelector<HTMLCanvasElement>(`canvas[data-photo-id="${photoId}"]`);
  if (!canvas) throw new Error(`No canvas for ${photoId}`);
  return canvas;
}

/** Render with the real AspectRatioProvider and flush the async render. */
async function renderEditor(ui: React.ReactElement) {
  const result = render(<AspectRatioProvider>{ui}</AspectRatioProvider>);
  await act(async () => {});
  return result;
}

beforeEach(() => {
  cachedImage = { image: { width: 800, height: 600 }, loading: false, error: null };
  intelligentResize.mockClear();
  useCachedImageSpy.mockClear();
  TestResizeObserver.reset();
  __resetUserActivityForTests();
});

afterEach(() => {
  cleanup();
  __resetUserActivityForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('PhotoEditorApi redraw behaviour', () => {
  it('draws exactly once on mount and emits its identifying attributes', async () => {
    const photo = makePhoto('a');
    const { container } = await renderEditor(
      <PhotoEditorApi photo={photo} label="A" onUpdate={vi.fn()} size="large" setKey="set1" mode="track" />,
    );

    expect(drawCount(container, 'a')).toBe(1);
    const canvas = canvasFor(container, 'a');
    expect(canvas).toHaveAttribute('data-set-key', 'set1');
    expect(canvas).toHaveAttribute('data-label', 'A');
  });

  it('does not redraw when the parent re-renders with identical props', async () => {
    const photo = makePhoto('a');
    const onUpdate = vi.fn();

    function Wrapper() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" data-testid="force" onClick={() => setTick(t => t + 1)}>{tick}</button>
          <PhotoEditorApi photo={photo} label="A" onUpdate={onUpdate} size="large" />
        </>
      );
    }

    const { container, getByTestId } = await renderEditor(<Wrapper />);
    expect(drawCount(container, 'a')).toBe(1);

    await act(async () => { fireEvent.click(getByTestId('force')); });
    await act(async () => { fireEvent.click(getByTestId('force')); });

    expect(drawCount(container, 'a')).toBe(1);
  });

  it('redraws when its own canvasState changes', async () => {
    const photo = makePhoto('a');
    const { container, rerender } = await renderEditor(
      <PhotoEditorApi photo={photo} label="A" onUpdate={vi.fn()} size="large" />,
    );
    expect(drawCount(container, 'a')).toBe(1);

    const edited = { ...photo, canvasState: { ...photo.canvasState, brightness: 10 } };
    await act(async () => {
      rerender(
        <AspectRatioProvider>
          <PhotoEditorApi photo={edited} label="A" onUpdate={vi.fn()} size="large" />
        </AspectRatioProvider>,
      );
    });

    expect(drawCount(container, 'a')).toBe(2);
  });

  it('editing photo A leaves photo B untouched', async () => {
    const a = makePhoto('a');
    const b = makePhoto('b');
    const onUpdate = vi.fn();

    const view = (photoA: ApiPhoto) => (
      <AspectRatioProvider>
        <PhotoEditorApi photo={photoA} label="A" onUpdate={onUpdate} size="large" />
        <PhotoEditorApi photo={b} label="B" onUpdate={onUpdate} size="large" />
      </AspectRatioProvider>
    );

    const { container, rerender } = render(view(a));
    await act(async () => {});
    expect(drawCount(container, 'a')).toBe(1);
    expect(drawCount(container, 'b')).toBe(1);

    await act(async () => {
      rerender(view({ ...a, canvasState: { ...a.canvasState, brightness: 20 } }));
    });

    expect(drawCount(container, 'a')).toBe(2);
    // The whole point of the memo: B's props are untouched, so B never re-rendered.
    expect(drawCount(container, 'b')).toBe(1);
  });

  it('grid editors ignore idle flips entirely; the modal editor uses them for the HQ pass', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const grid = makePhoto('g');
    const large = makePhoto('l');
    const { container } = render(
      <AspectRatioProvider>
        <PhotoEditorApi photo={grid} label="G" onUpdate={vi.fn()} size="grid" />
        <PhotoEditorApi photo={large} label="L" onUpdate={vi.fn()} size="large" />
      </AspectRatioProvider>,
    );
    await act(async () => {});

    expect(drawCount(container, 'g')).toBe(1);
    expect(drawCount(container, 'l')).toBe(1);
    expect(intelligentResize).not.toHaveBeenCalled();

    // Go idle: only the modal editor is subscribed, so only it redraws — this
    // used to be 2×N redraws across every mounted canvas.
    await act(async () => { vi.advanceTimersByTime(USER_IDLE_DELAY_MS); });
    expect(drawCount(container, 'g')).toBe(1);
    expect(drawCount(container, 'l')).toBe(2);
    expect(intelligentResize).toHaveBeenCalledTimes(1);

    // Moving again drops back to the fast path — again, modal only.
    await act(async () => { fireEvent.pointerMove(window); });
    expect(drawCount(container, 'g')).toBe(1);
    expect(drawCount(container, 'l')).toBe(3);
  });

  it('sizes the modal canvas at exactly 600 regardless of DPR', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true, writable: true });
    const photo = makePhoto('a');
    const { container } = await renderEditor(
      <PhotoEditorApi photo={photo} label="A" onUpdate={vi.fn()} size="large" />,
    );

    const canvas = canvasFor(container, 'a');
    // Backing size must equal the CSS size — the drag/wheel math depends on it.
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(450); // default 4:3
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true, writable: true });
  });

  it('a grid canvas waits for its measured width, then sizes to cssWidth × DPR', async () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    Object.defineProperty(window, 'devicePixelRatio', { value: 1.25, configurable: true, writable: true });

    const photo = makePhoto('a');
    const { container } = await renderEditor(
      <PhotoEditorApi photo={photo} label="A" onUpdate={vi.fn()} size="grid" />,
    );

    // Nothing drawn yet: drawing at the 300 fallback and then again at the real
    // width would be double work on every remount.
    expect(drawCount(container, 'a')).toBe(0);

    const wrapper = TestResizeObserver.observed[0];
    expect(wrapper).toBeDefined();
    await act(async () => { TestResizeObserver.trigger(wrapper, 380); });

    expect(drawCount(container, 'a')).toBe(1);
    expect(canvasFor(container, 'a').width).toBe(500); // ceil(380 × 1.25 / 100) × 100

    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true, writable: true });
  });

  it('a grid canvas draws immediately at the minimum where ResizeObserver is missing', async () => {
    // jsdom's default — no observer will ever report, so gating on a measurement
    // would leave every grid canvas blank.
    expect(typeof ResizeObserver).toBe('undefined');

    const photo = makePhoto('a');
    const { container } = await renderEditor(
      <PhotoEditorApi photo={photo} label="A" onUpdate={vi.fn()} size="grid" />,
    );

    expect(drawCount(container, 'a')).toBe(1);
    expect(canvasFor(container, 'a').width).toBe(300);
  });

  it('observes the wrapper only once the image has loaded, and disconnects when it goes away', async () => {
    // The blocker the callback ref exists for: the wrapper Box is the LAST of
    // four render branches, so a mount-time ref read would never see it.
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    cachedImage = { image: null, loading: true, error: null };

    const photo = makePhoto('a');
    const { rerender } = await renderEditor(
      <PhotoEditorApi photo={photo} label="A" onUpdate={vi.fn()} size="grid" />,
    );
    expect(TestResizeObserver.observed).toHaveLength(0);

    cachedImage = { image: { width: 800, height: 600 }, loading: false, error: null };
    await act(async () => {
      rerender(
        <AspectRatioProvider>
          <PhotoEditorApi photo={{ ...photo }} label="A" onUpdate={vi.fn()} size="grid" />
        </AspectRatioProvider>,
      );
    });
    expect(TestResizeObserver.observed).toHaveLength(1);
    expect(TestResizeObserver.observed[0].tagName).toBe('DIV');

    // Image errors out (the url→'' path on a mode switch) → wrapper unmounts.
    cachedImage = { image: null, loading: false, error: new Error('gone') };
    await act(async () => {
      rerender(
        <AspectRatioProvider>
          <PhotoEditorApi photo={{ ...photo }} label="A" onUpdate={vi.fn()} size="grid" />
        </AspectRatioProvider>,
      );
    });
    expect(TestResizeObserver.disconnects).toBeGreaterThanOrEqual(1);
  });

  it('a superseded slow render never blits over the newer one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    // Two deferred pica passes: A (older) resolves AFTER B (newer).
    const deferreds: Array<(canvas: HTMLCanvasElement) => void> = [];
    intelligentResize.mockImplementation(
      () => new Promise<HTMLCanvasElement>(resolve => { deferreds.push(resolve); }),
    );

    const photo = makePhoto('a', { brightness: 1 });
    const { container, rerender } = render(
      <AspectRatioProvider>
        <PhotoEditorApi photo={photo} label="A" onUpdate={vi.fn()} size="large" />
      </AspectRatioProvider>,
    );
    await act(async () => {});
    const beforeIdle = drawCount(container, 'a');

    // Go idle so the HQ (awaiting) path is taken from here on.
    await act(async () => { vi.advanceTimersByTime(USER_IDLE_DELAY_MS); });
    expect(deferreds).toHaveLength(1); // render A is in flight

    // Render B starts while A is still awaiting pica.
    await act(async () => {
      rerender(
        <AspectRatioProvider>
          <PhotoEditorApi
            photo={{ ...photo, canvasState: { ...photo.canvasState, brightness: 2 } }}
            label="A"
            onUpdate={vi.fn()}
            size="large"
          />
        </AspectRatioProvider>,
      );
    });
    expect(deferreds).toHaveLength(2);

    // Resolve the NEWER one first, then the older one.
    await act(async () => {
      deferreds[1](document.createElement('canvas'));
      deferreds[0](document.createElement('canvas'));
    });

    // Exactly one additional blit: B's. A was dropped by the generation guard.
    expect(drawCount(container, 'a')).toBe(beforeIdle + 1);
  });

  it('a superseded slow render does not composite onto the shared scratch buffer', async () => {
    // Companion to the blit guard above. That guard protects the VISIBLE
    // canvas; the effect scratch buffer is shared by every render of this
    // editor and is written after the pica await, so two in-flight renders
    // can stack their frames in it. Opaque JPEGs mask the result, but PNGs
    // with alpha would carry the older render's effect pass through.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const createdCanvases: HTMLCanvasElement[] = [];
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation(
      ((tag: string, ...rest: unknown[]) => {
        const el = (Document.prototype.createElement as (this: Document, t: string, ...r: unknown[]) => HTMLElement)
          .call(document, tag, ...rest);
        if (tag === 'canvas') createdCanvases.push(el as HTMLCanvasElement);
        return el;
      }) as typeof document.createElement,
    );

    const deferreds: Array<(canvas: HTMLCanvasElement) => void> = [];
    intelligentResize.mockImplementation(
      () => new Promise<HTMLCanvasElement>(resolve => { deferreds.push(resolve); }),
    );

    const photo = makePhoto('a', { brightness: 1 });
    const { rerender } = render(
      <AspectRatioProvider>
        <PhotoEditorApi photo={photo} label="A" onUpdate={vi.fn()} size="large" />
      </AspectRatioProvider>,
    );
    await act(async () => {});

    // React created the VISIBLE canvas through the same factory, so filter to
    // the off-screen ones: the first render allocates exactly the two
    // long-lived buffers, in this order — the compose target, then the effect
    // scratch.
    const offscreen = createdCanvases.filter(c => !c.isConnected);
    expect(offscreen).toHaveLength(2);
    const scratch = offscreen[1];
    const scratchOps = fakeCtxFor(scratch).ops;

    // Go idle → HQ path; render A parks on pica.
    await act(async () => { vi.advanceTimersByTime(USER_IDLE_DELAY_MS); });
    expect(deferreds).toHaveLength(1);

    // Render B starts while A is still awaiting.
    await act(async () => {
      rerender(
        <AspectRatioProvider>
          <PhotoEditorApi
            photo={{ ...photo, canvasState: { ...photo.canvasState, brightness: 2 } }}
            label="A"
            onUpdate={vi.fn()}
            size="large"
          />
        </AspectRatioProvider>,
      );
    });
    expect(deferreds).toHaveLength(2);

    scratchOps.length = 0;
    // Newer first, then the older one — the interleaving that stacks frames.
    await act(async () => {
      deferreds[1](document.createElement('canvas'));
      deferreds[0](document.createElement('canvas'));
    });

    // Every paint into the shared buffer must start from a blank one.
    const paints = scratchOps.filter(op => op !== 'put');
    expect(paints.length).toBeGreaterThan(0);
    for (let i = 0; i < paints.length; i++) {
      expect(paints[i], `scratch op sequence ${paints.join(',')}`)
        .toBe(i % 2 === 0 ? 'clear' : 'draw');
    }

    createSpy.mockRestore();
  });

  it('is memoised: identical props do not re-render it, a fresh callback does', async () => {
    // The dependency list of `renderCanvas` is identity-stable across a parent
    // re-render, so the drawImage counter above cannot tell the memo apart from
    // its absence. Count RENDERS instead — one `useCachedImage` call each.
    const photo = makePhoto('a');
    const stableOnUpdate = vi.fn();

    function Wrapper({ freshCallback }: { freshCallback: boolean }) {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" data-testid="force" onClick={() => setTick(t => t + 1)}>{tick}</button>
          <PhotoEditorApi
            photo={photo}
            label="A"
            onUpdate={freshCallback ? () => {} : stableOnUpdate}
            size="large"
          />
        </>
      );
    }

    const { getByTestId } = await renderEditor(<Wrapper freshCallback={false} />);
    const afterMount = useCachedImageSpy.mock.calls.length;

    await act(async () => { fireEvent.click(getByTestId('force')); });
    await act(async () => { fireEvent.click(getByTestId('force')); });
    expect(useCachedImageSpy.mock.calls.length).toBe(afterMount);

    cleanup();
    useCachedImageSpy.mockClear();

    // The contract the grid relies on, stated as its own case: hand the editor
    // a NEW function identity per parent render and the memo stops helping.
    // (`useStableCallback` upstream is what keeps that from happening.)
    const { getByTestId: getByTestId2 } = await renderEditor(<Wrapper freshCallback />);
    const afterMount2 = useCachedImageSpy.mock.calls.length;
    await act(async () => { fireEvent.click(getByTestId2('force')); });
    expect(useCachedImageSpy.mock.calls.length).toBeGreaterThan(afterMount2);
  });

  it('reuses one scratch canvas instead of allocating a buffer per draw', async () => {
    const createSpy = vi.spyOn(document, 'createElement');

    const photo = makePhoto('a');
    const { container, rerender } = await renderEditor(
      <PhotoEditorApi photo={photo} label="A" onUpdate={vi.fn()} size="large" />,
    );
    const afterFirst = createSpy.mock.calls.filter(call => call[0] === 'canvas').length;

    await act(async () => {
      rerender(
        <AspectRatioProvider>
          <PhotoEditorApi
            photo={{ ...photo, canvasState: { ...photo.canvasState, brightness: 5 } }}
            label="A"
            onUpdate={vi.fn()}
            size="large"
          />
        </AspectRatioProvider>,
      );
    });

    const afterSecond = createSpy.mock.calls.filter(call => call[0] === 'canvas').length;
    // The second draw allocates nothing: both the compose buffer and the effect
    // scratch buffer are held in refs. (~1 MB per draw, per editor, saved.)
    expect(afterSecond).toBe(afterFirst);
    expect(drawCount(container, 'a')).toBe(2);

    createSpy.mockRestore();
  });
});
