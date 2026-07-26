import { describe, it, expect } from 'vitest';
import { gridShapeFor, LANDSCAPE_WIDE_AT } from '../utils/gridShapeFor';
import { calculateLandscapeGrid } from '../utils/pdfLandscapeGrid';

// The boundary at count === 10 is load-bearing: a regression where
// `count >= 10` becomes `count > 10` would resurrect the round-4 bug
// (the 10th photo silently hidden behind a 3×3 landscape grid).
// Pinning every adjacent point to the boundary surfaces that.
describe('gridShapeFor', () => {
  describe('portrait', () => {
    it('always returns 10 slots in 2 columns (2×5), regardless of count', () => {
      // Portrait stays 2×5 = 10 unconditionally.
      expect(gridShapeFor(0, 'portrait')).toEqual({ slots: 10, columns: 2 });
      expect(gridShapeFor(5, 'portrait')).toEqual({ slots: 10, columns: 2 });
      expect(gridShapeFor(10, 'portrait')).toEqual({ slots: 10, columns: 2 });
    });
  });

  describe('landscape', () => {
    it('returns 9 slots in 3 columns (3×3) when count is below 10', () => {
      expect(gridShapeFor(0, 'landscape')).toEqual({ slots: 9, columns: 3 });
      expect(gridShapeFor(5, 'landscape')).toEqual({ slots: 9, columns: 3 });
      expect(gridShapeFor(9, 'landscape')).toEqual({ slots: 9, columns: 3 });
    });

    it('returns 10 slots in 5 columns (5×2) at the count === 10 boundary', () => {
      expect(gridShapeFor(10, 'landscape')).toEqual({ slots: 10, columns: 5 });
    });

    it('returns 10 slots in 5 columns when count > 10 (defensive — cap is 10)', () => {
      // Cap is enforced upstream. If a higher count somehow slips through,
      // the grid still shows 5×2 rather than truncating to 3×3.
      expect(gridShapeFor(11, 'landscape')).toEqual({ slots: 10, columns: 5 });
      expect(gridShapeFor(99, 'landscape')).toEqual({ slots: 10, columns: 5 });
    });

    it('shrinks back to 3×3 if the user removes a photo from a full 5×2 set', () => {
      // 10 photos → 5×2; remove one, count becomes 9 → 3×3.
      // The remaining 9 still fit (3×3 holds 9 exactly), no loss.
      expect(gridShapeFor(10, 'landscape')).toEqual({ slots: 10, columns: 5 });
      expect(gridShapeFor(9, 'landscape')).toEqual({ slots: 9, columns: 3 });
    });
  });

  // The whole point of making this discipline-neutral. `rallyGridFor` returned
  // `undefined` for precision, so precision fell back to a fixed 9-slot 3×3
  // while the PDF printed the same set as 5×2 — the 10th photo was invisible on
  // screen and present on paper. FAI precision allows up to 10 photos, and the
  // layout switch warns-then-permits a full portrait set moving to landscape,
  // so a 10-photo precision landscape set is reachable in normal use.
  describe('discipline neutrality', () => {
    it('gives precision the same 5×2 the PDF prints for a 10-photo landscape set', () => {
      expect(gridShapeFor(10, 'landscape')).toEqual({ slots: 10, columns: 5 });
    });

    it('never renders fewer slots than the PDF prints cells, at every count', () => {
      // The invariant that makes the sheet WYSIWYG: screen slots >= PDF cells.
      // Guards both halves at once, so changing one without the other fails.
      for (let count = 0; count <= 12; count++) {
        const screen = gridShapeFor(count, 'landscape');
        const pdf = calculateLandscapeGrid(4 / 3, 20, 3, count, 'top');
        const pdfCells = pdf.rows * pdf.cols;
        expect(
          screen.slots,
          `count=${count}: screen renders ${screen.slots} slots but the PDF prints ${pdfCells} cells`,
        ).toBeGreaterThanOrEqual(Math.min(pdfCells, count));
        // And at/above the boundary the two grids agree exactly.
        if (count >= LANDSCAPE_WIDE_AT) {
          expect(screen.slots).toBe(pdfCells);
          expect(screen.columns).toBe(pdf.cols);
        }
      }
    });
  });
});
