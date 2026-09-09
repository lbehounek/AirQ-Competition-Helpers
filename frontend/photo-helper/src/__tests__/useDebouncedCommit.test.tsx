import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedCommit, COMMIT_DEBOUNCE_MS } from '../hooks/useDebouncedCommit';

// The single commit channel behind the photo editor. Three properties matter
// and all three are easy to regress: deltas MERGE (so a commit never carries a
// field the user didn't touch), `commitNow` FOLDS IN what is pending instead
// of dropping it, and every teardown path (photo change, unmount, pagehide,
// visibility-hidden) flushes through the commitFn captured at SCHEDULE time —
// not the one belonging to whatever photo is on screen by then.

type Delta = { brightness?: number; contrast?: number; labelPosition?: string };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Advance past the debounce window inside `act` so React flushes any state. */
function tick(ms = COMMIT_DEBOUNCE_MS) {
  act(() => { vi.advanceTimersByTime(ms); });
}

describe('useDebouncedCommit', () => {
  it('fires once, after the delay, with the LAST value of a burst', () => {
    const commitFn = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<Delta>(commitFn, 'photo-1'));

    act(() => {
      result.current.schedule({ brightness: 1 });
      result.current.schedule({ brightness: 2 });
    });
    expect(commitFn).not.toHaveBeenCalled();

    tick();
    expect(commitFn).toHaveBeenCalledTimes(1);
    expect(commitFn).toHaveBeenCalledWith({ brightness: 2 });
  });

  it('merges deltas that touch different fields into one commit', () => {
    const commitFn = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<Delta>(commitFn, 'photo-1'));

    act(() => {
      result.current.schedule({ brightness: 1 });
      result.current.schedule({ contrast: 1.2 });
    });
    tick();

    expect(commitFn).toHaveBeenCalledTimes(1);
    expect(commitFn).toHaveBeenCalledWith({ brightness: 1, contrast: 1.2 });
  });

  it('commitNow folds the pending delta in and cancels the timer', () => {
    const commitFn = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<Delta>(commitFn, 'photo-1'));

    act(() => {
      result.current.schedule({ brightness: 5 });
      result.current.commitNow({ labelPosition: 'top-left' });
    });

    expect(commitFn).toHaveBeenCalledTimes(1);
    expect(commitFn).toHaveBeenCalledWith({ brightness: 5, labelPosition: 'top-left' });

    // Nothing left to fire later.
    tick();
    expect(commitFn).toHaveBeenCalledTimes(1);
  });

  it('commitNow wins on a field that is also pending', () => {
    const commitFn = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<Delta>(commitFn, 'photo-1'));

    act(() => {
      result.current.schedule({ brightness: 5 });
      result.current.commitNow({ brightness: 0 });
    });

    expect(commitFn).toHaveBeenCalledWith({ brightness: 0 });
  });

  it('flush() commits immediately and clears the pending payload', () => {
    const commitFn = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<Delta>(commitFn, 'photo-1'));

    act(() => {
      result.current.schedule({ brightness: 3 });
      result.current.flush();
    });
    expect(commitFn).toHaveBeenCalledTimes(1);
    expect(commitFn).toHaveBeenCalledWith({ brightness: 3 });

    act(() => { result.current.flush(); });
    tick();
    expect(commitFn).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is nothing pending', () => {
    const commitFn = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<Delta>(commitFn, 'photo-1'));

    act(() => { result.current.flush(); });
    tick();
    expect(commitFn).not.toHaveBeenCalled();
  });

  it('a resetKey change flushes through the OLD commitFn, not the new one', () => {
    const oldFn = vi.fn();
    const newFn = vi.fn();
    const { result, rerender } = renderHook(
      ({ fn, key }: { fn: (v: Delta) => void; key: string }) => useDebouncedCommit<Delta>(fn, key),
      { initialProps: { fn: oldFn as (v: Delta) => void, key: 'photo-1' } },
    );

    act(() => { result.current.schedule({ brightness: 7 }); });
    act(() => { rerender({ fn: newFn as (v: Delta) => void, key: 'photo-2' }); });

    // The edit belonged to photo-1, so it must be persisted against photo-1.
    expect(oldFn).toHaveBeenCalledTimes(1);
    expect(oldFn).toHaveBeenCalledWith({ brightness: 7 });
    expect(newFn).not.toHaveBeenCalled();

    tick();
    expect(oldFn).toHaveBeenCalledTimes(1);
    expect(newFn).not.toHaveBeenCalled();
  });

  it('unmounting with a pending delta commits it exactly once', () => {
    const commitFn = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedCommit<Delta>(commitFn, 'photo-1'));

    act(() => { result.current.schedule({ brightness: 9 }); });
    act(() => { unmount(); });

    expect(commitFn).toHaveBeenCalledTimes(1);
    expect(commitFn).toHaveBeenCalledWith({ brightness: 9 });

    tick();
    expect(commitFn).toHaveBeenCalledTimes(1);
  });

  it('pagehide flushes the pending delta', () => {
    const commitFn = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<Delta>(commitFn, 'photo-1'));

    act(() => { result.current.schedule({ brightness: 4 }); });
    act(() => { window.dispatchEvent(new Event('pagehide')); });

    expect(commitFn).toHaveBeenCalledTimes(1);
    expect(commitFn).toHaveBeenCalledWith({ brightness: 4 });
  });

  it('visibilitychange flushes only when the document is hidden', () => {
    const commitFn = vi.fn();
    const { result } = renderHook(() => useDebouncedCommit<Delta>(commitFn, 'photo-1'));

    // jsdom's visibilityState is read-only, hence the redefinition.
    const setVisibility = (value: 'visible' | 'hidden') =>
      Object.defineProperty(document, 'visibilityState', { value, configurable: true });

    act(() => { result.current.schedule({ brightness: 2 }); });
    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(commitFn).not.toHaveBeenCalled();

    setVisibility('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(commitFn).toHaveBeenCalledTimes(1);
    expect(commitFn).toHaveBeenCalledWith({ brightness: 2 });

    setVisibility('visible');
  });
});
