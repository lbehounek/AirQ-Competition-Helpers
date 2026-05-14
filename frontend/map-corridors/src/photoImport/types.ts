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

export type ImportFailureReason = 'heic' | 'corrupt' | 'unsupported'

export interface ImportFailure {
  filename: string
  reason: ImportFailureReason
  message: string
}

export interface ImportResult {
  ok: ImportedPhoto[]
  failed: ImportFailure[]
}
