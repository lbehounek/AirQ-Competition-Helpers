// Serializer for the photo-import pipeline. Follow-up to ADR-020 re-import
// dedup; see docs/photo-map-culling/ for the pipeline as a whole.
//
// WHY THIS EXISTS
// The dropzone (App.tsx `onDrop`) and the hidden file input both stay live for
// the whole duration of an import — nothing is disabled, only a progress bar
// appears. Organizers re-drop, because a 200-photo batch spends seconds on EXIF
// + thumbnail + SHA-1 work before a single marker shows up. Two overlapping
// `handlePhotoFiles` runs each built their ADR-020 dedup set before the other
// committed, so the same file was imported twice under two random `pm-` ids:
// two blobs, two thumbs, two markers, two rows in the editor handoff.
//
// REJECTED ALTERNATIVE: an "import already running" boolean that ignores the
// second drop. That trades a duplicate for a SILENT DATA LOSS — the organizer's
// photos simply never appear and no error is shown. Queueing keeps every file
// and makes the ordering deterministic: batch N builds its dedup set strictly
// after batch N-1 has committed, so a re-drop is correctly reported as
// duplicates instead of being imported again.
//
// The ordering itself comes from `createSerialQueue` (utils/serialQueue) — the
// same primitive the session writer uses. Everything below is the part that is
// SPECIFIC to imports: aggregating progress across batches so a drop that lands
// mid-import moves the bar immediately instead of sitting there invisibly.
import { createSerialQueue } from '../utils/serialQueue'

/** Aggregate progress across every batch currently queued or running. */
export interface ImportProgress {
  done: number
  total: number
}

export interface ImportQueue {
  /**
   * Queue one batch of `count` files behind everything already queued.
   *
   * `task` receives `report(doneInBatch)` — a running count WITHIN its own batch
   * (exactly the shape `importPhotoFiles` already emits). The queue converts it
   * to a delta against the burst-wide totals, so a batch waiting in line still
   * contributes its files to the visible total immediately.
   *
   * Returns a promise settling when THIS batch finished, so callers can still
   * `await` their own import. A rejection propagates to that caller but never
   * wedges the chain — one failed import must not cancel the photos the user
   * queued behind it.
   */
  enqueue(count: number, task: (report: (doneInBatch: number) => void) => Promise<void>): Promise<void>
  /** Batches queued or running right now. `0` = idle. */
  readonly pending: number
}

/**
 * Create an import queue. `onProgress` is called with the burst-wide aggregate
 * on every change, and with `null` the moment the queue drains — wire it
 * straight to the `importProgress` setState.
 */
export function createImportQueue(
  onProgress: (progress: ImportProgress | null) => void,
): ImportQueue {
  const runSerially = createSerialQueue()
  // Counters spanning the whole burst (everything queued + running). They reset
  // to zero the instant the queue drains, so the NEXT import starts at 0/N
  // instead of inheriting the previous burst's totals.
  let done = 0
  let total = 0
  let pending = 0

  /** Publish the aggregate, or `null` once nothing is queued or running. */
  const emit = () => onProgress(pending === 0 ? null : { done, total })

  function enqueue(
    count: number,
    task: (report: (doneInBatch: number) => void) => Promise<void>,
  ): Promise<void> {
    // Count the batch in SYNCHRONOUSLY, before awaiting anything. A drop landing
    // mid-import has to move the bar in the same tick — a queued batch showing no
    // feedback at all is what makes the user drop a third time.
    total += count
    pending += 1
    emit()

    // Batch-local running count, converted to a delta so stacked batches add up
    // instead of overwriting each other. Clamped to [reported, count] so a task
    // that reports out of order, or over-reports, can never push `done` past
    // `total` and render a "27 of 24" bar.
    let reported = 0
    const report = (doneInBatch: number) => {
      const next = Math.min(Math.max(doneInBatch, reported), count)
      if (next === reported) return
      done += next - reported
      reported = next
      emit()
    }

    return runSerially(async () => {
      try {
        await task(report)
      } finally {
        // Reconcile: a task that threw half-way still consumed its whole slot.
        // Without this, `done` never reaches `total` and the bar sticks below
        // 100% for the rest of the burst.
        report(count)
        pending -= 1
        if (pending === 0) {
          done = 0
          total = 0
        }
        emit()
      }
    })
  }

  return {
    enqueue,
    get pending() { return pending },
  }
}
