/**
 * Canvas backing-store sizing policy — pure and DOM-free so it can be unit
 * tested and so PhotoEditorApi can key a `useMemo` on a single number.
 *
 * WHY this exists (restates the history that used to live in
 * PhotoEditorApi.tsx): the grid `<canvas>` is CSS-sized to 100% of its cell
 * (400–700 CSS px on a 1080p/1440p screen, >1000 device px after
 * devicePixelRatio scaling), so the original fixed 300 px buffer was being
 * upscaled 2–4× and the preview looked pixelated even though the printed PDF
 * was crisp (feedback 2026-05-10). The fix at the time bumped EVERY grid slot
 * to a fixed 600 — including 144 px candidate-tray thumbs, which then paid
 * 600² of CPU effect work to display 144 px. Measuring the real cell width and
 * multiplying by the display's DPR gives ≤1× upscale on any display without
 * over-rendering the small cells.
 */

/**
 * Pre-2026-05-10 base width. Also the floor: `drawLabel` (canvasUtils.ts)
 * scales its font by `width / 300`, so below this the burned-in labels stop
 * being legible.
 */
export const GRID_CANVAS_MIN_WIDTH = 300;

/**
 * Equal to today's fixed grid size, so this policy can never draw MORE pixels
 * than the previous code did — CPU effect passes cost ∝ width² across ~20
 * mounted canvases. Raise it only after measuring on the target laptop; it is
 * a single constant with a table test.
 */
export const GRID_CANVAS_MAX_WIDTH = 600;

/**
 * Round the measured width UP to this step so window-resize jitter (or a
 * scrollbar appearing) does not resize and repaint every canvas per pixel.
 */
export const GRID_CANVAS_QUANTUM = 100;

/**
 * Modal backing width. MUST stay equal to the modal canvas's CSS width: the
 * drag, wheel and `canvasToBaseCoords` math in PhotoEditorApi converts CSS
 * pixel deltas with `canvas.width / BASE_WIDTH`, which is only correct while
 * backing size == CSS size.
 */
export const LARGE_CANVAS_WIDTH = 600;

/** Width of the "No photo data" placeholder box (was `getCanvasSize(240)`). */
export const GRID_PLACEHOLDER_WIDTH = 240;

/**
 * Canvas dimensions for a given backing width under an aspect ratio.
 * Returns `{ width, height }` in device pixels; identical formula (and
 * rounding) to `AspectRatioContext.getCanvasSize`, which now delegates here so
 * there is exactly one implementation.
 */
export function canvasSizeFor(width: number, ratio: number): { width: number; height: number } {
  return { width, height: Math.round(width / ratio) };
}

/**
 * Backing-store width for a GRID canvas from its measured CSS width and the
 * display DPR. Returns a multiple of `GRID_CANVAS_QUANTUM` clamped to
 * [MIN, MAX].
 *
 * Edge cases: `cssWidth === null` (not measured yet — first render, or jsdom
 * with no ResizeObserver), non-finite or ≤ 0 (a `display:none` cell reports
 * width 0) all fall back to `GRID_CANVAS_MIN_WIDTH`, which is the historical
 * size and always legible. A non-finite or non-positive `dpr` falls back to 1.
 */
export function resolveGridBackingWidth(cssWidth: number | null, dpr: number): number {
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  if (cssWidth === null || !Number.isFinite(cssWidth) || cssWidth <= 0) {
    return GRID_CANVAS_MIN_WIDTH;
  }
  const quantized = Math.ceil((cssWidth * safeDpr) / GRID_CANVAS_QUANTUM) * GRID_CANVAS_QUANTUM;
  return Math.min(GRID_CANVAS_MAX_WIDTH, Math.max(GRID_CANVAS_MIN_WIDTH, quantized));
}

/**
 * Backing-store width for either editor size. `'large'` ignores the
 * measurement entirely and returns `LARGE_CANVAS_WIDTH` (see that constant for
 * why it may not vary); `'grid'` delegates to `resolveGridBackingWidth`.
 */
export function resolveCanvasWidth(size: 'grid' | 'large', cssWidth: number | null, dpr: number): number {
  return size === 'large' ? LARGE_CANVAS_WIDTH : resolveGridBackingWidth(cssWidth, dpr);
}
