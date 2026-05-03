/**
 * Pure A4-landscape grid math for the rally turning-point PDF page
 * (feedback 2026-05-03 — landscape page renders 5×2 when a set has >= 10
 * photos, else 3×3). Extracted from `pdfGenerator.calculateLayout` so the
 * grid-selection boundary, the per-photo dimensions, and the centering
 * arithmetic can be unit-tested without spawning the React PDF renderer.
 *
 * Inputs:
 *   • aspectRatio — photo aspect ratio (width / height)
 *   • landscapeHeaderHeight — measured height of the rasterised header
 *   • headerTopPad — top padding for header text in points (~1mm)
 *   • pageCount — number of photos on this specific page; >= 10 triggers
 *     5×2, else 3×3. Per-page so set1=10 / set2=7 mixes (5×2 page + 3×3
 *     page with 2 trailing empties) work as expected.
 */
export const A4_LANDSCAPE_WIDTH_PT = 842;
export const A4_LANDSCAPE_HEIGHT_PT = 595;
export const PDF_LANDSCAPE_GAP_PT = 2.83; // ~1mm in points
export const PDF_LANDSCAPE_MARGIN_PT = 0; // edge-less layout

export type LandscapeGridLayout = {
  photoWidth: number;
  photoHeight: number;
  startX: number;
  startY: number;
  gap: number;
  cols: number;
  rows: number;
  headerY: number;
};

export function calculateLandscapeGrid(
  aspectRatio: number,
  landscapeHeaderHeight: number,
  headerTopPad: number,
  pageCount: number,
): LandscapeGridLayout {
  const pageWidth = A4_LANDSCAPE_WIDTH_PT;
  const pageHeight = A4_LANDSCAPE_HEIGHT_PT;
  const margin = PDF_LANDSCAPE_MARGIN_PT;
  const headerHeight = Math.max(0, landscapeHeaderHeight || 0);
  const gap = PDF_LANDSCAPE_GAP_PT;

  // pageCount >= 10 → 5×2; else 3×3. Trigger purely on `pageCount` so the
  // selection is per-page — set1 with 10 photos can render 5×2 even when
  // set2 has 7 (renders 3×3 with 2 empty trailing tiles).
  const cols = pageCount >= 10 ? 5 : 3;
  const rows = pageCount >= 10 ? 2 : 3;

  const availableWidth = pageWidth - 2 * margin;
  const availableHeight = pageHeight - headerTopPad - headerHeight;

  const photoWidth = Math.floor((availableWidth - (cols - 1) * gap) / cols);
  const photoHeight = Math.floor((availableHeight - (rows - 1) * gap) / rows);

  // Match aspect ratio: shrink the larger dimension to satisfy width/height.
  const correctedHeight = Math.min(photoHeight, photoWidth / aspectRatio);
  const correctedWidth = correctedHeight * aspectRatio;

  const totalWidth = correctedWidth * cols + gap * (cols - 1);
  const startX = margin + (availableWidth - totalWidth) / 2;
  const startY = headerTopPad + headerHeight;

  return {
    photoWidth: correctedWidth,
    photoHeight: correctedHeight,
    startX,
    startY,
    gap,
    cols,
    rows,
    headerY: headerTopPad,
  };
}
