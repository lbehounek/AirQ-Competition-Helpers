import { useCallback, useEffect, useRef, useState } from 'react'
import type { GeoJSON } from 'geojson'
import {
  detectOPFSWriteSupport,
  ensureSessionDir,
  initOPFS,
  loadOrCreateSessionId,
  readJSON,
  readTextFile,
  writeJSON,
  writeTextFile,
} from '../services/opfsService'

type BaseStyle = 'streets' | 'satellite'

export type CorridorsSession = {
  id: string
  version: number
  createdAt: string
  updatedAt: string
  baseStyle: BaseStyle
  use1NmAfterSp: boolean
  // Persisted artifacts
  geojson: GeoJSON | null
  leftSegments: GeoJSON | null
  rightSegments: GeoJSON | null
  gates: GeoJSON | null
  points: GeoJSON | null
  exactPoints: GeoJSON | null
  // UI data
  markers: { id: string; lng: number; lat: number; name: string; label?: 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P'|'Q'|'R'|'S'|'T' }[]
}

const defaultSession = (id: string): CorridorsSession => ({
  id,
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  baseStyle: 'streets',
  use1NmAfterSp: false,
  geojson: null,
  leftSegments: null,
  rightSegments: null,
  gates: null,
  points: null,
  exactPoints: null,
  markers: [],
})

// --------------------------------------------------------------------------
// Electron storage helpers (use existing IPC bridge from preload.js)
// --------------------------------------------------------------------------

interface ElectronStorageAPI {
  init: () => Promise<{ rootPath: string; sessionsPath: string }>
  getDirectoryHandle: (parentPath: string, name: string, create: boolean) => Promise<string>
  writeJSON: (dirPath: string, name: string, data: unknown) => Promise<void>
  readJSON: <T>(dirPath: string, name: string) => Promise<T | null>
}

function getElectronStorage(): ElectronStorageAPI | null {
  const api = (window as any).electronAPI
  if (api?.isElectron && api?.storage) return api.storage
  return null
}

/**
 * Initialize corridors directory under a competition in Electron's native fs.
 * Returns the absolute path to `competitions/{competitionId}/corridors/`.
 */
async function initElectronCompetitionDir(competitionId: string): Promise<string> {
  const api = getElectronStorage()!
  const { rootPath } = await api.init()
  const competitionsDir = await api.getDirectoryHandle(rootPath, 'competitions', true)
  const compDir = await api.getDirectoryHandle(competitionsDir, competitionId, true)
  const corridorsDir = await api.getDirectoryHandle(compDir, 'corridors', true)
  return corridorsDir
}

// --------------------------------------------------------------------------
// Hook
// --------------------------------------------------------------------------

export function useCorridorSessionOPFS(competitionId?: string | null) {
  const [session, setSession] = useState<CorridorsSession | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opfsAvailable, setOpfsAvailable] = useState<boolean | null>(null)

  // For OPFS mode
  const handlesRef = useRef<{ sessionsDir?: FileSystemDirectoryHandle; sessionDir?: FileSystemDirectoryHandle }>({})
  // For Electron competition mode
  const electronDirRef = useRef<string | null>(null)

  useEffect(() => {
    (async () => {
      setOpfsAvailable(null)
      const electronApi = getElectronStorage()

      // ---- Electron + competition mode ----
      if (electronApi && competitionId) {
        setOpfsAvailable(true)
        const id = `corridors-${competitionId}`
        setSessionId(id)
        try {
          const dirPath = await initElectronCompetitionDir(competitionId)
          electronDirRef.current = dirPath
          const existing = await electronApi.readJSON<CorridorsSession>(dirPath, 'session.json')
          if (existing) {
            setSession({
              ...defaultSession(id),
              ...existing,
              baseStyle: (existing as any).baseStyle || 'streets',
            })
          } else {
            const fresh = defaultSession(id)
            await electronApi.writeJSON(dirPath, 'session.json', fresh)
            setSession(fresh)
          }
        } catch (e) {
          console.error('Failed to init Electron corridors storage', e)
          setError('Failed to initialize storage')
          setSession(defaultSession(id))
        }
        return
      }

      // ---- OPFS mode (web standalone or OPFS competition) ----
      const ok = await detectOPFSWriteSupport()
      setOpfsAvailable(ok)

      if (competitionId && ok) {
        // Scope OPFS under competitions/{competitionId}/corridors
        const id = `corridors-${competitionId}`
        setSessionId(id)
        try {
          const root = await (navigator as any).storage.getDirectory()
          const competitionsDir = await root.getDirectoryHandle('competitions', { create: true })
          const compDir = await competitionsDir.getDirectoryHandle(competitionId, { create: true })
          const corridorsDir = await compDir.getDirectoryHandle('corridors', { create: true })
          handlesRef.current = { sessionDir: corridorsDir }
          const existing = await readJSON<CorridorsSession>(corridorsDir, 'session.json')
          if (existing) {
            setSession({
              ...defaultSession(id),
              ...existing,
              baseStyle: (existing as any).baseStyle || 'streets',
            })
          } else {
            const fresh = defaultSession(id)
            await writeJSON(corridorsDir, 'session.json', fresh)
            setSession(fresh)
          }
        } catch (e) {
          console.error('Failed to init OPFS competition corridors', e)
          setError('Failed to initialize OPFS')
          setSession(defaultSession(id))
        }
        return
      }

      // ---- Legacy flat session (no competition context) ----
      const id = loadOrCreateSessionId()
      setSessionId(id)
      if (!ok) {
        setSession(defaultSession(id))
        return
      }
      try {
        const { root, sessions } = await initOPFS()
        const { dir } = await ensureSessionDir({ root, sessions }, id)
        handlesRef.current = { sessionsDir: sessions, sessionDir: dir }
        const existing = await readJSON<CorridorsSession>(dir, 'session.json')
        if (existing) {
          const withDefaults: CorridorsSession = {
            ...defaultSession(id),
            ...existing,
            baseStyle: (existing as any).baseStyle || 'streets',
          }
          setSession(withDefaults)
        } else {
          const fresh = defaultSession(id)
          await writeJSON(dir, 'session.json', fresh)
          setSession(fresh)
        }
      } catch (e) {
        console.error(e)
        setError('Failed to initialize OPFS')
        setSession(defaultSession(id))
      }
    })()
  }, [competitionId])

  const persistSession = useCallback(async (next: CorridorsSession) => {
    setSession(next)

    // Electron competition mode
    const electronApi = getElectronStorage()
    if (electronApi && electronDirRef.current) {
      try {
        await electronApi.writeJSON(electronDirRef.current, 'session.json', next)
      } catch (e) {
        console.error('Failed to persist corridors session to Electron storage', e)
        setError('Failed to persist session')
      }
      return
    }

    // OPFS mode
    if (handlesRef.current.sessionDir) {
      try {
        await writeJSON(handlesRef.current.sessionDir, 'session.json', next)
      } catch (e) {
        console.error('Failed to persist corridors session to OPFS', e)
        setError('Failed to persist session')
      }
    }
  }, [])

  const setBaseStyle = useCallback(async (style: BaseStyle) => {
    if (!session) return
    const next: CorridorsSession = { ...session, baseStyle: style, version: session.version + 1, updatedAt: new Date().toISOString() }
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

  const saveOriginalKmlText = useCallback(async (text: string | null) => {
    if (!session) return

    // Electron competition mode
    const electronApi = getElectronStorage()
    if (electronApi && electronDirRef.current) {
      try {
        // Use writeJSON with a text wrapper — the IPC handler writes strings fine
        await electronApi.writeJSON(electronDirRef.current, 'original.kml.json', { text: text || '' })
      } catch (e) {
        console.error('Failed to save original KML text (Electron)', e)
      }
      return
    }

    // OPFS mode
    const dir = handlesRef.current.sessionDir
    if (dir) {
      if (text == null) {
        await writeTextFile(dir, 'original.kml', '')
      } else {
        await writeTextFile(dir, 'original.kml', text, 'application/vnd.google-earth.kml+xml')
      }
    }
  }, [session])

  const loadOriginalKmlText = useCallback(async (): Promise<string | null> => {
    // Electron competition mode
    const electronApi = getElectronStorage()
    if (electronApi && electronDirRef.current) {
      try {
        const data = await electronApi.readJSON<{ text: string }>(electronDirRef.current, 'original.kml.json')
        return data?.text || null
      } catch {
        return null
      }
    }

    // OPFS mode
    const dir = handlesRef.current.sessionDir
    if (!dir) return null
    return await readTextFile(dir, 'original.kml')
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
    backendAvailable: opfsAvailable,
    // actions
    setBaseStyle,
    setUse1NmAfterSp,
    setMarkers,
    setComputedData,
    saveOriginalKmlText,
    loadOriginalKmlText,
    // utils
    clearError: () => setError(null),
  }
}
