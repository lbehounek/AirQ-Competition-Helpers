import React from 'react';
import { Document, Page, Image, pdf, StyleSheet } from '@react-pdf/renderer';
import type { ApiPhoto, ApiPhotoSet } from '../types/api';
import { dirnameOf, slugifyForFilename } from '@airq/shared-storage';
import { calculateLandscapeGrid } from './pdfLandscapeGrid';
import { getImageCache } from './imageCache';
import { BASE_WIDTH, drawCircle, renderPhotoOnCanvas } from '../components/PhotoEditorApi';
import { drawLabel } from './canvasUtils';

// Hi-res target width for photos embedded in the PDF.
// At 1600 px wide, a 280 pt landscape A4 cell prints at >400 DPI —
// well above print quality. The on-screen canvas (300 px) was the
// pixelation cause: it was being upscaled ~4× by the PDF/printer.
const PDF_PHOTO_TARGET_WIDTH = 1600;
// JPEG quality for embedded photos. 0.95 is the practical sweet spot —
// near-lossless visually, file size manageable for 9–10 photos per page.
const PDF_PHOTO_JPEG_QUALITY = 0.95;

// Polyfill Buffer for @react-pdf/renderer
import { Buffer } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

// Branding (the small "created using …" line on every PDF page) is gated
// behind this flag. The promotional site is not yet live and the app isn't
// fully tested, so the user asked us to suppress it for the upcoming
// builds (feedback 2026-04-25). Flip back to `true` once the site goes live.
const BRANDING_ENABLED = false;

// Brilliant workaround: Render text as image to bypass @react-pdf/renderer Unicode issues

interface TextImageResult {
  dataUrl: string;
  width: number;
  height: number;
}

