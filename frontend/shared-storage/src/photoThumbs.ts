// Phase 2 of photo-map-culling: thumbnail storage helpers.
// See docs/photo-map-culling/implementation-plan.md.
//
// These functions encapsulate the "thumbs are just photos in a subdir"
// pattern so both OPFSStorage and ElectronStorage delegate to identical
// behaviour without duplicating the subdir-navigation + filename rules.
//
// Thumb SYNTHESIS (`generateThumb` / `fitWithin`, below) also lives here so
// photo-helper and map-corridors share ONE implementation: neither app may
// import from the other, and shared-storage is the only package both already
// depend on. It is the natural home anyway — this module already owns the
// thumb storage contract (`thumbs/{id}.jpg`, JPEG bytes), and synthesis is
// what produces those bytes.

import type { StorageInterface, DirectoryHandle } from './types';

/** Filename inside `thumbs/`. `.jpg` extension matches the generated MIME. */
function thumbFilename(photoId: string): string {
  return `${photoId}.jpg`;
}

/**
 * Save a thumbnail blob into the `thumbs/` subdirectory of the photos
 * directory. The subdirectory is created on demand.
 */
export async function savePhotoThumb(
  storage: StorageInterface,
  photosDir: DirectoryHandle,
  photoId: string,
  blob: Blob,
): Promise<void> {
  const thumbsDir = await storage.getDirectoryHandle(photosDir, 'thumbs', { create: true });
  const filename = thumbFilename(photoId);
  // savePhotoFile takes a File; wrap the Blob. Default to image/jpeg
  // because generateThumb always emits JPEG and an empty MIME on the
  // Blob would surface as application/octet-stream in some callers.
  const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
  await storage.savePhotoFile(thumbsDir, filename, file);
}

// NotFoundError is the only "absence" condition that should silently
// resolve to null/undefined; anything else (permission revoked, OPFS
// InvalidStateError, quota issues, type errors) is a real failure and
// must surface so callers can react.
function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  return name === 'NotFoundError';
}

/**
 * Read a thumbnail blob. Returns null when the `thumbs/` subdirectory
 * does not exist OR when the specific thumb file is missing — callers
 * regenerate from the original photo on miss. Other errors propagate.
 */
