// Phase 1c of photo-map-culling: pipeline orchestrator.
// See docs/photo-map-culling/implementation-plan.md.

import { extractExif } from './extractExif'
import { generateThumb } from './generateThumb'
import type {
  ImportedPhoto,
  ImportFailure,
  ImportResult,
} from './types'
import { HeicNotSupportedError } from './types'

export interface ImportPhotoFilesOpts {
  /** Max parallel files. Default 8 per ADR-014. */
  concurrency?: number
  /** Called after each file completes (success or failure). */
  onProgress?: (done: number, total: number) => void
}

// Image MIME types we accept. PNG is included because some screenshot
// pipelines write GPS as a sidecar; we still try to extract EXIF from
// PNGs (some tools embed it in eXIf chunks).
const SUPPORTED_MIMES = new Set(['image/jpeg', 'image/png'])
const SUPPORTED_EXT_RX = /\.(jpe?g|png)$/i

function isSupportedImage(file: File): boolean {
  if (SUPPORTED_MIMES.has(file.type)) return true
  // Some drag-drop sources (older Electron, drag from a network share)
  // surface files with empty `type`. Fall back to filename extension.
  if (file.type === '' && SUPPORTED_EXT_RX.test(file.name)) return true
  return false
}

function makePhotoId(): string {
  // `pm-` prefix marks the photo as map-originated per ADR-005. Photo-helper
  // uses the prefix to decide whose canonical record an entry belongs to.
  return `pm-${crypto.randomUUID()}`
}

async function computeContentHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-1', buf)
  const bytes = new Uint8Array(hash)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

function classifyFailure(err: unknown): ImportFailure['reason'] {
  if (err instanceof HeicNotSupportedError) return 'heic'
  return 'corrupt'
}

/**
 * Import a batch of files. Concurrency-limited at `opts.concurrency`
 * (default 8). Failures are isolated per file — one corrupt JPEG does
 * not abort the rest of the batch (ADR-013).
 *
 * Unsupported MIME types and HEIC content are reported as failures with
 * distinct `reason` codes so the caller can show targeted toasts.
 */
export async function importPhotoFiles(
  files: File[],
  opts: ImportPhotoFilesOpts = {},
): Promise<ImportResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 8)
  const ok: ImportedPhoto[] = []
  const failed: ImportFailure[] = []
  let done = 0

  const reportProgress = () => {
    done++
    opts.onProgress?.(done, files.length)
  }

  // Pre-filter — non-images never enter the worker pool.
  const queue: File[] = []
  for (const f of files) {
    if (isSupportedImage(f)) {
      queue.push(f)
    } else {
      failed.push({
        filename: f.name,
        reason: 'unsupported',
        message: `Unsupported file type: ${f.type || f.name}`,
      })
      reportProgress()
    }
  }

  // Cooperative worker pool. Each worker pulls the next index until the
  // queue drains. JS single-threadedness makes `nextIdx++` atomic.
  let nextIdx = 0
  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIdx++
      if (idx >= queue.length) return
      const file = queue[idx]
      try {
        const [exif, thumbnail, contentHash] = await Promise.all([
          extractExif(file),
          generateThumb(file),
          computeContentHash(file),
        ])
        ok.push({
          photoId: makePhotoId(),
          file,
          thumbnail,
          exif,
          contentHash,
        })
      } catch (err) {
        failed.push({
          filename: file.name,
          reason: classifyFailure(err),
          message: err instanceof Error ? err.message : String(err),
        })
      } finally {
        reportProgress()
      }
    }
  }

  const workerCount = Math.min(concurrency, queue.length)
  if (workerCount === 0) return { ok, failed }

  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)
  return { ok, failed }
}
