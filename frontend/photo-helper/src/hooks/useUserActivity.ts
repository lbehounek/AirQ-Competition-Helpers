import { useSyncExternalStore } from 'react';

/**
 * ONE shared "is the user idle?" store for the whole app.
 *
 * WHY: every mounted PhotoEditorApi used to own a `pointermove` + `keydown`
 * window listener and its own 3 s timer, and every idle flip put a new value
 * in `renderCanvas`'s dependency list — so simply moving the mouse and pausing
 * redrew every mounted canvas twice, with no editing at all. With ~20 editors
 * that is 20 listeners, 20 timers and 40 full canvas redraws per move/pause
 * cycle. Only the modal editor ever uses the high-quality path, so grid
 * editors now pass `enabled = false` and never subscribe at all.
 */

/** Idle threshold; matches the per-editor timer this store replaces. */
export const USER_IDLE_DELAY_MS = 3000;

/** Pointer-move throttle; matches the per-editor `throttleMs` (moves only). */
export const USER_ACTIVITY_THROTTLE_MS = 250;

const listeners = new Set<() => void>();
let idle = false;
// `number` + `window.setTimeout` because @types/node is in this program and
// its global `setTimeout` returns `NodeJS.Timeout`.
let timer: number | null = null;
let lastMoveMark = 0;
let subscriberCount = 0;
let detachWindow: (() => void) | null = null;

function emit(): void {
  listeners.forEach(listener => listener());
}

function restartTimer(): void {
  if (typeof window === 'undefined') return;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    idle = true;
    emit();
  }, USER_IDLE_DELAY_MS);
}

/**
 * Record user activity: leaves idle immediately (notifying subscribers) and
 * restarts the countdown. Exported for tests and for any future caller whose
 * interaction does not surface as one of the window events below.
 */
export function markUserActivity(): void {
  if (idle) {
    idle = false;
    emit();
  }
  restartTimer();
}

/**
 * Attach the window listeners and start the countdown. Called only for the
 * FIRST subscriber; `detach` (below) tears it down after the last one leaves,
 * which makes StrictMode's mount/unmount/mount cycle idempotent.
 */
function attachWindow(): void {
  if (typeof window === 'undefined') return;

  const onPointerMove = () => {
    // Throttled because a move fires per frame; the un-throttled events below
    // are all discrete. Throttling is now global rather than per editor — same
    // observable result, one timer instead of N.
    const now = Date.now();
    if (now - lastMoveMark < USER_ACTIVITY_THROTTLE_MS) return;
    lastMoveMark = now;
    markUserActivity();
  };
  // pointerdown/pointerup/wheel replace the editor's explicit markInteraction()
  // calls in handleMouseDown, handleDocumentMouseMove, handleDocumentMouseUp and
  // handleWheel. The editor's `event.nativeEvent.stopPropagation()` on mousedown
  // runs AFTER the native pointerdown has already reached window listeners, so
  // activity is still marked. If a future Dialog ever stops native propagation,
  // add `{ capture: true }` here.
  const onDiscrete = () => markUserActivity();

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onDiscrete, { passive: true });
  window.addEventListener('pointerup', onDiscrete, { passive: true });
  window.addEventListener('keydown', onDiscrete, { passive: true });
  window.addEventListener('wheel', onDiscrete, { passive: true });

  detachWindow = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onDiscrete);
    window.removeEventListener('pointerup', onDiscrete);
    window.removeEventListener('keydown', onDiscrete);
    window.removeEventListener('wheel', onDiscrete);
  };

  // The countdown starts when the first subscriber mounts — equivalent to the
  // old per-editor "start the idle timer on mount" for the single modal editor
  // that actually consumes it.
  restartTimer();
}

/** Tear everything down and return to the not-idle default. */
function detach(): void {
  detachWindow?.();
  detachWindow = null;
  if (timer !== null && typeof window !== 'undefined') window.clearTimeout(timer);
  timer = null;
  lastMoveMark = 0;
  idle = false;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  subscriberCount += 1;
  if (subscriberCount === 1) attachWindow();
  return () => {
    listeners.delete(onStoreChange);
    subscriberCount -= 1;
    if (subscriberCount === 0) detach();
  };
}

/** Subscription used by disabled callers: never attaches, never notifies. */
function noopSubscribe(): () => void {
  return () => {};
}

const getIdleSnapshot = () => idle;
const getInactiveSnapshot = () => false;

/**
 * @param enabled pass `false` (grid editors, anything that never uses the
 * high-quality path) to opt out entirely — a disabled caller registers no
 * listener and never re-renders on an idle flip.
 * @returns `true` once `USER_IDLE_DELAY_MS` has passed with no user input;
 * always `false` while disabled.
 */
export function useIsUserIdle(enabled = true): boolean {
  return useSyncExternalStore(
    enabled ? subscribe : noopSubscribe,
    enabled ? getIdleSnapshot : getInactiveSnapshot,
    getInactiveSnapshot,
  );
}

/**
 * Reset all module state. Test-only — module state survives between vitest
 * test cases in the same file, so a leaked subscriber would make the next
 * case's listener assertions wrong.
 */
export function __resetUserActivityForTests(): void {
  detach();
  listeners.clear();
  subscriberCount = 0;
}
