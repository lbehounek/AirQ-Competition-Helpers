/**
 * Per-set grid layout (slots and column count) for rally turning-point
 * mode (feedback 2026-05-03). Extracted from `TurningPointLayout.tsx` so
 * the boundary logic at `count === 10` is unit-testable — a regression
 * where `count >= 10` becomes `count > 10` would resurrect the exact
 * silent-photo-loss bug that motivated the round-4 fix (the 10th photo
 * silently hidden behind a 3×3 grid).
 *
 * Rules:
 *   • Precision discipline: returns `undefined` so the caller falls back
 *     to its own layoutConfig (precision uses a single 9-slot 3×3).
 *   • Portrait orientation: always 10 slots in 2 columns (2×5).
 *   • Landscape, count >= 10: 10 slots in 5 columns (5×2). The cap is
 *     reached only on a fully-filled rally page.
 *   • Landscape, count < 10: 9 slots in 3 columns (3×3). Below 10,
 *     keeping 3×3 avoids rendering 4 trailing empties on a partial drop.
 */
export type RallyGridLayout = { slots: number; columns: number };
export type RallyLayoutMode = 'portrait' | 'landscape';

export function rallyGridFor(
  count: number,
  layoutMode: RallyLayoutMode,
  isPrecision: boolean,
): RallyGridLayout | undefined {
  if (isPrecision) return undefined;
  if (layoutMode === 'portrait') return { slots: 10, columns: 2 };
  return count >= 10 ? { slots: 10, columns: 5 } : { slots: 9, columns: 3 };
}
