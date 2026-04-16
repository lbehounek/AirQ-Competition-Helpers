import { useCallback, useEffect, useRef, useState } from 'react'
import type { GeoJSON } from 'geojson'
import type { Discipline } from '../corridors/preciseCorridor'
import type { PhotoMarker, GroundMarker } from '../types/markers'
import {
  initStorage,
  isStorageAvailable,
  loadOrCreateSessionId,
  type StorageInterface,
  type DirectoryHandle,
} from '@airq/shared-storage'

type BaseStyle = 'streets' | 'satellite'

export type CorridorsSession = {
  id: string
  version: number
  createdAt: string
  updatedAt: string
  baseStyle: BaseStyle
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
  markers: PhotoMarker[]
  groundMarkers: GroundMarker[]
}

const defaultSession = (id: string): CorridorsSession => ({
  id,
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  baseStyle: 'streets',
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
          setSession({
            ...defaultSession(id),
            ...existing,
            baseStyle: (existing as any).baseStyle || 'streets',
            discipline: (existing as any).discipline || 'rally',
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

  const setBaseStyle = useCallback(async (style: BaseStyle) => {
    if (!session) return
    const next: CorridorsSession = { ...session, baseStyle: style, version: session.version + 1, updatedAt: new Date().toISOString() }
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

  const setMarkers = useCallback(async (updater: (prev: CorridorsSession['markers']) => CorridorsSession['markers']) => {
    if (!session) return
    const next: CorridorsSession = { ...session, markers: updater(session.markers), version: session.version + 1, updatedAt: new Date().toISOString() }
    await persistSession(next)
  }, [session, persistSession])

  const setGroundMarkers = useCallback(async (updater: (prev: GroundMarker[]) => GroundMarker[]) => {
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
    setBaseStyle,
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
