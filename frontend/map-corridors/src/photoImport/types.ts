// Photo-map-culling import-pipeline types (Phase 1).
// See docs/photo-map-culling/implementation-plan.md.

export interface ExifGps {
  lng: number
  lat: number
  altitude?: number
}

export interface ExifData {
  capturedAt?: ExifGps
  timestamp?: string
  orientation?: number
}

// Thrown by extractExif when the file's content magic bytes identify it as
// HEIC/HEIF, regardless of filename extension. Per ADR-006 v1 rejects HEIC.
export class HeicNotSupportedError extends Error {
  override readonly name = 'HeicNotSupportedError'
  constructor(filename?: string) {
    super(filename ? `HEIC is not supported: ${filename}` : 'HEIC is not supported')
  }
}

/**
 * True when an error means "these bytes could not be READ", as opposed to
 * "these bytes are not parseable EXIF".
 *
 * The distinction matters because the two are silently interchangeable
 * otherwise: a photo whose read failed has no GPS *as far as the parser can
 * tell*, so it would be filed under "Bez GPS" next to photos that genuinely
 * carry no coordinates — the organizer sees a GPS-tagged photo land in the
 * no-GPS tray with no explanation (client feedback 2026-07-23).
 *
 * Two shapes count, because the platform reports the same failure two ways:
 *  - `DOMException` — what `Blob.arrayBuffer()` / `Blob.text()` reject with
 *    (`NotReadableError` when the OS handle went away: a file moved or locked
 *    mid-import, a flaky network drive, an ejected SD card). This is the path
 *    `extractExif` now takes deliberately.
 *  - a `FileReader` error `ProgressEvent` — what `FileReader.onerror` hands to
 *    a promise `reject`. The `DOMException` is left on `reader.error` and the
 *    event carries it only via `target`. Libraries that read with `FileReader`
 *    (exifr does, in `readBlobAsArrayBuffer`) surface failures this way, so
 *    matching only `DOMException` here silently misses them.
 *
 * Genuine parse failures — corrupt JPEG, no EXIF segment — are plain `Error`s
 * and must NOT match.
 */
export function isUnreadableFileError(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) return true
  // Duck-typed rather than `instanceof ProgressEvent`: the event may come from
  // another realm, and jsdom/test doubles don't always provide the global.
  const evt = err as { type?: unknown; target?: { error?: unknown } } | null
  return !!evt && evt.type === 'error' && !!evt.target && 'error' in evt.target
}

export interface ImportedPhoto {
  photoId: string
  file: File
  thumbnail: Blob
  exif: ExifData
  // SHA-1 hex of the file bytes — used by importPhotoFiles for re-import
  // dedup per ADR-020. Computed in parallel with EXIF + thumb generation.
  contentHash: string
}

export type ImportFailureReason = 'heic' | 'corrupt' | 'unsupported' | 'storage' | 'read'

export interface ImportFailure {
  filename: string
  reason: ImportFailureReason
  message: string
}

/** A file skipped because its bytes match an already-imported photo (ADR-020). */
export interface ImportDuplicate {
  filename: string
  /** SHA-1 hex that matched an existing photo (or an earlier file in the batch). */
  contentHash: string
}

export interface ImportResult {
  ok: ImportedPhoto[]
  failed: ImportFailure[]
  /**
   * Files dropped as re-imports of a photo already in the session, or duplicated
   * within the same batch. Populated by `importPhotosToStorage` (which has the
   * existing-hash set); `importPhotoFiles` alone never dedups, so it omits this.
   * Duplicates are NOT saved — the original photo is preserved untouched.
   */
  duplicates?: ImportDuplicate[]
}
