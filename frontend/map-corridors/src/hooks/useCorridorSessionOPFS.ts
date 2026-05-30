import { useCallback, useEffect, useRef, useState } from 'react'
import type { GeoJSON } from 'geojson'
import type { Discipline } from '../corridors/preciseCorridor'
import type { NoGpsPhoto, PhotoMarker, GroundMarker, PhotoFlag } from '../types/markers'
import { sanitizeGroundMarkers, sanitizeNoGpsPhotos, sanitizePhotoMarkers } from '../types/markers'
import {
  deletePhotoThumb,
  initStorage,
  isStorageAvailable,
  loadOrCreateSessionId,
  type StorageInterface,
  type DirectoryHandle,
} from '@airq/shared-storage'

/**
 * Legacy two-value base style. New sessions use the richer `mapStyleId`
 * (see `config/mapProviders`). Kept on the session for migration only —
 * readers should prefer `mapStyleId`.
 */
type LegacyBaseStyle = 'streets' | 'satellite'

const LEGACY_BASE_STYLE_MAP: Record<LegacyBaseStyle, string> = {
  streets: 'mapbox-streets',
  satellite: 'mapbox-satellite',
}

function isLegacyBaseStyle(value: unknown): value is LegacyBaseStyle {
  return value === 'streets' || value === 'satellite'
}

/**
 * Resolve the `mapStyleId` for a persisted session record.
 *
 * Precedence:
 *   1. `mapStyleId` if present and a non-empty string (new-schema sessions)
 *   2. `baseStyle` if a recognised legacy value (old-schema sessions)
 *   3. `defaultId` (caller supplies, usually `defaultSession(id).mapStyleId`)
 *
 * Invalid or unknown values at any step are logged and fall through so the
 * user is visibly reset to the default rather than silently stuck on a
 * corrupted id. Exported for unit testing — the migration is the one code
 * path that can permanently corrupt persisted user state across upgrades.
 */
export function resolveMapStyleIdFromPersisted(record: unknown, defaultId: string): string {
  const asRec = (record && typeof record === 'object') ? record as Record<string, unknown> : {}

  const storedRaw = asRec.mapStyleId
  if (typeof storedRaw === 'string' && storedRaw.length > 0) {
    return storedRaw
  } else if (storedRaw !== undefined) {
    console.warn('[session] Persisted mapStyleId was not a non-empty string, ignoring:', storedRaw)
  }

  const legacyRaw = asRec.baseStyle
  if (isLegacyBaseStyle(legacyRaw)) {
    return LEGACY_BASE_STYLE_MAP[legacyRaw]
  } else if (legacyRaw !== undefined) {
    console.warn('[session] Unknown legacy baseStyle, resetting to default:', legacyRaw)
  }

  return defaultId
}

/**
 * Resolve `noGpsTrayOpen` for a persisted session. Defaults to `true` for
 * pre-feature sessions (no field present) so the no-GPS tray starts open
 * after the user upgrades — they see the new feature surface immediately.
 * Non-boolean values are logged and ignored. Exported for unit testing.
 */
export function resolveNoGpsTrayOpen(record: unknown, defaultValue: boolean): boolean {
  const asRec = (record && typeof record === 'object') ? record as Record<string, unknown> : {}
  const raw = asRec.noGpsTrayOpen
  if (typeof raw === 'boolean') return raw
  if (raw !== undefined) {
    console.warn('[session] Persisted noGpsTrayOpen was not a boolean, resetting to default:', raw)
  }
  return defaultValue
}