export async function getPhotoThumb(
  storage: StorageInterface,
  photosDir: DirectoryHandle,
  photoId: string,
): Promise<Blob | null> {
  try {
    const thumbsDir = await storage.getDirectoryHandle(photosDir, 'thumbs', { create: false });
    return await storage.getPhotoBlob(thumbsDir, thumbFilename(photoId));
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/**
 * Delete a thumbnail. Idempotent for "already gone" — does NOT throw
 * when the thumb or the `thumbs/` subdirectory does not exist. Cleanup
 * paths (failed import, photo rejection) shouldn't fail on already-
 * deleted state. Other errors propagate.
 */
export async function deletePhotoThumb(
  storage: StorageInterface,
  photosDir: DirectoryHandle,
  photoId: string,
): Promise<void> {
  try {
    const thumbsDir = await storage.getDirectoryHandle(photosDir, 'thumbs', { create: false });
    await storage.deletePhotoFile(thumbsDir, thumbFilename(photoId));
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw err;
  }
}


// ---------------------------------------------------------------------------
// Thumbnail synthesis
// ---------------------------------------------------------------------------

export interface GenerateThumbOpts {
  /** Maximum thumbnail width in pixels. Default 200 (map popup size). */
  maxWidth?: number;
  /** Maximum thumbnail height in pixels. Default 150 (map popup size). */
  maxHeight?: number;
  /** JPEG quality 0..1. Default 0.7 (good for ~150-line popup thumbs). */
  quality?: number;
  /**
   * Opt-in: forwarded to `createImageBitmap` as `resizeWidth` (together with
   * `resizeQuality: 'high'`) so the bitmap factory can downsize DURING decode
   * instead of materialising the full-resolution bitmap first. Height is
   * derived by the browser from the source aspect ratio — we deliberately do
   * NOT pass `resizeHeight`, because with both members present the spec
   * stretches the bitmap to exactly that box and drops the aspect ratio.
   *
   * Leave undefined to keep the historical behaviour (map-corridors' import
   * path): the createImageBitmap options object is then EXACTLY
   * `{ imageOrientation: 'from-image' }`.
   *
   * Correctness never depends on this: `fitWithin` + `drawImage` still run on
   * whatever bitmap comes back, so an implementation that ignores the hint
   * only costs a bigger transient.
   */
  decodeResizeWidth?: number;
}

const DEFAULTS = { maxWidth: 200, maxHeight: 150, quality: 0.7 } as const;

/**
 * Generate a small JPEG thumbnail from any image the browser can decode.
 *
 * Returns a JPEG `Blob` sized to contain-fit inside `maxWidth × maxHeight`.
 * EXIF Orientation is applied automatically via
 * `createImageBitmap({ imageOrientation: 'from-image' })` per ADR-015 — no
 * manual rotation logic, no Orientation=6/8 special-casing in our code.
 *
 * Takes a `Blob` (a `File` is a `Blob`, so import paths passing a File keep
 * working) because photo-helper feeds it bytes fetched from an in-memory
 * `blob:` URL, which is a plain Blob.
 *
 * Throws on corrupt input (createImageBitmap rejects), a zero-dimension
 * decode, a missing OffscreenCanvas 2D context, or convertToBlob failure.
 * Callers route these to their own per-photo failure handling
 * (importPhotoFiles' failure list; the tray's fall-back-to-source-image path).
 */
export async function generateThumb(source: Blob, opts: GenerateThumbOpts = {}): Promise<Blob> {
  const { maxWidth, maxHeight, quality } = { ...DEFAULTS, ...opts };
  if (maxWidth <= 0 || maxHeight <= 0) {
    throw new Error(`generateThumb: invalid bounds maxWidth=${maxWidth} maxHeight=${maxHeight}`);
  }

  // Built as a conditional object (not a spread with `undefined` members) so
  // the default branch passes EXACTLY `{ imageOrientation: 'from-image' }` —
  // map-corridors' generateThumb.test.ts asserts that exact shape.
  const bitmapOpts: ImageBitmapOptions =
    opts.decodeResizeWidth === undefined
      ? { imageOrientation: 'from-image' }
      : {
          imageOrientation: 'from-image',
          resizeWidth: opts.decodeResizeWidth,
          resizeQuality: 'high',
        };

  const bitmap = await createImageBitmap(source, bitmapOpts);
  try {
    const { width: srcW, height: srcH } = bitmap;
    if (srcW <= 0 || srcH <= 0) {
      throw new Error(`generateThumb: decoded bitmap has zero dimension (${srcW}x${srcH})`);
    }
    const { width: targetW, height: targetH } = fitWithin(srcW, srcH, maxWidth, maxHeight);
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('generateThumb: OffscreenCanvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality });
  } finally {
    // Always release the decoded bitmap — a 24 MP source is ~100 MB of GPU/
    // heap memory that would otherwise wait for GC.
    bitmap.close();
  }
}

/**
 * Compute contain-fit dimensions: largest size that fits inside the bounds
 * while preserving aspect ratio. Returns integer pixels (rounded DOWN so we
 * never exceed the bounds) and never returns a zero dimension. Exported for
 * unit testing — pure math, no globals.
 */
export function fitWithin(
  srcW: number,
  srcH: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  const ratio = srcW / srcH;
  if (srcW <= maxW && srcH <= maxH) return { width: srcW, height: srcH };
  const widthCappedH = maxW / ratio;
  if (widthCappedH <= maxH) {
    return { width: maxW, height: Math.max(1, Math.floor(widthCappedH)) };
  }
  return { width: Math.max(1, Math.floor(maxH * ratio)), height: maxH };
}
