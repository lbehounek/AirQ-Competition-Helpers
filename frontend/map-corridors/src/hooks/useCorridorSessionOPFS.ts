import { useCallback, useEffect, useRef, useState } from 'react'
import type { GeoJSON } from 'geojson'
import type { Discipline } from '../corridors/preciseCorridor'
import type { NoGpsPhoto, PhotoMarker, GroundMarker } from '../types/markers'
import { sanitizeGroundMarkers, sanitizeNoGpsPhotos, sanitizePhotoMarkers } from '../types/markers'
import {
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
  // is appended to `markers` with `flag: 'pick'` at the drop coord.
  noGpsPhotos: readonly NoGpsPhoto[]
  // Persisted UI state for the no-GPS photo tray (ADR-012). `true` = open,
  // `false` = collapsed. Defaults open on first run + after migration.
  noGpsTrayOpen: boolean
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
  const placeNoGpsPhoto = useCallback(async (photoId: string, lng: number, lat: number): Promise<boolean> => {
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
      flag: 'pick',
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
    setComputedData,
    saveOriginalKmlText,
    loadOriginalKmlText,
    // utils
    clearError: () => setError(null),
  }
}
