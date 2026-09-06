import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode, useEffect, useState } from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { useElementWidth, ELEMENT_WIDTH_DEBOUNCE_MS } from '../hooks/useElementWidth';

/**
 * ResizeObserver double that fires ONLY for elements actually passed to
 * `observe()`.
 *
 * This is deliberate and load-bearing: the bug this hook exists to fix is that
 * the observed node (PhotoEditorApi's canvas wrapper) only appears in the last
 * render branch, so a `useRef` read in a mount effect never attached. An
 * unconditional stub that fired for any element would have reported a width
 * anyway and hidden exactly that failure.
 */
class RecordingResizeObserver {
  static instances: RecordingResizeObserver[] = [];
  /** Every element currently observed by ANY live instance. */
  static observing = new Map<Element, RecordingResizeObserver[]>();

  observed: Element[] = [];
  disconnected = false;
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    // Explicit assignment rather than a parameter property: this package
    // compiles with `erasableSyntaxOnly`, which forbids TS-only constructor
    // sugar.
    this.callback = callback;
    RecordingResizeObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
    const list = RecordingResizeObserver.observing.get(el) ?? [];
    list.push(this);
    RecordingResizeObserver.observing.set(el, list);
  }

  unobserve(el: Element) {
    const list = (RecordingResizeObserver.observing.get(el) ?? []).filter(o => o !== this);
    RecordingResizeObserver.observing.set(el, list);
  }

  disconnect() {
    this.disconnected = true;
    for (const el of this.observed) this.unobserve(el);
  }

  /** Deliver a contentRect report to every LIVE observer of `el`. */
  static trigger(el: Element, width: number) {
    const observers = (RecordingResizeObserver.observing.get(el) ?? []).filter(o => !o.disconnected);
    for (const observer of observers) {
      observer.callback(
        [{ target: el, contentRect: { width } } as unknown as ResizeObserverEntry],
        observer as unknown as ResizeObserver,
      );
    }
    return observers.length;
  }

  static reset() {
    RecordingResizeObserver.instances = [];
    RecordingResizeObserver.observing = new Map();
  }

  static get liveObservationCount() {
    let count = 0;
    for (const observers of RecordingResizeObserver.observing.values()) {
      count += observers.filter(o => !o.disconnected).length;
    }
    return count;
  }
}

/** Harness mirroring the real caller: callback ref → state → hook. */
function Harness({ enabled = true, show = true }: { enabled?: boolean; show?: boolean }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const width = useElementWidth(el, enabled);
  // Recorded from an effect, not the render body: the react-compiler lint rules
  // (correctly) reject mutating module state during render.
  useEffect(() => {
    // Every DISTINCT value the hook has published, in order.
    if (widthsSeen.length === 0 || widthsSeen[widthsSeen.length - 1] !== width) widthsSeen.push(width);
  });
  return show ? <div data-testid="target" ref={setEl} data-w={String(width)} /> : <span data-testid="gone" />;
}

let widthsSeen: Array<number | null> = [];

beforeEach(() => {
  widthsSeen = [];
  RecordingResizeObserver.reset();
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useElementWidth', () => {
  it('is null before any report', () => {
    const { getByTestId } = render(<Harness />);
    expect(getByTestId('target')).toHaveAttribute('data-w', 'null');
  });

  it('applies the FIRST report immediately, without waiting for the debounce', () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<Harness />);
    const target = getByTestId('target');

    act(() => { RecordingResizeObserver.trigger(target, 380.4); });

    // Rounded, and applied with no timer advance — the first draw must not wait.
    expect(target).toHaveAttribute('data-w', '380');
  });

  it('trailing-debounces every LATER report', () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<Harness />);
    const target = getByTestId('target');

    act(() => { RecordingResizeObserver.trigger(target, 380); });
    act(() => { RecordingResizeObserver.trigger(target, 385); });
    expect(target).toHaveAttribute('data-w', '380');

    act(() => { vi.advanceTimersByTime(ELEMENT_WIDTH_DEBOUNCE_MS); });
    expect(target).toHaveAttribute('data-w', '385');
  });

  it('never publishes a new value when the same width is reported twice', () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<Harness />);
    const target = getByTestId('target');

    act(() => { RecordingResizeObserver.trigger(target, 400); });
    act(() => { RecordingResizeObserver.trigger(target, 400); });
    act(() => { vi.advanceTimersByTime(ELEMENT_WIDTH_DEBOUNCE_MS); });

    // Only two distinct values ever reached a render: the initial null and 400.
    // That is the property the redraw path depends on — `canvasSize` is memoized
    // on this number, so an unchanged width cannot invalidate it. (React may
    // still run ONE extra render before bailing out of an identical setState, so
    // a render COUNT assertion here would be asserting React's internals.)
    expect(widthsSeen).toEqual([null, 400]);
    expect(target).toHaveAttribute('data-w', '400');
  });

  it('disconnects on unmount', () => {
    const { unmount } = render(<Harness />);
    expect(RecordingResizeObserver.liveObservationCount).toBe(1);

    unmount();
    expect(RecordingResizeObserver.liveObservationCount).toBe(0);
  });

  it('never observes when disabled', () => {
    const { getByTestId } = render(<Harness enabled={false} />);

    expect(RecordingResizeObserver.instances).toHaveLength(0);
    expect(getByTestId('target')).toHaveAttribute('data-w', 'null');
  });

  it('attaches when the element appears LATER and detaches when it goes away', () => {
    // The blocker this hook was written for: the observed node is created in a
    // late render branch, so "observe on mount" would never have run.
    const { rerender, getByTestId, queryByTestId } = render(<Harness show={false} />);
    expect(queryByTestId('target')).toBeNull();
    expect(RecordingResizeObserver.liveObservationCount).toBe(0);

    rerender(<Harness show />);
    const target = getByTestId('target');
    expect(RecordingResizeObserver.liveObservationCount).toBe(1);
    expect(RecordingResizeObserver.instances.at(-1)?.observed).toContain(target);

    rerender(<Harness show={false} />);
    expect(RecordingResizeObserver.liveObservationCount).toBe(0);
  });

  it('leaves exactly one live observation under StrictMode double-mounting', () => {
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );

    // StrictMode runs effect → cleanup → effect in dev; the observer must not
    // accumulate, or every editor would hold two.
    expect(RecordingResizeObserver.liveObservationCount).toBe(1);
  });

  it('returns null and does not throw where ResizeObserver is missing (jsdom default)', () => {
    vi.unstubAllGlobals();
    // @ts-expect-error — deliberately removing the global for this case.
    delete globalThis.ResizeObserver;

    const { getByTestId } = render(<Harness />);
    expect(getByTestId('target')).toHaveAttribute('data-w', 'null');
  });
});