export type CorridorsSession = {
  id: string
  version: number
  createdAt: string
  updatedAt: string
  /**
   * One of the `MapStyleId` values from `config/mapProviders.ts`. We use a
   * plain `string` here to keep the session type free of a runtime import
   * and to tolerate unknown ids from older builds — resolution falls back
   * to the first available style if the id is unknown.
   */
  mapStyleId: string
  discipline: Discipline
  use1NmAfterSp: boolean
  // Persisted artifacts
  geojson: GeoJSON | null
  leftSegments: GeoJSON | null
  rightSegments: GeoJSON | null
  gates: GeoJSON | null
  points: GeoJSON | null
  exactPoints: GeoJSON | null
  // UI data
  markers: readonly PhotoMarker[]
  groundMarkers: readonly GroundMarker[]
  // Photos imported without EXIF GPS (Phase 6 of photo-map-culling,
  // ADR-012). Live here as candidate-pool entries until the user drags
  // one onto the map; on drop, an entry is removed and a PhotoMarker
  // is appended to `markers` with `flag: 'pick-track'` at the drop coord.
  noGpsPhotos: readonly NoGpsPhoto[]
  // Persisted UI state for the no-GPS photo tray (ADR-012). `true` = open,
  // `false` = collapsed. Defaults open on first run + after migration.
  noGpsTrayOpen: boolean
}

/**
 * Pure transform behind the `renamePhoto` action. Extracted (like
 * `normalizeRename` in PhotoListPanel) so the find/no-op/branch rules can be
 * pinned without rendering the hook or mocking OPFS.
 *
 * Writes the user's label to `displayName` and NEVER overwrites the original
 * `name`/`filename` — that stays as the immutable sort key + identity. Walks
 * BOTH `markers[]` (GPS path) and `noGpsPhotos[]` (off-map tray) so a single
 * call handles either origin. Returns the next `{ markers, noGpsPhotos }`
 * arrays, or `null` for a no-op (caller then skips the persist + version bump).
 *
 * Behaviour:
 *  - empty after trim → null (treated as cancel; never clears via empty).
 *  - photoId in neither collection → null.
 *  - trimmed === the original filename → clears `displayName` (back to
 *    original). This is redundant-state avoidance, not an advertised UI: it
 *    stops a "TP1 (TP1)"-style duplicate and lets a user revert by re-typing
 *    the original. No new control is added.
 *  - otherwise set `displayName = trimmed`.
 *  - if the resulting `displayName` equals the current one → null (no write).
 *
 * Trusts the caller to have done UI-level validation (`normalizeRename`) but
 * re-applies trim + the no-op guards as a belt-and-suspenders layer.
 */
export function computeRenamedPhoto(
  session: Pick<CorridorsSession, 'markers' | 'noGpsPhotos'>,
  photoId: string,
  newName: string,
): { markers: readonly PhotoMarker[]; noGpsPhotos: readonly NoGpsPhoto[] } | null {
  const trimmed = newName.trim()
  if (trimmed.length === 0) return null
  const markers = session.markers
  const noGpsPhotos = session.noGpsPhotos || []
  const markerIdx = markers.findIndex(m => m.photoId === photoId)
  const noGpsIdx = noGpsPhotos.findIndex(p => p.photoId === photoId)
  if (markerIdx === -1 && noGpsIdx === -1) return null

  // Original filename + current custom name for whichever collection holds it.
  const original = markerIdx !== -1 ? markers[markerIdx].name : noGpsPhotos[noGpsIdx].filename
  const currentDisplay = markerIdx !== -1 ? markers[markerIdx].displayName : noGpsPhotos[noGpsIdx].displayName
  // Re-typing the original filename clears the custom name rather than storing
  // a redundant `displayName === name`.
  const nextDisplayName = trimmed === original ? undefined : trimmed
  if (nextDisplayName === currentDisplay) return null // nothing actually changes

  const nextMarkers = markerIdx === -1
    ? markers
    : markers.map((m, i) => (i === markerIdx ? { ...m, displayName: nextDisplayName } : m))
  const nextNoGps = noGpsIdx === -1
    ? noGpsPhotos
    : noGpsPhotos.map((p, i) => (i === noGpsIdx ? { ...p, displayName: nextDisplayName } : p))
  return { markers: nextMarkers, noGpsPhotos: nextNoGps }
}

const defaultSession = (id: string): CorridorsSession => ({
  id,
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  mapStyleId: 'mapbox-streets',
  discipline: 'rally',
  use1NmAfterSp: false,
  geojson: null,
  leftSegments: null,
  rightSegments: null,
  gates: null,
  points: null,
  exactPoints: null,
  markers: [],
  groundMarkers: [],
  noGpsPhotos: [],
  noGpsTrayOpen: true,
})

