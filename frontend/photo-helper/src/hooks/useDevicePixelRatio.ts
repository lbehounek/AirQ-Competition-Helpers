import { useSyncExternalStore } from 'react';

/**
 * Read the current display's device pixel ratio and re-render when it changes.
 *
 * WHY it has to be reactive: on Windows the Electron window gets dragged
 * between a 100% screen and a 125%/150% screen, and the renderer's
 * `devicePixelRatio` changes with it. If the grid canvases kept the DPR they
 * were mounted with, the anti-pixelation guarantee (backing store ≥ displayed
 * device pixels) would silently break on the second monitor.
 *
 * The only signal browsers expose for a DPR change is a `(resolution: Xdppx)`
 * media query that stops matching — hence the re-arm dance in `subscribe`.
 */

/** Current DPR, or 1 when unavailable/insane (SSR, jsdom, a bogus 0/NaN). */
function getSnapshot(): number {
  if (typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** Server/no-DOM snapshot; also used by the jsdom tests that delete matchMedia. */
function getServerSnapshot(): number {
  return 1;
}

/**
 * Subscribe to DPR changes. Returns the unsubscribe function.
 * No-ops (but still returns a valid unsubscribe) where `matchMedia` is missing
 * — jsdom has none, and AppApiSmoke's `vi.fn`-based stub is handled by the
 * `addEventListener` guard below.
 */
function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }

  let mql: MediaQueryList | null = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);

  const onChange = () => {
    onStoreChange();
    // The old query is pinned to the OLD ratio and will never match again, so
    // it is swapped for one pinned to the new ratio; without this re-arm only
    // the first monitor move would be observed.
    mql?.removeEventListener?.('change', onChange);
    mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mql?.addEventListener?.('change', onChange);
  };

  mql?.addEventListener?.('change', onChange);
  return () => {
    mql?.removeEventListener?.('change', onChange);
    mql = null;
  };
}

/**
 * @returns the display's device pixel ratio (≥ 0, finite; 1 when unknown).
 */
export function useDevicePixelRatio(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
