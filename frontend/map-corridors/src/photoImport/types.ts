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

export interface ImportedPhoto {
  photoId: string
  file: File
  thumbnail: Blob
  exif: ExifData
  // SHA-1 hex of the file bytes — used by importPhotoFiles for re-import
  // dedup per ADR-020. Computed in parallel with EXIF + thumb generation.
  contentHash: string
}

export type ImportFailureReason = 'heic' | 'corrupt' | 'unsupported' | 'storage'

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
