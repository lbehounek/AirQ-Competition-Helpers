/**
 * Per-set grid layout (slot count and column count) for the on-screen photo
 * grid. Pure so the boundary at `count === 10` is unit-testable — a regression
 * turning `count >= 10` into `count > 10` resurrects the exact silent
 * photo-loss bug this exists to prevent (the 10th photo hidden behind a 3×3).
 *
 * Rules:
 *   • Portrait: always 10 slots in 2 columns (2×5).
 *   • Landscape, count >= 10: 10 slots in 5 columns (5×2).
 *   • Landscape, count < 10: 9 slots in 3 columns (3×3) — below 10, keeping
 *     3×3 avoids rendering 4 trailing empties on a partial drop.
 *
 * DELIBERATELY DISCIPLINE-NEUTRAL. This was `rallyGridFor`, which returned
 * `undefined` for precision so precision fell back to a fixed 9-slot 3×3. The
 * PDF has never had that exclusion — `pdfLandscapeGrid` switches to 5×2 purely
 * on the photo count — so a precision set holding 10 photos in landscape showed
 * 9 on screen and printed 10 in a different grid shape. The 10th photo was
 * invisible right up until it appeared on the printed answer sheet.
 *
 * A precision set can legitimately hold 10: FAI precision rules allow max 10
 * photos (min 8), and the layout switch warns-then-permits going from a full
 * portrait set to landscape.
 *
 * Keep the >= 10 boundary in step with `pdfLandscapeGrid.ts`, which applies the
 * same rule to the printed page — they are the screen and paper halves of one
 * behaviour, and WYSIWYG depends on them agreeing.
 */
export type GridLayout = { slots: number; columns: number };
export type GridLayoutMode = 'portrait' | 'landscape';

/** Photo count at which a landscape page/grid switches from 3×3 to 5×2. */
export const LANDSCAPE_WIDE_AT = 10;

export function gridShapeFor(count: number, layoutMode: GridLayoutMode): GridLayout {
  if (layoutMode === 'portrait') return { slots: 10, columns: 2 };
  return count >= LANDSCAPE_WIDE_AT ? { slots: 10, columns: 5 } : { slots: 9, columns: 3 };
}
