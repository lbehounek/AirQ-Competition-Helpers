/**
 * Pure A4-landscape grid math for the rally turning-point PDF page
 * (feedback 2026-05-03 — landscape page renders 5×2 when a set has >= 10
 * photos, else 3×3). Extracted from `pdfGenerator.calculateLayout` so the
 * grid-selection boundary, the per-photo dimensions, and the centering
 * arithmetic can be unit-tested without spawning the React PDF renderer.
 *
 * Inputs:
 *   • aspectRatio — photo aspect ratio (width / height)
 *   • headerExtent — measured size of the rasterised header (height when
 *     placed on top, width when placed on the left)
 *   • headerPad — padding between the header text and the photo grid (~1mm)
 *   • pageCount — number of photos on this specific page; >= 10 triggers
 *     5×2, else 3×3. Per-page so set1=10 / set2=7 mixes (5×2 page + 3×3
 *     page with 2 trailing empties) work as expected.
 *   • headerPlacement — 'top' (default, full-width band above grid) or
 *     'left' (rotated gutter beside grid, like portrait). The 'left'
 *     variant is used for 4:3 photos (the FAI official answer-sheet
 *     ratio) so the rotated header lives in the horizontal slack the
 *     height-constrained 4:3 grid leaves on the sides, reclaiming the
 *     ~22pt the top band would otherwise eat (feedback 2026-05-12).
 */
export const A4_LANDSCAPE_WIDTH_PT = 842;
export const A4_LANDSCAPE_HEIGHT_PT = 595;
export const PDF_LANDSCAPE_GAP_PT = 2.83; // ~1mm in points
export const PDF_LANDSCAPE_MARGIN_PT = 0; // edge-less layout

export type LandscapeHeaderPlacement = 'top' | 'left';

export type LandscapeGridLayout = {
  photoWidth: number;
  photoHeight: number;
  startX: number;
  startY: number;
  gap: number;
  cols: number;
  rows: number;
  headerY: number;
  headerX: number;
  headerPlacement: LandscapeHeaderPlacement;
};

export function calculateLandscapeGrid(
  aspectRatio: number,
  headerExtent: number,
  headerPad: number,
  pageCount: number,
  headerPlacement: LandscapeHeaderPlacement = 'top',
): LandscapeGridLayout {
  const pageWidth = A4_LANDSCAPE_WIDTH_PT;
  const pageHeight = A4_LANDSCAPE_HEIGHT_PT;
  const margin = PDF_LANDSCAPE_MARGIN_PT;
  const headerSize = Math.max(0, headerExtent || 0);
  const gap = PDF_LANDSCAPE_GAP_PT;

  // pageCount >= 10 → 5×2; else 3×3. Trigger purely on `pageCount` so the
  // selection is per-page — set1 with 10 photos can render 5×2 even when
  // set2 has 7 (renders 3×3 with 2 empty trailing tiles).
  const cols = pageCount >= 10 ? 5 : 3;
  const rows = pageCount >= 10 ? 2 : 3;

  // Header eats width when on the left, height when on top. The opposite
  // axis is left untouched so the grid can reclaim it.
  const availableWidth = headerPlacement === 'left'
    ? pageWidth - 2 * margin - headerPad - headerSize
    : pageWidth - 2 * margin;
  const availableHeight = headerPlacement === 'left'
    ? pageHeight - 2 * margin
    : pageHeight - headerPad - headerSize;

  const photoWidth = Math.floor((availableWidth - (cols - 1) * gap) / cols);
  const photoHeight = Math.floor((availableHeight - (rows - 1) * gap) / rows);

  // Match aspect ratio: shrink the larger dimension to satisfy width/height.
  const correctedHeight = Math.min(photoHeight, photoWidth / aspectRatio);
  const correctedWidth = correctedHeight * aspectRatio;

  const totalWidth = correctedWidth * cols + gap * (cols - 1);
  const totalHeight = correctedHeight * rows + gap * (rows - 1);

  // Left header → grid is shifted right past the gutter and centered
  // vertically. Top header → original behaviour: grid hugs the header
  // top-down and centers horizontally only.
  const startX = headerPlacement === 'left'
    ? headerPad + headerSize + (availableWidth - totalWidth) / 2
    : margin + (availableWidth - totalWidth) / 2;
  const startY = headerPlacement === 'left'
    ? margin + (availableHeight - totalHeight) / 2
    : headerPad + headerSize;

  // `headerX`/`headerY` describe where the caller should place the
  // rasterised header image. For 'top' the header sits flush against the
  // top-pad on the left side. For 'left' it hugs the left edge and the
  // caller decides the vertical centering (depends on the rasterised
  // image height, which lives at the caller).
  const headerY = headerPlacement === 'left' ? 0 : headerPad;
  const headerX = headerPlacement === 'left' ? headerPad : 0;

  return {
    photoWidth: correctedWidth,
    photoHeight: correctedHeight,
    startX,
    startY,
    gap,
    cols,
    rows,
    headerY,
    headerX,
    headerPlacement,
  };
}
