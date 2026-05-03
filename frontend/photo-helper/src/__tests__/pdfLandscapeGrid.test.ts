import { describe, it, expect } from 'vitest';
import {
  calculateLandscapeGrid,
  A4_LANDSCAPE_WIDTH_PT,
  A4_LANDSCAPE_HEIGHT_PT,
  PDF_LANDSCAPE_GAP_PT,
} from '../utils/pdfLandscapeGrid';

// 3:2 photo aspect ratio (typical 35mm digital, what the rally answer
// sheet usually carries). Tests don't depend on the exact value — they
// pin RELATIONSHIPS (cols/rows transitions, centering invariants) so a
// future tweak to aspect-ratio handling won't break them spuriously.
const ASPECT_3_2 = 1.5;
const HEADER_HEIGHT = 25;
const HEADER_TOP_PAD = 2.83;

describe('calculateLandscapeGrid', () => {
  describe('grid selection (3×3 vs 5×2 boundary)', () => {
    it('selects 3×3 when pageCount is below 10', () => {
      // Round-4 rule: below 10 photos in landscape, render 3×3 so a
      // partial drop doesn't leave 4 trailing empties.
      for (const count of [0, 5, 8, 9]) {
        const layout = calculateLandscapeGrid(ASPECT_3_2, HEADER_HEIGHT, HEADER_TOP_PAD, count);
        expect(layout.cols).toBe(3);
        expect(layout.rows).toBe(3);
      }
    });

    it('selects 5×2 at the count === 10 boundary', () => {
      // The exact boundary the round-4 fix targets.
      const layout = calculateLandscapeGrid(ASPECT_3_2, HEADER_HEIGHT, HEADER_TOP_PAD, 10);
      expect(layout.cols).toBe(5);
      expect(layout.rows).toBe(2);
    });

    it('keeps 5×2 when pageCount > 10 (defensive — cap is 10)', () => {
      const layout = calculateLandscapeGrid(ASPECT_3_2, HEADER_HEIGHT, HEADER_TOP_PAD, 11);
      expect(layout.cols).toBe(5);
      expect(layout.rows).toBe(2);
    });
  });

  describe('layout invariants', () => {
    it('produces strictly positive photo dimensions for both grids', () => {
      // A regression that produced zero or negative widths (e.g. a sign
      // flip on the gap calculation) would silently print empty pages.
      const layout33 = calculateLandscapeGrid(ASPECT_3_2, HEADER_HEIGHT, HEADER_TOP_PAD, 9);
      const layout52 = calculateLandscapeGrid(ASPECT_3_2, HEADER_HEIGHT, HEADER_TOP_PAD, 10);
      expect(layout33.photoWidth).toBeGreaterThan(0);
      expect(layout33.photoHeight).toBeGreaterThan(0);
      expect(layout52.photoWidth).toBeGreaterThan(0);
      expect(layout52.photoHeight).toBeGreaterThan(0);
    });

    it('respects the photo aspect ratio (corrected width = corrected height × aspectRatio)', () => {
      const layout = calculateLandscapeGrid(ASPECT_3_2, HEADER_HEIGHT, HEADER_TOP_PAD, 10);
      // Within a small floating-point tolerance — `Math.floor` is applied
      // to the pre-correction dimensions, then aspect-ratio is enforced.
      expect(layout.photoWidth / layout.photoHeight).toBeCloseTo(ASPECT_3_2, 5);
    });

    it('horizontally centers the grid within the available width', () => {
      // Centering guarantee: 2 * startX + totalGridWidth ≈ pageWidth.
      const layout = calculateLandscapeGrid(ASPECT_3_2, HEADER_HEIGHT, HEADER_TOP_PAD, 10);
      const totalGridWidth = layout.photoWidth * layout.cols + layout.gap * (layout.cols - 1);
      // Margin is 0 (edge-less), so startX === (pageWidth - totalGridWidth) / 2.
      const expectedStartX = (A4_LANDSCAPE_WIDTH_PT - totalGridWidth) / 2;
      expect(layout.startX).toBeCloseTo(expectedStartX, 5);
    });

    it('places the grid directly below the header (startY = headerTopPad + headerHeight)', () => {
      const layout = calculateLandscapeGrid(ASPECT_3_2, HEADER_HEIGHT, HEADER_TOP_PAD, 10);
      expect(layout.startY).toBeCloseTo(HEADER_TOP_PAD + HEADER_HEIGHT, 5);
    });

    it('echoes headerTopPad as headerY (where the title text lands)', () => {
      const layout = calculateLandscapeGrid(ASPECT_3_2, HEADER_HEIGHT, HEADER_TOP_PAD, 5);
      expect(layout.headerY).toBe(HEADER_TOP_PAD);
    });

    it('returns the documented constant gap (1mm in PDF points)', () => {
      const layout = calculateLandscapeGrid(ASPECT_3_2, HEADER_HEIGHT, HEADER_TOP_PAD, 7);
      expect(layout.gap).toBe(PDF_LANDSCAPE_GAP_PT);
    });
  });

  describe('grid fits on the A4 page (sanity)', () => {
    // The total grid bounding box should never overflow the page in either
    // dimension. A regression that picked the wrong page constant or got
    // the cols/rows transposed would show up here.
    it('3×3 grid total height fits below the available height', () => {
      const layout = calculateLandscapeGrid(ASPECT_3_2, HEADER_HEIGHT, HEADER_TOP_PAD, 9);
      const totalHeight = layout.photoHeight * layout.rows + layout.gap * (layout.rows - 1);
      const availableHeight = A4_LANDSCAPE_HEIGHT_PT - HEADER_TOP_PAD - HEADER_HEIGHT;
      expect(totalHeight).toBeLessThanOrEqual(availableHeight + 1); // +1 for floor rounding
    });

    it('5×2 grid total height fits below the available height', () => {
      const layout = calculateLandscapeGrid(ASPECT_3_2, HEADER_HEIGHT, HEADER_TOP_PAD, 10);
      const totalHeight = layout.photoHeight * layout.rows + layout.gap * (layout.rows - 1);
      const availableHeight = A4_LANDSCAPE_HEIGHT_PT - HEADER_TOP_PAD - HEADER_HEIGHT;
      expect(totalHeight).toBeLessThanOrEqual(availableHeight + 1);
    });
  });

  describe('header height edge cases', () => {
    it('handles a zero-height header (no header rendered)', () => {
      const layout = calculateLandscapeGrid(ASPECT_3_2, 0, HEADER_TOP_PAD, 10);
      expect(layout.startY).toBeCloseTo(HEADER_TOP_PAD, 5);
    });

    it('clamps a negative header height to zero', () => {
      // Defensive: a negative input shouldn't push the grid above the page.
      const layout = calculateLandscapeGrid(ASPECT_3_2, -50, HEADER_TOP_PAD, 10);
      expect(layout.startY).toBeCloseTo(HEADER_TOP_PAD, 5);
    });
  });
});