const createTextImage = (text: string, isRotated: boolean = true, fontSize: number = 18): TextImageResult | null => {
  if (!text.trim()) return null;
  
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    // High-resolution rendering constants
    const PIXEL_RATIO = 3; // 3x resolution for crisp PDF text
    const FONT_SIZE = fontSize; // Configurable font size
    const FONT_FAMILY = 'Arial, sans-serif'; // Excellent Unicode support
    const HORIZONTAL_PADDING = 40;
    // Vertical padding around the rasterised text, in logical pt. Originally
    // 12 pt; reduced to 4 pt (feedback 2026-05-10 — header band ate too much
    // vertical real estate, leaving photos visibly smaller than the page
    // could accommodate). For non-rotated headers VP becomes the entire
    // empty space above + below the text inside the image; for rotated
    // (portrait) headers VP becomes the gutter width, so a smaller value
    // also gives portrait pages more room for photos.
    const VERTICAL_PADDING = 4;
    const MIN_ROTATED_HEIGHT = 400; // Minimum height for rotated text
    
    // Configure font for text measurement
    ctx.font = `bold ${FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    
    // Measure text dimensions
    const metrics = ctx.measureText(text);
    const textWidth = Math.ceil(metrics.width);
    const textHeight = Math.ceil(FONT_SIZE * 1.4);
    
    // Calculate logical canvas dimensions
    const logicalWidth = isRotated 
      ? textHeight + VERTICAL_PADDING
      : textWidth + HORIZONTAL_PADDING;
    
    const logicalHeight = isRotated
      ? Math.max(textWidth + HORIZONTAL_PADDING, MIN_ROTATED_HEIGHT)
      : textHeight + VERTICAL_PADDING;
    
    // Set high-resolution canvas size
    canvas.width = logicalWidth * PIXEL_RATIO;
    canvas.height = logicalHeight * PIXEL_RATIO;
    ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
    
    // Configure high-quality text rendering
    ctx.font = `bold ${FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Draw text with rotation if needed
    if (isRotated) {
      ctx.translate(logicalWidth / 2, logicalHeight / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(text, 0, 0);
    } else {
      ctx.fillText(text, logicalWidth / 2, logicalHeight / 2);
    }
    
    return {
      dataUrl: canvas.toDataURL('image/png', 1.0),
      width: logicalWidth,
      height: logicalHeight
    };
  } catch (error) {
    console.error('Failed to create text image:', error);
    return null;
  }
};

const createMultilineTextImage = (lines: string[], fontSize: number = 12): TextImageResult | null => {
  if (!lines.length || lines.every(line => !line.trim())) return null;
  
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    // High-resolution rendering constants
    const PIXEL_RATIO = 3; // 3x resolution for crisp PDF text
    const FONT_SIZE = fontSize;
    const FONT_FAMILY = 'Arial, sans-serif'; // Excellent Unicode support
    const HORIZONTAL_PADDING = 20;
    const VERTICAL_PADDING = 8;
    const LINE_SPACING = fontSize * 0.1; // 10% of font size for tighter line spacing
    
    // Configure font for text measurement
    ctx.font = `bold ${FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000000';
    
    // Measure text dimensions
    let maxWidth = 0;
    const lineMetrics = lines.map(line => {
      const metrics = ctx.measureText(line);
      const width = Math.ceil(metrics.width);
      maxWidth = Math.max(maxWidth, width);
      return { text: line, width };
    });
    
    const lineHeight = Math.ceil(FONT_SIZE * 1.2);
    const totalHeight = (lineHeight * lines.length) + (LINE_SPACING * (lines.length - 1));
    
    // Calculate logical canvas dimensions
    const logicalWidth = maxWidth + HORIZONTAL_PADDING;
    const logicalHeight = totalHeight + VERTICAL_PADDING;
    
    // Set high-resolution canvas size
    canvas.width = logicalWidth * PIXEL_RATIO;
    canvas.height = logicalHeight * PIXEL_RATIO;
    ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
    
    // Configure high-quality text rendering
    ctx.font = `bold ${FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'right';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Draw each line aligned to the right
    const startY = VERTICAL_PADDING / 2;
    const rightX = logicalWidth - (HORIZONTAL_PADDING / 2);
    lines.forEach((line, index) => {
      const y = startY + (index * (lineHeight + LINE_SPACING));
      ctx.fillText(line, rightX, y);
    });
    
    return {
      dataUrl: canvas.toDataURL('image/png', 1.0),
      width: logicalWidth,
      height: logicalHeight
    };
  } catch (error) {
    console.error('Failed to create multiline text image:', error);
    return null;
  }
};

/**
 * Clean PDF generation with @react-pdf/renderer
 */
export const generatePDF = async (
  set1: ApiPhotoSet,
  set2: ApiPhotoSet,
  sessionId: string,
  aspectRatio = 4/3,
  competitionName?: string,
  layoutMode: 'landscape' | 'portrait' = 'landscape',
  t?: (key: string) => string,
  mode: 'track' | 'turningpoint' = 'track',
  competitionId?: string,
): Promise<void> => {
  // Per-page discriminator drawn in front of `setTitle | competitionName`
  // so a printed sheet identifies which kind of photos it carries
  // (feedback 2026-04-23). Translatable; falls back to English.
  const headerLabelFor = (pageKey: 'set1' | 'set2'): string => {
    if (mode === 'turningpoint') {
      return t ? t('pdf.header.turningPoint') : 'TP photos'
    }
    if (pageKey === 'set1') {
      return t ? t('pdf.header.trackSet1') : 'enroute photos first set'
    }
    return t ? t('pdf.header.trackSet2') : 'enroute photos second set'
  }
  
  // Per-photo render result. `degraded` flags the case where the hi-res
  // render threw but the on-screen DOM fallback succeeded — the PDF will
  // still include the cell, but at the lower resolution of the live grid
  // canvas, which is a visible quality regression vs the hi-res path.
  // `failed` flags the case where BOTH paths failed and the cell would
  // otherwise be silently omitted from the printed answer-sheet.
  type PhotoRenderResult =
    | { kind: 'ok'; dataUrl: string }
    | { kind: 'degraded'; dataUrl: string; photoId: string }
    | { kind: 'failed'; photoId: string; error: unknown };

  // Render the photo to a hi-res offscreen canvas and return a JPEG data URL.
  // The on-screen grid canvas is only 300 px wide, which the PDF/printer was
  // upscaling ~4× for an A4 cell at 300 DPI — that was the pixelation cause.
  // Re-rendering at PDF_PHOTO_TARGET_WIDTH bakes in zoom/pan/effects/label/circle
  // at print resolution, then the PDF embeds a sharp JPEG.
  //
  // Returns a tagged result rather than `null` on failure so the page-level
  // caller can collect failures and surface them to the user. The previous
  // shape (`Promise<string | null>`) let a render failure silently omit a
  // photo cell from the printed sheet — for a competition answer-sheet
  // workflow that's a correctness bug, not cosmetic (feedback 2026-05-12).
  const getPhotoDataUrl = async (photo: ApiPhoto): Promise<PhotoRenderResult> => {
    // "No photo" placeholder: draw a blank white cell with a thin border, a
    // centered "no photo" caption, and the slot's TP/SP/FP label — no image.
    // Returns kind:'ok' so it lands at its grid position and never counts as a
    // render failure (a genuinely missing image still flows to the catch below
    // and aborts the export — placeholders never mask real failures).
    if (photo.isPlaceholder) {
      const canvas = document.createElement('canvas');
      canvas.width = PDF_PHOTO_TARGET_WIDTH;
      canvas.height = Math.round(PDF_PHOTO_TARGET_WIDTH / aspectRatio);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const scale = canvas.width / BASE_WIDTH;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth = Math.max(1, Math.round(scale));
        ctx.strokeRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#9e9e9e';
        ctx.font = `${Math.round(28 * scale)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t ? t('photo.noPhotoCell') : 'No photo', canvas.width / 2, canvas.height / 2);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }
      drawLabel(canvas, photo.label, photo.canvasState.labelPosition ?? 'bottom-left', mode);
      return { kind: 'ok', dataUrl: canvas.toDataURL('image/jpeg', PDF_PHOTO_JPEG_QUALITY) };
    }
    try {
      // Loaded images are normally already cached by the editor grid; this
      // reuses them and falls back to a load if missing (e.g., off-screen).
      const cache = getImageCache();
      const image = await cache.getImageByUrl(photo.url);

      const canvas = document.createElement('canvas');
      canvas.width = PDF_PHOTO_TARGET_WIDTH;
      canvas.height = Math.round(PDF_PHOTO_TARGET_WIDTH / aspectRatio);

      // Pass undefined webglManager → forces CPU path. PDF generation is a
      // one-shot operation and we want a deterministic, high-quality result
      // without competing for the editor's WebGL context.
      await renderPhotoOnCanvas(
        canvas,
        image,
        photo.canvasState,
        photo.label,
        undefined,
        undefined,
        false,
        null,
        undefined,
        aspectRatio,
        BASE_WIDTH / aspectRatio,
        false,
        true,
        mode,
      );

      // Circle overlay (drawn after the photo, same as the live editor).
      const circle = photo.canvasState.circle;
      if (circle && circle.visible) {
        drawCircle(canvas, circle, canvas.width / BASE_WIDTH);
      }

      return { kind: 'ok', dataUrl: canvas.toDataURL('image/jpeg', PDF_PHOTO_JPEG_QUALITY) };
    } catch (error) {
      console.warn(`Failed to render hi-res photo for PDF (${photo.id}):`, error);
      // Last-resort fallback: scrape whatever the on-screen canvas has so
      // the PDF still produces output rather than failing the whole export.
      // Flagged as `degraded` so the caller can warn the user that some
      // photos printed at the lower live-grid resolution.
      try {
        const canvasElement = document.querySelector(`canvas[data-photo-id="${photo.id}"]`) as HTMLCanvasElement | null;
        if (canvasElement) {
          return {
            kind: 'degraded',
            dataUrl: canvasElement.toDataURL('image/jpeg', PDF_PHOTO_JPEG_QUALITY),
            photoId: photo.id,
          };
        }
      } catch {/* ignore */}
      return { kind: 'failed', photoId: photo.id, error };
    }
  };

  // Collected across the whole `generatePDF` run so the caller (UI button
  // handler) can surface a single combined alert at the end instead of one
  // per page. `failed` is the show-stopper case: cell would be blank.
  // `degraded` is the soft-warning case: cell is present but lower quality.
  const renderFailures: { photoId: string; error: unknown }[] = [];
  const renderDegraded: string[] = [];

  // Landscape pages render the rotated header on the left for 4:3 photos —
  // the FAI official answer-sheet ratio. A 3×3 grid of 4:3 photos is
  // height-constrained on A4 landscape (grid aspect 1.333 < page aspect
  // 1.415), so the grid already fills the page vertically with horizontal
  // slack on the sides. Moving the header into that side slack reclaims
  // the ~22pt top band, growing cells from ≈254×191pt to ≈261×196pt
  // (feedback 2026-05-12). Other aspect ratios keep the top band because
  // they don't have horizontal slack to host the rotated header.
  const useSideHeader = layoutMode === 'landscape' && Math.abs(aspectRatio - 4/3) < 1e-6;

  // Clean layout calculations
  // portraitGutterWidth: measured width of rotated header gutter (portrait mode)
  // landscapeHeaderHeight: measured header height (landscape mode)
  // headerTopPad: top padding for header text (default ~1mm)
  // pageCount: number of photos on this specific page — used to pick a
  // landscape grid (3×3 vs 5×2) for rally turning-point pages with 10
  // photos (feedback 2026-05-03). Defaults to a value that selects the
  // legacy 3×3 to keep all existing call-sites unchanged.
  const calculateLayout = (
    portraitGutterWidth: number = 15,
    landscapeHeaderExtent: number = 25,
    headerTopPad: number = 2.83,
    pageCount: number = 0,
    landscapeHeaderPlacement: 'top' | 'left' = 'top',
  ) => {
    if (layoutMode === 'portrait') {
      // A4 Portrait: 595 x 842 points
      const pageWidth = 595;
      const pageHeight = 842;
      const margin = 5; // keep small inner margin for rotated text stability
      const textWidth = portraitGutterWidth; // Width for rotated text along left edge (measured)
      const gap = 2.83; // 1mm in points
      
      // Available space for photos
      const availableWidth = pageWidth - (2 * margin) - textWidth;
      const availableHeight = pageHeight - (2 * margin);
      
      // Calculate photo size for 2x5 grid
      const photoWidth = Math.floor((availableWidth - gap) / 2);
      const photoHeight = Math.floor((availableHeight - (4 * gap)) / 5);
      
      // Ensure aspect ratio
      const correctedHeight = Math.min(photoHeight, photoWidth / aspectRatio);
      const correctedWidth = correctedHeight * aspectRatio;
      
      // Center the grid
      const totalWidth = (correctedWidth * 2) + gap;
      const totalHeight = (correctedHeight * 5) + (gap * 4);
      
      const startX = textWidth + margin + (availableWidth - totalWidth) / 2;
      const startY = margin + (availableHeight - totalHeight) / 2;
      
      return {
        photoWidth: correctedWidth,
        photoHeight: correctedHeight,
        startX,
        startY,
        gap,
        cols: 2,
        rows: 5,
        textX: 5, // Text position at left edge
        textY: pageHeight / 2 // Center vertically
      };
    } else {
      // Landscape grid math (3×3 vs 5×2 selection) lives in
      // `pdfLandscapeGrid.ts` so the boundary at pageCount >= 10 and the
      // centering arithmetic are unit-testable. Returns the same shape
      // the previous inline block produced.
      return calculateLandscapeGrid(aspectRatio, landscapeHeaderExtent, headerTopPad, pageCount, landscapeHeaderPlacement);
    }
  };


  // Simplified styles - no more text styling needed!
  const styles = StyleSheet.create({
    page: {
      backgroundColor: '#ffffff',
    }
  });

  // Create a single page (compute a local layout per page)
  const createPage = async (photoSet: ApiPhotoSet, setTitle: string, pageKey: string) => {
    const elements: any[] = [];
    // Per-page count drives the landscape rally turning-point grid
    // selection (3×3 vs 5×2). Other modes ignore it.
    const pageCount = photoSet.photos.length;
    let localLayout = calculateLayout(15, 25, 2.83, pageCount);
    
    // Add header/title
    const modeLabel = headerLabelFor(pageKey === 'set2' ? 'set2' : 'set1');
    if (layoutMode === 'portrait') {
      // Create rotated text as image - perfect Czech character support!
      // Prepend mode label, then setTitle | competitionName, then promo.
      const titleAndCompetition = setTitle && competitionName
        ? `${setTitle} | ${competitionName}`
        : setTitle || competitionName || '';
      const mergedTitleText = titleAndCompetition
        ? `${modeLabel} • ${titleAndCompetition}`
        : modeLabel;
      const promotionalText = BRANDING_ENABLED
        ? (t
          ? `${t('pdf.promotional.line1')} ${t('pdf.promotional.line2')}`
          : 'created using zavody.behounek.it')
        : '';
      const headerText = mergedTitleText
        ? (promotionalText ? `${mergedTitleText} • ${promotionalText}` : mergedTitleText)
        : promotionalText;
      const headerImage = createTextImage(headerText, true);
      if (headerImage) {
        // Recalculate layout with actual measured gutter width
        const measuredGutter = Math.max(15, Math.ceil(headerImage.width));
        localLayout = calculateLayout(measuredGutter, 25, 2.83, pageCount);
        // Calculate positioning to center along left edge
        const pageHeight = 842; // A4 portrait height
        const topPosition = (pageHeight - headerImage.height) / 2; // Center vertically
        
        elements.push(
          React.createElement(Image, {
            key: `header-${pageKey}`,
            src: headerImage.dataUrl,
            style: {
              position: 'absolute',
              left: 2, // Close to left edge
              top: topPosition,
              width: headerImage.width, // Use actual canvas width
              height: headerImage.height, // Use actual canvas height
            }
          })
        );
      }
    } else if (useSideHeader) {
      // Landscape + 4:3 → rotated header in a left gutter (same idea as
      // portrait). Concatenates the same mode label + setTitle |
      // competition string so the printed sheet reads identically; the
      // promo line is omitted in side-mode because there is no horizontal
      // band left to host it without overlapping the photo grid.
      const titleAndCompetition = setTitle && competitionName
        ? `${setTitle} | ${competitionName}`
        : setTitle || competitionName || '';
      const mergedTitleText = titleAndCompetition
        ? `${modeLabel} • ${titleAndCompetition}`
        : modeLabel;
      const promotionalText = BRANDING_ENABLED
        ? (t
          ? `${t('pdf.promotional.line1')} ${t('pdf.promotional.line2')}`
          : 'created using zavody.behounek.it')
        : '';
      const headerText = mergedTitleText
        ? (promotionalText ? `${mergedTitleText} • ${promotionalText}` : mergedTitleText)
        : promotionalText;
      // 14pt font for the rotated landscape header — the gutter is short
      // (~595pt of vertical room) so we can afford a slightly larger size
      // than portrait (which defaults to 18pt but has 842pt to play with).
      const headerImage = createTextImage(headerText, true, 14);
      if (headerImage) {
        const headerTopPad = 2.83; // ~1mm from the left edge
        const measuredGutter = Math.max(15, Math.ceil(headerImage.width));
        localLayout = calculateLayout(15, measuredGutter, headerTopPad, pageCount, 'left');
        // Center the rasterised header image vertically within the page —
        // the image is taller than its text (MIN_ROTATED_HEIGHT=400) but
        // the text is drawn at the image's centre, so centering the
        // image centers the text.
        const pageHeight = 595; // A4 landscape height
        const topPosition = (pageHeight - headerImage.height) / 2;
        elements.push(
          React.createElement(Image, {
            key: `header-${pageKey}`,
            src: headerImage.dataUrl,
            style: {
              position: 'absolute',
              left: localLayout.headerX,
              top: topPosition,
              width: headerImage.width,
              height: headerImage.height,
            }
          })
        );
      }
    } else {
      // Horizontal header as images (landscape, non-4:3) — prepend the mode
      // label so the reader can tell at a glance what kind of sheet they're
      // holding. 4:3 photos use the side-header branch above to reclaim the
      // ~22pt the top band would otherwise eat (feedback 2026-05-12).
      const titleAndCompetition = setTitle && competitionName
        ? `${setTitle} | ${competitionName}`
        : setTitle || competitionName || '';
      const mergedTitleText = titleAndCompetition
        ? `${modeLabel} • ${titleAndCompetition}`
        : modeLabel;
      // 11pt header font keeps the top band tight (~23pt) for non-4:3
      // ratios that still use it. Originally reduced from 18pt (feedback
      // 2026-05-10) when 3:2 used this branch — kept at 11pt because the
      // smaller band is the right default for 16:9 and any future ratio.
      const mergedTitleImage = createTextImage(mergedTitleText, false, 11);

      // Create two-line promotional text with half the font size
      const promotionalLines = BRANDING_ENABLED
        ? (t
          ? [t('pdf.promotional.line1'), t('pdf.promotional.line2')]
          : ['created using', 'zavody.behounek.it'])
        : null;
      const promotionalImage = promotionalLines ? createMultilineTextImage(promotionalLines, 9) : null;

      // Measure header height and recompute layout to avoid overlap
      const headerTopPad = 2.83; // ~1mm from the top edge
      const measuredHeaderHeight = Math.max(
        mergedTitleImage?.height || 0,
        promotionalImage?.height || 0
      );
      localLayout = calculateLayout(15, measuredHeaderHeight, headerTopPad, pageCount);

      if (mergedTitleImage) {
        // Place merged title at top-left
        elements.push(
          React.createElement(Image, {
            key: `merged-title-${pageKey}`,
            src: mergedTitleImage.dataUrl,
            style: {
              position: 'absolute',
              left: headerTopPad, // ~1mm from left edge
              top: localLayout.headerY,
              width: mergedTitleImage.width,
              height: mergedTitleImage.height,
            }
          })
        );
      }

      if (promotionalImage) {
        // Place two-line promotional text on the right
        elements.push(
          React.createElement(Image, {
            key: `promotional-${pageKey}`,
            src: promotionalImage.dataUrl,
            style: {
              position: 'absolute',
              right: headerTopPad, // ~1mm from right edge
              top: localLayout.headerY,
              width: promotionalImage.width,
              height: promotionalImage.height,
            }
          })
        );
      }
    }
    
    // Render hi-res photo data URLs in parallel — each photo is independent
    // and `renderPhotoOnCanvas` is async due to the optional `intelligentResize`.
    const photoCount = localLayout.rows * localLayout.cols;
    const photosToRender = photoSet.photos.slice(0, photoCount);
    const renderResults: (PhotoRenderResult | null)[] = await Promise.all(
      photosToRender.map((p) => (p ? getPhotoDataUrl(p) : Promise.resolve(null)))
    );

    // Add photos. Use the tagged result so render failures don't silently
    // omit cells from the printed sheet — failures get tracked at the
    // generatePDF level and surfaced to the user as a single combined alert
    // after both pages have rendered.
    for (let row = 0; row < localLayout.rows; row++) {
      for (let col = 0; col < localLayout.cols; col++) {
        const index = row * localLayout.cols + col;
        const photo = photoSet.photos[index];

        if (photo) {
          const result = renderResults[index];
          if (!result) continue; // index past photos[].length; not a failure
          if (result.kind === 'failed') {
            renderFailures.push({ photoId: result.photoId, error: result.error });
            continue;
          }
          if (result.kind === 'degraded') {
            renderDegraded.push(result.photoId);
          }
          {
            const x = localLayout.startX + col * (localLayout.photoWidth + localLayout.gap);
            const y = localLayout.startY + row * (localLayout.photoHeight + localLayout.gap);
            
            elements.push(
              React.createElement(Image, {
                key: `photo-${pageKey}-${index}`,
                src: result.dataUrl,
                style: {
                  position: 'absolute',
                  left: x,
                  top: y,
                  width: localLayout.photoWidth,
                  height: localLayout.photoHeight,
                }
              })
            );
          }
        }
      }
    }
    
    return React.createElement(Page, {
      key: pageKey,
      size: 'A4',
      orientation: layoutMode,
      style: styles.page
    }, elements);
  };

  // Create document
  const pages = [];

  if (set1.photos.length > 0) {
    pages.push(await createPage(set1, set1.title, 'set1'));
  }

  if (set2.photos.length > 0) {
    pages.push(await createPage(set2, set2.title, 'set2'));
  }

  const pdfDocument = React.createElement(Document, {}, pages);

  // Surface per-photo render failures BEFORE we ship a partial PDF to the
  // user. Previously a thrown render would log a console.warn and produce a
  // PDF with silently blank cells — for an FAI answer-sheet, that's a
  // correctness bug (feedback 2026-05-12). Caller (UI button handler) is
  // expected to wrap `generatePDF` in try/catch and alert on this error.
  if (renderFailures.length > 0) {
    const ids = renderFailures.map(f => f.photoId).join(', ');
    const err = new Error(
      `PDF export aborted: ${renderFailures.length} photo(s) failed to render (${ids}). ` +
      `Re-open the affected photos and try again.`,
    );
    // Attach the underlying error array for callers that want to log or
    // present the original cause chain.
    (err as Error & { renderFailures?: unknown[] }).renderFailures = renderFailures;
    throw err;
  }
  // Degraded path: hi-res render failed but the on-screen fallback succeeded,
  // so the PDF still has every cell — just at the lower live-grid resolution
  // for the affected ids. Log so this shows up in DevTools without blocking
  // the export; UI can decide whether to surface a soft warning.
  if (renderDegraded.length > 0) {
    console.warn(
      `[generatePDF] ${renderDegraded.length} photo(s) used the DOM-canvas fallback (lower resolution): ${renderDegraded.join(', ')}`,
    );
  }

  // Generate and download
  try {
    const blob = await pdf(pdfDocument).toBlob();
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

    // Mode-aware download name so a folder of exports stays sortable —
    // feedback 2026-04-23: distinguish enroute (track) PDFs from
    // turning-point PDFs in the file name itself.
    // Feedback 2026-05-10: also embed the slugified competition name when
    // we have one, so a folder containing exports from several events stays
    // self-identifying. The timestamp stays in the suffix because users
    // re-export multiple times during prep and want to disambiguate runs.
    const filenamePrefix = mode === 'turningpoint' ? 'tp-photos' : 'enroute-photos';
    const competitionSlug = competitionName ? slugifyForFilename(competitionName) : '';
    const fileName = competitionSlug
      ? `${filenamePrefix}-${competitionSlug}-${timestamp}.pdf`
      : `${filenamePrefix}-${timestamp}.pdf`;

    // Prefer the Electron save dialog when running inside the desktop
    // bundle so the file lands in the competition's working folder
    // (feedback 2026-04-25). Fall back to the browser download path —
    // used in the web build and as a safety net if the IPC throws.
    const api = (typeof window !== 'undefined') ? (window as any).electronAPI : null;
    if (api && typeof api.savePdf === 'function') {
      try {
        let workingDir: string | null = null;
        if (competitionId && api.competitions?.getWorkingDir) {
          workingDir = await api.competitions.getWorkingDir(competitionId);
        }
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // strip `data:application/pdf;base64,` prefix
            resolve(result.split(',')[1] || '');
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        const savedPath: string | null = await api.savePdf(base64, fileName, workingDir || undefined);
        // Promote the directory the user actually picked to the
        // competition's working folder. Lets the user *steer* the default
        // for the next save dialog by simply navigating in this one
        // (feedback 2026-04-25). Shared `dirnameOf` handles drive-letter
        // roots, POSIX root, UNC, and trailing-separator edge cases.
        if (savedPath && competitionId && api.competitions?.setWorkingDir) {
          const dir = dirnameOf(savedPath);
          if (dir) {
            api.competitions.setWorkingDir(competitionId, dir).catch((err: unknown) => {
              console.warn('[workingDir] persist failed:', err);
            });
          }
        }
        return;
      } catch (err) {
        console.error('electronAPI.savePdf failed, falling back to browser download:', err);
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    // Defer revocation to avoid aborting download (e.g., Safari)
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error('PDF generation failed:', error);
    throw error;
  }
};