// Phase 3 of photo-map-culling: dropzone → storage orchestrator.
// See docs/photo-map-culling/implementation-plan.md.
//
// Thin layer that composes Phase 1's pure import pipeline with Phase 2's
// thumbnail-aware storage layer. The function takes a resolved
// `photosDir` so the caller can decide where to write (per-competition).

import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import { importPhotoFiles } from './importPhotoFiles'
import type { ImportPhotoFilesOpts } from './importPhotoFiles'
import type { ImportDuplicate, ImportResult } from './types'

export interface ImportPhotosToStorageOpts extends ImportPhotoFilesOpts {
  /**
   * SHA-1 hashes already present in the session (markers + no-GPS tray). A
   * freshly-read file whose hash matches one of these — or an earlier file in
   * the SAME batch — is reported in `result.duplicates` and NOT saved, so the
   * existing photo (and its placement / flag / edits) is preserved and no orphan
   * blob is written. ADR-020 re-import dedup. Omit to disable cross-session
   * dedup; intra-batch dedup always runs.
   */
  existingContentHashes?: ReadonlySet<string>
}

/**
 * Run the Phase 1 import pipeline, then persist each successful import
 * to OPFS/Electron storage:
 *   - photosDir/{photoId}         ← original bytes
 *   - photosDir/thumbs/{photoId}.jpg  ← generated thumbnail
 *
 * A photo whose blob+thumb both write OK stays in `result.ok`. Storage
 * failures (quota, disk error) demote the photo to `result.failed` with
 * `reason: 'storage'`. The thumbnail write is attempted only after the
 * original bytes are safely on disk — partial thumb writes are cleaned
 * up on original-write failure (rare, but matches the ADR-013
 * atomic-per-photo guarantee).
 */
export async function importPhotosToStorage(
  storage: StorageInterface,
  photosDir: DirectoryHandle,
  files: File[],
  opts: ImportPhotosToStorageOpts = {},
): Promise<ImportResult> {
  const result = await importPhotoFiles(files, opts)

  // ADR-020 re-import dedup. Drop any read whose content hash already exists in
  // the session, or repeats within this batch, BEFORE saving — so a duplicate
  // never writes a second blob and never produces a second marker / tray entry.
  // `seen` is seeded with the session's hashes; each kept file adds its own so a
  // file dropped twice in one batch only lands once.
  const seen = new Set<string>(opts.existingContentHashes ?? [])
  const duplicates: ImportDuplicate[] = []
  const fresh: ImportResult['ok'] = []
  for (const photo of result.ok) {
    if (seen.has(photo.contentHash)) {
      duplicates.push({ filename: photo.file.name, contentHash: photo.contentHash })
    } else {
      seen.add(photo.contentHash)
      fresh.push(photo)
    }
  }
  result.ok = fresh
  if (duplicates.length > 0) result.duplicates = duplicates

  if (result.ok.length === 0) return result

  const persisted = await Promise.all(result.ok.map(async (photo) => {
    try {
      await storage.savePhotoFile(photosDir, photo.photoId, photo.file)
      try {
        await storage.savePhotoThumb(photosDir, photo.photoId, photo.thumbnail)
      } catch (thumbErr) {
        // Original landed, thumb didn't. Roll back the original so the
        // next import (or the user retrying) gets a clean state.
        await storage.deletePhotoFile(photosDir, photo.photoId).catch(() => {})
        throw thumbErr
      }
      return { ok: true as const, photo }
    } catch (err) {
      return {
        ok: false as const,
        photo,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }))

  const newOk: ImportResult['ok'] = []
  for (const r of persisted) {
    if (r.ok) {
      newOk.push(r.photo)
    } else {
      result.failed.push({
        filename: r.photo.file.name,
        reason: 'storage',
        message: r.message,
      })
    }
  }
  result.ok = newOk
  return result
}
