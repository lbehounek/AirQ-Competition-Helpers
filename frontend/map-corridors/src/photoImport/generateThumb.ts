// Phase 1b of photo-map-culling: thumbnail synthesis.
// See docs/photo-map-culling/implementation-plan.md.

export interface GenerateThumbOpts {
  /** Maximum thumbnail width in pixels. Default 200 (popup size). */
  maxWidth?: number
  /** Maximum thumbnail height in pixels. Default 150 (popup size). */
  maxHeight?: number
  /** JPEG quality 0..1. Default 0.7 (good for ~150-line popup thumbs). */
  quality?: number
}

const DEFAULTS = { maxWidth: 200, maxHeight: 150, quality: 0.7 } as const

/**
 * Generate a small JPEG thumbnail from any image File the browser can
 * decode. EXIF Orientation is applied automatically by the browser via
 * `createImageBitmap({ imageOrientation: 'from-image' })` per ADR-015
 * — no manual rotation logic, no Orientation=6/8 special-casing in our
 * code. Aspect ratio is preserved (contain-fit inside maxWidth × maxHeight).
 *
 * Throws on corrupt input (createImageBitmap rejects), missing
 * OffscreenCanvas 2D context, or convertToBlob failure. Callers in
 * importPhotoFiles catch these and route to the per-photo failure list.
 */
export async function generateThumb(file: File, opts: GenerateThumbOpts = {}): Promise<Blob> {
  const { maxWidth, maxHeight, quality } = { ...DEFAULTS, ...opts }
  if (maxWidth <= 0 || maxHeight <= 0) {
    throw new Error(`generateThumb: invalid bounds maxWidth=${maxWidth} maxHeight=${maxHeight}`)
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { width: srcW, height: srcH } = bitmap
    if (srcW <= 0 || srcH <= 0) {
      throw new Error(`generateThumb: decoded bitmap has zero dimension (${srcW}x${srcH})`)
    }
    const { width: targetW, height: targetH } = fitWithin(srcW, srcH, maxWidth, maxHeight)
    const canvas = new OffscreenCanvas(targetW, targetH)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('generateThumb: OffscreenCanvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0, targetW, targetH)
    return await canvas.convertToBlob({ type: 'image/jpeg', quality })
  } finally {
    bitmap.close()
  }
}

/**
 * Compute contain-fit dimensions: largest size that fits inside the bounds
 * while preserving aspect ratio. Returns integer pixels (rounded down so we
 * never exceed bounds). Exported for unit testing — pure math, no globals.
 */
export function fitWithin(
  srcW: number,
  srcH: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  const ratio = srcW / srcH
  if (srcW <= maxW && srcH <= maxH) return { width: srcW, height: srcH }
  const widthCappedH = maxW / ratio
  if (widthCappedH <= maxH) {
    return { width: maxW, height: Math.max(1, Math.floor(widthCappedH)) }
  }
  return { width: Math.max(1, Math.floor(maxH * ratio)), height: maxH }
}