export function useCorridorSessionOPFS(competitionId?: string | null) {
  const [session, setSession] = useState<CorridorsSession | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [storageAvailable, setStorageAvailable] = useState<boolean | null>(null)

  const storageRef = useRef<StorageInterface | null>(null)
  const sessionDirRef = useRef<DirectoryHandle | null>(null)
  // Mirror of `session` for stable setters. Closure-over-`session` would
  // freeze the value seen by `setMarkers` etc. at the render where the
  // setter was created, so a stale setter captured by a long-lived effect
  // (e.g. visibilitychange in useEditorPicksSync) would overwrite the live
  // session with the captured one and silently drop intermediate edits.
  const sessionRef = useRef<CorridorsSession | null>(null)
  useEffect(() => { sessionRef.current = session }, [session])
  // Photos directory for the active competition. Resolved alongside the
  // corridors session dir during init when `competitionId` is provided —
  // otherwise null. Phase 3 of photo-map-culling uses it as the write
  // target for imported photo bytes + thumbnails (see ADR-005 storage
  // layout: `competitions/{compId}/photos/`).
  const [photosDir, setPhotosDir] = useState<DirectoryHandle | null>(null)
  // Ref mirror so `removePhoto` (and any future cleanup action) can do
  // best-effort storage IO without re-binding the callback on every
  // photosDir change — same pattern as storageRef / sessionDirRef.
  const photosDirRef = useRef<DirectoryHandle | null>(null)
  useEffect(() => { photosDirRef.current = photosDir }, [photosDir])
  // Parent of corridors/ and photos/. Where map-picks.json lands
  // (Phase 8 cross-app handoff). Null in the legacy flat-session path.
  const [competitionDir, setCompetitionDir] = useState<DirectoryHandle | null>(null)

  useEffect(() => {
    (async () => {
      setStorageAvailable(null)

      const ok = await isStorageAvailable()
      setStorageAvailable(ok)

      if (!ok) {
        const id = competitionId ? `corridors-${competitionId}` : loadOrCreateSessionId()
        setSessionId(id)
        setSession(defaultSession(id))
        return
      }

      try {
        const storage = await initStorage()
        storageRef.current = storage
        const handles = await storage.init()

        let corridorsDir: DirectoryHandle
        let id: string
        let resolvedPhotosDir: DirectoryHandle | null = null
        let resolvedCompetitionDir: DirectoryHandle | null = null

        if (competitionId) {
          // Scope under competitions/{competitionId}/{corridors,photos}/
          id = `corridors-${competitionId}`
          const competitionsDir = await storage.getDirectoryHandle(handles.root, 'competitions', { create: true })
          const compDir = await storage.getDirectoryHandle(competitionsDir, competitionId, { create: true })
          corridorsDir = await storage.getDirectoryHandle(compDir, 'corridors', { create: true })
          const photos = await storage.getDirectoryHandle(compDir, 'photos', { create: true })
          resolvedPhotosDir = photos
          resolvedCompetitionDir = compDir
        } else {
          // Legacy flat session
          id = loadOrCreateSessionId()
          const sessionsDir = await storage.getDirectoryHandle(handles.root, 'sessions', { create: true })
          corridorsDir = await storage.getDirectoryHandle(sessionsDir, id, { create: true })
        }

        sessionDirRef.current = corridorsDir
        setSessionId(id)

        const existing = await storage.readJSON<CorridorsSession>(corridorsDir, 'session.json')
        if (existing) {
          // Validate untrusted persisted data before it flows into render paths
          // (dangerouslySetInnerHTML lookup, map.project, KML export). A malformed
          // marker — wrong type, out-of-range coords, missing id — is dropped with
          // a console warning instead of crashing the map view.
          const asRec = existing as Record<string, unknown>
          const rawGm = asRec.groundMarkers
          const rawPm = asRec.markers
          const cleanGm = sanitizeGroundMarkers(rawGm)
          const cleanPm = sanitizePhotoMarkers(rawPm)
          const rawNoGps = asRec.noGpsPhotos
          const cleanNoGps = sanitizeNoGpsPhotos(rawNoGps)
          if (Array.isArray(rawGm) && cleanGm.length !== rawGm.length) {
            console.warn(`[session] Dropped ${rawGm.length - cleanGm.length} invalid ground marker(s) from persisted session`)
          } else if (rawGm !== undefined && !Array.isArray(rawGm)) {
            console.warn('[session] Persisted groundMarkers was not an array, resetting', rawGm)
          }
          if (Array.isArray(rawPm) && cleanPm.length !== rawPm.length) {
            console.warn(`[session] Dropped ${rawPm.length - cleanPm.length} invalid photo marker(s) from persisted session`)
          } else if (rawPm !== undefined && !Array.isArray(rawPm)) {
            console.warn('[session] Persisted markers was not an array, resetting', rawPm)
          }
          // Migrate old `baseStyle: 'streets'|'satellite'` sessions to the
          // new `mapStyleId` field so users don't lose their current pick.
          // Logic extracted to `resolveMapStyleIdFromPersisted` for unit tests.
          const mapStyleId = resolveMapStyleIdFromPersisted(asRec, defaultSession(id).mapStyleId)
          const noGpsTrayOpen = resolveNoGpsTrayOpen(asRec, defaultSession(id).noGpsTrayOpen)
          setSession({
            ...defaultSession(id),
            ...existing,
            mapStyleId,
            discipline: (asRec.discipline as CorridorsSession['discipline']) || 'rally',
            markers: cleanPm,
            groundMarkers: cleanGm,
            noGpsPhotos: cleanNoGps,
            noGpsTrayOpen,
          })
        } else {
          const fresh = defaultSession(id)
          await storage.writeJSON(corridorsDir, 'session.json', fresh)
          setSession(fresh)
        }
        // Publish the per-competition dirs ONLY after the session is in
        // place. Otherwise the App.tsx write effect (which gates on
        // `competitionDir`) can fire with an empty `markers` array between
        // dir-resolution and session-load, blanking map-picks.json on disk.
        setPhotosDir(resolvedPhotosDir)
        setCompetitionDir(resolvedCompetitionDir)
      } catch (e) {
        console.error('Failed to initialize corridors storage', e)
        setError('Failed to initialize storage')
        const id = competitionId ? `corridors-${competitionId}` : loadOrCreateSessionId()
        setSessionId(id)
        setSession(defaultSession(id))
        // Leave photosDir/competitionDir at null — without working storage
        // we don't want the handoff writer firing against partially-resolved
        // handles. The user sees the error banner instead.
      }
    })()
  }, [competitionId])

  const persistSession = useCallback(async (next: CorridorsSession) => {
    setSession(next)
    const storage = storageRef.current
    const dir = sessionDirRef.current
    if (storage && dir) {
      try {
        await storage.writeJSON(dir, 'session.json', next)
      } catch (e) {
        console.error('Failed to persist corridors session', e)
        setError('Failed to persist session')
      }
    }
  }, [])

  // All setters below read the live session from `sessionRef` rather than
  // closing over `session`. This makes them stable across renders, which
  // matters for long-lived effects that capture them (the bidirectional
  // sync hooks fire on visibilitychange far after their mount-time
  // closure was captured).
  const setMapStyleId = useCallback(async (mapStyleId: string) => {
    const current = sessionRef.current
    if (!current) return
    await persistSession({ ...current, mapStyleId, version: current.version + 1, updatedAt: new Date().toISOString() })
  }, [persistSession])

  const setDiscipline = useCallback(async (discipline: Discipline) => {
    const current = sessionRef.current
    if (!current) return
    await persistSession({ ...current, discipline, version: current.version + 1, updatedAt: new Date().toISOString() })
  }, [persistSession])

  const setUse1NmAfterSp = useCallback(async (use1: boolean) => {
    const current = sessionRef.current
    if (!current) return
    await persistSession({ ...current, use1NmAfterSp: use1, version: current.version + 1, updatedAt: new Date().toISOString() })
  }, [persistSession])

  // Updaters receive a readonly view so callers can't mutate in place (e.g. prev.push).
  // Returning the same reference (e.g. early-return `prev` on no-op) is also allowed.
  const setMarkers = useCallback(async (updater: (prev: readonly PhotoMarker[]) => readonly PhotoMarker[]) => {
    const current = sessionRef.current
    if (!current) return
    await persistSession({ ...current, markers: updater(current.markers), version: current.version + 1, updatedAt: new Date().toISOString() })
  }, [persistSession])

  const setGroundMarkers = useCallback(async (updater: (prev: readonly GroundMarker[]) => readonly GroundMarker[]) => {
    const current = sessionRef.current
    if (!current) return
    await persistSession({ ...current, groundMarkers: updater(current.groundMarkers || []), version: current.version + 1, updatedAt: new Date().toISOString() })
  }, [persistSession])

  const setNoGpsTrayOpen = useCallback(async (open: boolean) => {
    const current = sessionRef.current
    if (!current) return
    await persistSession({ ...current, noGpsTrayOpen: open, version: current.version + 1, updatedAt: new Date().toISOString() })
  }, [persistSession])

  // Setter for the no-GPS tray entries. Caller passes an updater (mirrors
  // setMarkers) so atomic add/remove can read-modify-write in one shot
  // without losing concurrent edits to siblings on the same session.
  const setNoGpsPhotos = useCallback(async (updater: (prev: readonly NoGpsPhoto[]) => readonly NoGpsPhoto[]) => {
    const current = sessionRef.current
    if (!current) return
    await persistSession({ ...current, noGpsPhotos: updater(current.noGpsPhotos || []), version: current.version + 1, updatedAt: new Date().toISOString() })
  }, [persistSession])

  // Atomic placement of a no-GPS photo onto the map: in one persistSession
  // call, append the new PhotoMarker AND remove the photo from noGpsPhotos.
  // Replaces the previous two-await sequence which could leave the photo
  // duplicated in both lists if the second write failed (quota, transient
  // I/O). Returns true on success, false when the entry isn't found.
  const placeNoGpsPhoto = useCallback(async (photoId: string, lng: number, lat: number, flag: PhotoFlag | null = 'pick-track'): Promise<boolean> => {
    const current = sessionRef.current
    if (!current) return false
    const entry = (current.noGpsPhotos || []).find(p => p.photoId === photoId)
    if (!entry) return false
    const marker: PhotoMarker = {
      id: photoId,
      photoId,
      lng,
      lat,
      name: entry.filename,
      // Carry the custom name across so dragging a renamed tray photo onto
      // the map keeps its label (and still preserves the original filename).
      ...(entry.displayName ? { displayName: entry.displayName } : {}),
      // Phase 14 — caller may commit straight to a chosen category (provisional
      // placement). `null` = neutral, so omit the flag field. Tray drag-drop
      // defaults to 'pick-track' (the common case; re-categorize via the popup).
      ...(flag ? { flag } : {}),
    }
    await persistSession({
      ...current,
      markers: [...current.markers, marker],
      noGpsPhotos: (current.noGpsPhotos || []).filter(p => p.photoId !== photoId),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    })
    return true
  }, [persistSession])

  // Remove a photo from this corridor session entirely. Mirrors the X
  // affordance on photo-helper grid tiles — a single click destroys the
  // selection, no confirmation (speed matters during flying-competition
  // review). The photo is filtered out of BOTH `markers` and
  // `noGpsPhotos` in one persistSession call; in practice only one of
  // the two contains the id, but filtering both costs nothing and
  // survives transitional states (`placeNoGpsPhoto` window).
  //
  // Storage cleanup is best-effort and runs after the state write. A
  // failed unlink leaves orphaned bytes under `photos/` (or `thumbs/`)
  // that the next session reload simply doesn't surface — preferable to
  // keeping the photo visible because of an unrelated quota / FS hiccup.
  const removePhoto = useCallback(async (photoId: string): Promise<void> => {
    const current = sessionRef.current
    if (!current) return
    const hadMarker = current.markers.some(m => m.photoId === photoId)
    const hadNoGps = (current.noGpsPhotos || []).some(p => p.photoId === photoId)
    if (!hadMarker && !hadNoGps) return
    await persistSession({
      ...current,
      markers: hadMarker
        ? current.markers.filter(m => m.photoId !== photoId)
        : current.markers,
      noGpsPhotos: hadNoGps
        ? (current.noGpsPhotos || []).filter(p => p.photoId !== photoId)
        : (current.noGpsPhotos || []),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    })
    const storage = storageRef.current
    const dir = photosDirRef.current
    if (storage && dir) {
      storage.deletePhotoFile(dir, photoId).catch((err: unknown) => {
        console.warn('[corridor session] photo file cleanup failed', photoId, err)
      })
      deletePhotoThumb(storage, dir, photoId).catch((err: unknown) => {
        console.warn('[corridor session] photo thumb cleanup failed', photoId, err)
      })
    }
  }, [persistSession])

  /**
   * Set a photo's custom display name (`displayName`) without touching the
   * original `marker.name` / `noGpsPhoto.filename`. Walks BOTH collections so
   * a single call handles either origin without the caller disambiguating.
   *
   * The OPFS file under `photos/{photoId}` is untouched — only the
   * user-facing label changes. The custom name flows downstream:
   *  - KML export emits `displayName (originalFilename)` so the camera file is
   *    still identifiable.
   *  - `buildMapPickEntry` writes `entry.filename = displayName ?? name` so
   *    Photo Helper's candidate tile shows the custom name on the next sync.
   * Ordering everywhere stays keyed on the original filename, so a rename
   * never reorders the list.
   *
   * Caller is expected to pre-trim / validate (see `normalizeRename` in
   * PhotoListPanel); the no-op + clear-on-original rules live in
   * `computeRenamedPhoto`.
   */
  const renamePhoto = useCallback(async (photoId: string, newName: string): Promise<void> => {
    const current = sessionRef.current
    if (!current) return
    const patch = computeRenamedPhoto(current, photoId, newName)
    if (!patch) return
    await persistSession({
      ...current,
      markers: patch.markers,
      noGpsPhotos: patch.noGpsPhotos,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    })
  }, [persistSession])

  const saveOriginalKmlText = useCallback(async (text: string | null) => {
    if (!sessionRef.current) return
    const storage = storageRef.current
    const dir = sessionDirRef.current
    if (storage && dir) {
      try {
        // Store KML text as JSON wrapper (works for both OPFS and Electron)
        await storage.writeJSON(dir, 'original-kml.json', { text: text || '' })
      } catch (e) {
        console.error('Failed to save original KML text', e)
      }
    }
  }, [])

  const loadOriginalKmlText = useCallback(async (): Promise<string | null> => {
    const storage = storageRef.current
    const dir = sessionDirRef.current
    if (!storage || !dir) return null
    try {
      const data = await storage.readJSON<{ text: string }>(dir, 'original-kml.json')
      return data?.text || null
    } catch {
      return null
    }
  }, [])

  const setComputedData = useCallback(async (payload: {
    geojson: GeoJSON | null
    leftSegments: GeoJSON | null
    rightSegments: GeoJSON | null
    gates: GeoJSON | null
    points: GeoJSON | null
    exactPoints: GeoJSON | null
  }) => {
    const current = sessionRef.current
    if (!current) return
    await persistSession({
      ...current,
      ...payload,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    })
  }, [persistSession])

  return {
    // state
    session,
    sessionId,
    error,
    backendAvailable: storageAvailable,
    storage: storageRef.current,
    photosDir,
    competitionDir,
    // actions
    setMapStyleId,
    setDiscipline,
    setUse1NmAfterSp,
    setMarkers,
    setGroundMarkers,
    setNoGpsPhotos,
    setNoGpsTrayOpen,
    placeNoGpsPhoto,
    removePhoto,
    renamePhoto,
    setComputedData,
    saveOriginalKmlText,
    loadOriginalKmlText,
    // utils
    clearError: () => setError(null),
  }
}
