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

  describe("headerPlacement: 'left' (rotated side-header for 4:3)", () => {
    // Side-header mode (feedback 2026-05-12): the rotated header lives in
    // a left gutter, so it should eat WIDTH and leave the full page HEIGHT
    // for photos. Default remains 'top' for back-compat. Production
    // trigger is 4:3 — the FAI answer-sheet ratio, which is the case the
    // side header actually helps (cells grow ~3% because the grid is
    // height-constrained and there's horizontal slack to reclaim).
    const ASPECT_4_3 = 4 / 3;
    const SIDE_GUTTER = 22;

    it("defaults to 'top' placement when the arg is omitted", () => {
      const layout = calculateLandscapeGrid(ASPECT_4_3, HEADER_HEIGHT, HEADER_TOP_PAD, 9);
      expect(layout.headerPlacement).toBe('top');
    });

    it('left placement reclaims the full vertical extent for the grid', () => {
      const layout = calculateLandscapeGrid(ASPECT_4_3, SIDE_GUTTER, HEADER_TOP_PAD, 9, 'left');
      // The grid is centered vertically inside the full page height — its
      // total height plus 2 * startY should equal A4 height (within
      // floor-rounding tolerance).
      const totalHeight = layout.photoHeight * layout.rows + layout.gap * (layout.rows - 1);
      expect(2 * layout.startY + totalHeight).toBeCloseTo(A4_LANDSCAPE_HEIGHT_PT, 0);
    });

    it('left placement pushes the grid past the gutter horizontally', () => {
      const layout = calculateLandscapeGrid(ASPECT_4_3, SIDE_GUTTER, HEADER_TOP_PAD, 9, 'left');
      // Grid starts at or beyond the gutter (header occupies headerPad
      // through headerPad + SIDE_GUTTER on the left).
      expect(layout.startX).toBeGreaterThanOrEqual(HEADER_TOP_PAD + SIDE_GUTTER);
    });

    it("exposes headerX at the headerPad offset (caller uses it for placement)", () => {
      const layout = calculateLandscapeGrid(ASPECT_4_3, SIDE_GUTTER, HEADER_TOP_PAD, 9, 'left');
      expect(layout.headerX).toBeCloseTo(HEADER_TOP_PAD, 5);
      // headerY is 0 in left-placement mode — caller centers the rotated
      // image vertically itself using the rasterised image height.
      expect(layout.headerY).toBe(0);
    });

    it('still respects the photo aspect ratio in left placement', () => {
      const layout = calculateLandscapeGrid(ASPECT_4_3, SIDE_GUTTER, HEADER_TOP_PAD, 9, 'left');
      expect(layout.photoWidth / layout.photoHeight).toBeCloseTo(ASPECT_4_3, 5);
    });

    it('grows 4:3 cells vs the top-header baseline (the whole point)', () => {
      // The side-header trade only makes sense for height-constrained
      // grids (4:3 on A4 landscape). Pin the gain so a future refactor
      // that accidentally flips the constraint will fail this test.
      const top = calculateLandscapeGrid(ASPECT_4_3, HEADER_HEIGHT, HEADER_TOP_PAD, 9, 'top');
      const left = calculateLandscapeGrid(ASPECT_4_3, SIDE_GUTTER, HEADER_TOP_PAD, 9, 'left');
      expect(left.photoHeight).toBeGreaterThan(top.photoHeight);
      expect(left.photoWidth).toBeGreaterThan(top.photoWidth);
    });

    it('5×2 grid also switches axis in left placement', () => {
      const layout = calculateLandscapeGrid(ASPECT_4_3, SIDE_GUTTER, HEADER_TOP_PAD, 10, 'left');
      expect(layout.cols).toBe(5);
      expect(layout.rows).toBe(2);
      expect(layout.headerPlacement).toBe('left');
    });
  });
});
