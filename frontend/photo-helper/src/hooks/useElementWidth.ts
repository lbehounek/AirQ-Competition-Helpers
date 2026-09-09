import { useEffect, useState } from 'react';

/**
 * Trailing-debounce applied to every ResizeObserver report after the first.
 * Exported so tests can advance timers by exactly this much.
 */
export const ELEMENT_WIDTH_DEBOUNCE_MS = 120;

/**
 * Observe the CSS width (integer px, from `contentRect`) of an element.
 *
 * Takes the ELEMENT, not a ref, on purpose: PhotoEditorApi's canvas wrapper is
 * the last of four render branches and only exists once the image has loaded
 * asynchronously, so a `useRef` read inside a mount effect would be `null`
 * forever. Callers pass state populated by a callback ref
 * (`ref={setWrapperEl}`), which re-runs this hook's effect the moment the node
 * attaches or detaches.
 *
 * The FIRST report is applied synchronously so the first canvas draw is not
 * delayed by a debounce; later reports are trailing-debounced by
 * `ELEMENT_WIDTH_DEBOUNCE_MS` so dragging a window edge does not resize and
 * repaint ~20 canvases at every quantum crossing.
 *
 * @returns the observed width in CSS px, or `null` while unmeasured — before
 * the first report, when `enabled` is false, when there is no element, or in
 * an environment without `ResizeObserver` (jsdom). Callers must treat `null`
 * as "not measured yet", not as zero.
 */
export function useElementWidth(el: HTMLElement | null, enabled = true): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    // No synchronous setState here: bailing out must not reset the width (the
    // canvas is unmounted anyway) and a setState in an effect body is exactly
    // what `react-hooks/set-state-in-effect` flags.
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return;

    let timer: number | null = null;
    let isFirstReport = true;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const next = Math.round(entry.contentRect.width);
      // Identity-preserving update: an unchanged width must not re-render the
      // editor, or the resize debounce would be pointless.
      const apply = () => setWidth(prev => (prev === next ? prev : next));

      if (isFirstReport) {
        isFirstReport = false;
        apply();
        return;
      }
      if (timer !== null) window.clearTimeout(timer);
      // `window.setTimeout`/`number` rather than the ambient overload: @types/node
      // is in this program and its global `setTimeout` returns `NodeJS.Timeout`.
      timer = window.setTimeout(apply, ELEMENT_WIDTH_DEBOUNCE_MS);
    });

    observer.observe(el);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [el, enabled]);

  return width;
}
