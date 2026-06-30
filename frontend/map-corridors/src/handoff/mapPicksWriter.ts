// Phase 8a of photo-map-culling — cross-app handoff writer.
// See ADR-005 (one-way map-picks.json) + ADR-019 (upsert/delete) +
// docs/photo-map-culling/implementation-plan.md Phase 8.
//
// Map-corridors writes its full picks snapshot to
// `competitions/{compId}/map-picks.json`. Photo-helper reads it
// (useMapPicksSync) to project picks into its candidate tray.
//
// Single writer; rapid calls coalesce on a 300ms debounce. Pagehide /
// pre-nav code paths call flushPendingMapPicks() to skip the wait.
//
// Wire-format types live in @airq/shared-handoff — both writer and
// reader on both apps import from there, so a future field addition
// can't drift between them.

import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import {
  MAP_PICKS_FILENAME,
  isPickFlag,
  type MapPickEntry,
  type MapPicksFile,
} from '@airq/shared-handoff'
import { comparePhotoMarkers, type PhotoMarker } from '../types/markers'
import { partitionPicksByRouteTP } from '../setSplit/partitionPicksBySet'
import type { RouteWaypoint } from '../corridors/matchPoints'

const FILENAME = MAP_PICKS_FILENAME
const DEBOUNCE_MS = 300

export type { MapPickEntry, MapPicksFile }

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
    // Send the custom name when set so Photo Helper's candidate tile shows
    // `TP1`, not the camera filename. Falls back to the original filename.
    filename: marker.displayName ?? marker.name,
    flag,
  }
  if (marker.label) entry.label = marker.label
  if (marker.labelUpdatedAt) entry.labelUpdatedAt = marker.labelUpdatedAt
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
 * Project an array of PhotoMarkers, skipping non-photo entries AND
 * non-pick flags. User feedback 2026-05-17 (Martin Hrivna) flagged the
 * UX mismatch: the footer button reads "Poslat do editoru (N)" with
 * N = picks.length, but the writer used to emit every marker regardless
 * of flag, so the editor received all photos. The fix aligns wire
 * behavior with the visible count — only photos the user has flagged
 * as `pick` are crossed over to photo-helper.
 *
 * Consequences:
 *  - Unpicking in map-corridors removes the entry from the file; the
 *    photo-helper `syncMapPicksOnce` cleanup pass then removes the
 *    candidate from the editor pool. "Unpick" becomes the natural
 *    "remove from editor" verb without needing an extra UI.
 *  - Reject / neutral flag state is preserved purely on the corridor
 *    side (PhotoMarker.flag) — the wire file is now a transport for
 *    PICKS only, not a general flag-state mirror.
 *
 * When `breakWaypointName` names a route turning point (and `waypoints` is the
 * route's ordered waypoints), each entry also carries `set` (`set1`/`set2`) per
 * its position along the route, so the editor fills the matching sheet.
 *
 * Used by both App.tsx (scheduling writes) and tests.
 */
export function buildMapPicks(
  markers: readonly PhotoMarker[],
  waypoints: readonly RouteWaypoint[] = [],
  breakWaypointName?: string | null,
): MapPickEntry[] {
  // Emit picks in ROUTE order (filename, then EXIF time — `comparePhotoMarkers`).
  // The editor fills each sheet in file order, so a sorted file gives correct
  // within-sheet ordering for free. Set membership is a separate, geographic
  // cut computed below from the chosen route TP.
  const picks = markers.filter(m => m.photoId && isPickFlag(m.flag))
  const sorted = [...picks].sort(comparePhotoMarkers)

  // Set membership comes from the shared partition helper — the SAME source the
  // panel's set1│set2 divider reads — so the editor's file and what the user
  // sees in the panel can never disagree. No break / stale name / no route →
  // empty map → no `set` emitted, and the editor falls back to its default
  // set1→set2→tray fill.
  const setByPhotoId = partitionPicksByRouteTP(markers, waypoints, breakWaypointName)

  const out: MapPickEntry[] = []
  for (const m of sorted) {
    const entry = buildMapPickEntry(m)
    if (!entry) continue
    const set = m.photoId ? setByPhotoId.get(m.photoId) : undefined
    if (set) entry.set = set
    out.push(entry)
  }
  return out
}

// Module-level scheduler state. Per spec there's exactly one writer in
// the app (map-corridors). When the (storage, dir) pair changes mid-debounce
// (competition switch), the pending write is flushed FIRST so its bytes
// land in the correct directory before scheduling against the new one.
type PendingState = {
  timer: ReturnType<typeof setTimeout>
  storage: StorageInterface
  dir: DirectoryHandle
  picks: MapPickEntry[]
}
let pending: PendingState | null = null
// Serializes writes so two debounce flushes can't interleave and produce
// a torn JSON. The chain swallows errors from prior writes (`.catch`)
// before continuing — each call's caller still sees its OWN write's
// rejection via the returned `currentPromise` below.
let inFlight: Promise<void> = Promise.resolve()

/**
 * Run the actual storage write. Returns a promise that resolves/rejects
 * for THIS specific write — callers (`flushPendingMapPicks`) can await
 * it to know whether THEIR bytes hit disk, independent of prior failures.
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
  // Schedule after any prior write settles (success OR failure — we don't
  // want one failure to permanently break the queue), then return the
  // per-call promise so the caller sees ITS own rejection.
  const currentPromise = inFlight
    .catch(() => undefined)
    .then(() => storage.writeJSON(dir, FILENAME, file))
  inFlight = currentPromise
  return currentPromise
}

/**
 * Schedule a debounced write. Subsequent calls within 300ms replace
 * the pending data — the latest call wins. Useful for collapsing rapid
 * flag toggles into a single disk write.
 *
 * When the (storage, dir) pair differs from the pending one, the pending
 * write is flushed immediately so its bytes land in the correct directory
 * (covers the competition-switch race).
 */
export function scheduleWriteMapPicks(
  storage: StorageInterface,
  dir: DirectoryHandle,
  picks: MapPickEntry[],
): void {
  if (pending) {
    const dirChanged = pending.storage !== storage || pending.dir !== dir
    clearTimeout(pending.timer)
    if (dirChanged) {
      // Flush the pending write to its ORIGINAL dir before re-scheduling.
      // Errors are swallowed here — there's no caller to surface them to
      // and we must not block the new schedule.
      const stale = pending
      pending = null
      void executeWrite(stale.storage, stale.dir, stale.picks).catch(err => {
        console.error('[mapPicks] flush-on-dir-change failed:', err)
      })
    }
  }
  const timer = setTimeout(() => {
    const p = pending
    pending = null
    if (!p) return
    void executeWrite(p.storage, p.dir, p.picks).catch(err => {
      console.error('[mapPicks] debounced writeJSON failed:', err)
    })
  }, DEBOUNCE_MS)
  pending = { timer, storage, dir, picks }
}

/**
 * Cancel the debounce timer and execute the pending write immediately.
 * Returns a Promise resolving when the write has settled, OR rejecting
 * if the underlying storage.writeJSON rejected — callers (Phase 9's
 * "Send to editor" handler) MUST catch this so the user sees a snackbar
 * before the nav, otherwise a quota/permission failure silently navigates
 * the user to a stale handoff file.
 *
 * No-op (resolves) if there's nothing pending.
 */
export function flushPendingMapPicks(): Promise<void> {
  if (!pending) return Promise.resolve()
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
