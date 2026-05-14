// Phase 8a of photo-map-culling — cross-app handoff writer.
// See ADR-005 (one-way map-picks.json) + ADR-019 (upsert/delete) +
// docs/photo-map-culling/implementation-plan.md Phase 8.
//
// Map-corridors writes its full picks snapshot to
// `competitions/{compId}/map-picks.json`. Photo-helper reads it (Phase 8b,
// not yet implemented) to project picks into its candidate tray.
//
// Single writer; rapid calls coalesce on a 300ms debounce. Pagehide /
// pre-nav code paths call flushPendingMapPicks() to skip the wait.

import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import type { PhotoLabel, PhotoMarker } from '../types/markers'

const FILENAME = 'map-picks.json'
const DEBOUNCE_MS = 300

export interface MapPickEntry {
  photoId: string
  filename: string
  // 'neutral' is materialized at write time (PhotoMarker stores flag only
  // for 'pick'/'reject'; absent flag means neutral). Photo-helper reads
  // the explicit value, simpler than branching on absence.
  flag: 'pick' | 'neutral' | 'reject'
  gps?: {
    capturedAt?: { lng: number; lat: number; altitude?: number; timestamp?: string }
    subjectAt?: { lng: number; lat: number }
  }
  label?: PhotoLabel
}

export interface MapPicksFile {
  version: 1
  updatedAt: string
  picks: MapPickEntry[]
}

/**
 * Project a single PhotoMarker into a MapPickEntry. Pure helper —
 * exported for unit testing. Returns null for non-photo markers
 * (KML/click-placed have no photoId) so they don't leak into the
 * handoff file.
 */
export function buildMapPickEntry(marker: PhotoMarker): MapPickEntry | null {
  if (!marker.photoId) return null
  const flag: MapPickEntry['flag'] = marker.flag ?? 'neutral'
  const entry: MapPickEntry = {
    photoId: marker.photoId,
    filename: marker.name,
    flag,
  }
  if (marker.label) entry.label = marker.label
  // GPS — emit `capturedAt` for photos that had EXIF GPS; `subjectAt`
  // only when the subject differs from the capture point (i.e., the
  // user dragged the pin). Saves a few bytes and makes downstream
  // diffs cleaner.
  const gps: NonNullable<MapPickEntry['gps']> = {}
  if (marker.capturedAt) {
    const captured: NonNullable<NonNullable<MapPickEntry['gps']>['capturedAt']> = {
      lng: marker.capturedAt.lng,
      lat: marker.capturedAt.lat,
    }
    if (marker.capturedAt.altitude !== undefined) captured.altitude = marker.capturedAt.altitude
    if (marker.capturedAt.timestamp) captured.timestamp = marker.capturedAt.timestamp
    gps.capturedAt = captured
  }
  const subjectMoved = !marker.capturedAt ||
    marker.lng !== marker.capturedAt.lng ||
    marker.lat !== marker.capturedAt.lat
  if (subjectMoved) {
    gps.subjectAt = { lng: marker.lng, lat: marker.lat }
  }
  if (gps.capturedAt || gps.subjectAt) entry.gps = gps
  return entry
}

/**
 * Project an array of PhotoMarkers, skipping non-photo entries. Used by
 * both App.tsx (scheduling writes) and tests.
 */
export function buildMapPicks(markers: readonly PhotoMarker[]): MapPickEntry[] {
  const out: MapPickEntry[] = []
  for (const m of markers) {
    const entry = buildMapPickEntry(m)
    if (entry) out.push(entry)
  }
  return out
}

// Module-level scheduler state. Per spec there's exactly one writer in
// the app (map-corridors). Different (storage, dir) pairs would be a
// programming error — guarded with a console.warn if it happens.
type PendingState = {
  timer: ReturnType<typeof setTimeout>
  storage: StorageInterface
  dir: DirectoryHandle
  picks: MapPickEntry[]
}
let pending: PendingState | null = null
let inFlight: Promise<void> = Promise.resolve()

/**
 * Run the actual storage write. Serialized — every write waits for the
 * previous one to settle so two debounce flushes can't interleave and
 * produce a torn JSON.
 */
function executeWrite(
  storage: StorageInterface,
  dir: DirectoryHandle,
  picks: MapPickEntry[],
): Promise<void> {
  const file: MapPicksFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    picks,
  }
  inFlight = inFlight.then(() =>
    storage.writeJSON(dir, FILENAME, file).catch(err => {
      console.error('[mapPicks] writeJSON failed:', err)
    }),
  )
  return inFlight
}

/**
 * Schedule a debounced write. Subsequent calls within 300ms replace
 * the pending data — the latest call wins. Useful for collapsing rapid
 * flag toggles into a single disk write.
 */
export function scheduleWriteMapPicks(
  storage: StorageInterface,
  dir: DirectoryHandle,
  picks: MapPickEntry[],
): void {
  if (pending) {
    clearTimeout(pending.timer)
  }
  const timer = setTimeout(() => {
    const p = pending
    pending = null
    if (!p) return
    void executeWrite(p.storage, p.dir, p.picks)
  }, DEBOUNCE_MS)
  pending = { timer, storage, dir, picks }
}

/**
 * Cancel the debounce timer and execute the pending write immediately.
 * Returns a Promise resolving when the write has settled. Callers can
 * await it during explicit pre-nav flushes (Phase 9's "Send to editor"
 * button) — pagehide listeners fire and forget (best-effort).
 *
 * No-op if there's nothing pending.
 */
export function flushPendingMapPicks(): Promise<void> {
  if (!pending) return inFlight
  const { timer, storage, dir, picks } = pending
  clearTimeout(timer)
  pending = null
  return executeWrite(storage, dir, picks)
}

/** Test-only — drains the module-level state between tests. */
export function _resetMapPicksWriterForTests(): void {
  if (pending) {
    clearTimeout(pending.timer)
    pending = null
  }
  inFlight = Promise.resolve()
}
