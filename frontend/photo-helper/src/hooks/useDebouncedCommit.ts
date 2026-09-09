import { useCallback, useEffect, useRef } from 'react';

/**
 * Trailing-debounce window for editor commits, in milliseconds.
 *
 * Long enough that a slider drag or a canvas pan collapses into ONE persisted
 * write, short enough that the grid behind the modal catches up before the
 * user can perceive it as lag (the modal's own preview is instant).
 */
export const COMMIT_DEBOUNCE_MS = 150;

export interface DebouncedCommit<T extends object> {
  /**
   * Trailing-debounced commit. Successive deltas MERGE into one pending
   * payload (`{ ...pending, ...delta }`), so the commit never carries a field
   * the user did not touch — it therefore cannot overwrite a sibling writer's
   * field. The `commitFn` in force at schedule time is captured alongside the
   * payload, so a flush caused by navigating away still targets the photo the
   * edit was actually made on.
   */
  schedule: (delta: T) => void;
  /**
   * Cancel the timer and commit `{ ...pending, ...delta }` NOW — used by the
   * discrete actions (reset, label corner, circle colour/remove, auto white
   * balance). The pending delta is FOLDED IN rather than dropped, so a slider
   * value the user set 50 ms ago is not lost; `delta` wins on conflicts.
   */
  commitNow: (delta: T) => void;
  /** Fire the pending commit now, if any. No-op when nothing is pending. */
  flush: () => void;
}

/**
 * One trailing-debounced, merge-on-schedule commit channel.
 *
 * Returns `{ schedule, commitNow, flush }` — all three stable across renders
 * (they read a ref), so they are safe in dependency arrays.
 *
 * `resetKey` identifies what the pending payload belongs to (the photo id, in
 * the editor modal): when it changes, the effect cleanup flushes the payload
 * scheduled for the PREVIOUS key before anything is scheduled for the new one.
 * The same cleanup runs on unmount, so closing the modal mid-drag still
 * persists the last value. `pagehide` and visibility-hidden are registered as
 * additional flush points — a tab closed or backgrounded during a drag is the
 * realistic way to lose an edit.
 *
 * NON-GOAL, deliberately: nested objects (`whiteBalance`, `circle`) are
 * committed as whole sub-objects, captured at schedule time. A change to a
 * SIBLING field of the same sub-object landing inside the debounce window
 * would be overwritten by the pending delta. Accepted: it needs two different
 * inputs touched within 150 ms, and building the sub-object lazily is not an
 * option — a flush after the photo changed must not read the NEW photo's
 * siblings.
 */
export function useDebouncedCommit<T extends object>(
  commitFn: (value: T) => void,
  resetKey: string,
  delayMs: number = COMMIT_DEBOUNCE_MS,
): DebouncedCommit<T> {
  // `window.setTimeout` (not the Node overload) so the handle is a `number`
  // without a NodeJS.Timeout cast — same reasoning as PhotoEditorApi's timers.
  const pendingRef = useRef<{ fn: (value: T) => void; value: T; timer: number } | null>(null);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    // Null the ref BEFORE invoking: `fn` re-renders, and a re-entrant
    // schedule/flush must not see the payload we are already committing.
    pendingRef.current = null;
    window.clearTimeout(pending.timer);
    pending.fn(pending.value);
  }, []);

  const schedule = useCallback((delta: T) => {
    const pending = pendingRef.current;
    if (pending) window.clearTimeout(pending.timer);
    const value = { ...(pending?.value ?? ({} as T)), ...delta };
    pendingRef.current = {
      // Latest commitFn wins: it closes over the photo currently on screen.
      fn: commitFn,
      value,
      timer: window.setTimeout(() => flush(), delayMs),
    };
  }, [commitFn, delayMs, flush]);

  const commitNow = useCallback((delta: T) => {
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      window.clearTimeout(pending.timer);
    }
    // `delta` last: an immediate action overrides a pending field it also sets.
    commitFn({ ...(pending?.value ?? ({} as T)), ...delta });
  }, [commitFn]);

  // Flush what was scheduled for the PREVIOUS resetKey (and on unmount). The
  // cleanup closes over the `flush` of the render that registered it, which
  // reads the ref — so it commits through the `fn` captured with the payload,
  // not through whatever the new key's commitFn would be.
  useEffect(() => flush, [resetKey, flush]);

  // Last-chance flush points. `pagehide` covers tab close / navigation;
  // visibility-hidden fires earlier and more reliably on mobile, where
  // `pagehide` can be skipped entirely.
  useEffect(() => {
    const onHide = () => flush();
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flush]);

  return { schedule, commitNow, flush };
}
