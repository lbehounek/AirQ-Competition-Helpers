import { useCallback, useEffect, useRef, useState } from 'react'
import type { GeoJSON } from 'geojson'
import type { Discipline } from '../corridors/preciseCorridor'
import type { PhotoMarker, GroundMarker } from '../types/markers'
import { sanitizeGroundMarkers, sanitizePhotoMarkers } from '../types/markers'
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
})

export function useCorridorSessionOPFS(competitionId?: string | null) {
  const [session, setSession] = useState<CorridorsSession | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [storageAvailable, setStorageAvailable] = useState<boolean | null>(null)

  const storageRef = useRef<StorageInterface | null>(null)
  const sessionDirRef = useRef<DirectoryHandle | null>(null)

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

        if (competitionId) {
          // Scope under competitions/{competitionId}/corridors/
          id = `corridors-${competitionId}`
          const competitionsDir = await storage.getDirectoryHandle(handles.root, 'competitions', { create: true })
          const compDir = await storage.getDirectoryHandle(competitionsDir, competitionId, { create: true })
          corridorsDir = await storage.getDirectoryHandle(compDir, 'corridors', { create: true })
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
          setSession({
            ...defaultSession(id),
            ...existing,
            mapStyleId,
            discipline: (asRec.discipline as CorridorsSession['discipline']) || 'rally',
            markers: cleanPm,
            groundMarkers: cleanGm,
          })
        } else {
          const fresh = defaultSession(id)
          await storage.writeJSON(corridorsDir, 'session.json', fresh)
          setSession(fresh)
        }
      } catch (e) {
        console.error('Failed to initialize corridors storage', e)
        setError('Failed to initialize storage')
        const id = competitionId ? `corridors-${competitionId}` : loadOrCreateSessionId()
        setSessionId(id)
        setSession(defaultSession(id))
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

  const setMapStyleId = useCallback(async (mapStyleId: string) => {
    if (!session) return
    const next: CorridorsSession = { ...session, mapStyleId, version: session.version + 1, updatedAt: new Date().toISOString() }
    await persistSession(next)
  }, [session, persistSession])

  const setDiscipline = useCallback(async (discipline: Discipline) => {
    if (!session) return
    const next: CorridorsSession = { ...session, discipline, version: session.version + 1, updatedAt: new Date().toISOString() }
    await persistSession(next)
  }, [session, persistSession])

  const setUse1NmAfterSp = useCallback(async (use1: boolean) => {
    if (!session) return
    const next: CorridorsSession = { ...session, use1NmAfterSp: use1, version: session.version + 1, updatedAt: new Date().toISOString() }
    await persistSession(next)
  }, [session, persistSession])

  // Updaters receive a readonly view so callers can't mutate in place (e.g. prev.push).
  // Returning the same reference (e.g. early-return `prev` on no-op) is also allowed.
  const setMarkers = useCallback(async (updater: (prev: readonly PhotoMarker[]) => readonly PhotoMarker[]) => {
    if (!session) return
    const next: CorridorsSession = { ...session, markers: updater(session.markers), version: session.version + 1, updatedAt: new Date().toISOString() }
    await persistSession(next)
  }, [session, persistSession])

  const setGroundMarkers = useCallback(async (updater: (prev: readonly GroundMarker[]) => readonly GroundMarker[]) => {
    if (!session) return
    const next: CorridorsSession = { ...session, groundMarkers: updater(session.groundMarkers || []), version: session.version + 1, updatedAt: new Date().toISOString() }
    await persistSession(next)
  }, [session, persistSession])

  const saveOriginalKmlText = useCallback(async (text: string | null) => {
    if (!session) return
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
  }, [session])

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
    if (!session) return
    const next: CorridorsSession = {
      ...session,
      ...payload,
      version: session.version + 1,
      updatedAt: new Date().toISOString(),
    }
    await persistSession(next)
  }, [session, persistSession])

  return {
    // state
    session,
    sessionId,
    error,
    backendAvailable: storageAvailable,
    // actions
    setMapStyleId,
    setDiscipline,
    setUse1NmAfterSp,
    setMarkers,
    setGroundMarkers,
    setComputedData,
    saveOriginalKmlText,
    loadOriginalKmlText,
    // utils
    clearError: () => setError(null),
  }
}
