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

export function useCorridorSessionOPFS() {
  const [session, setSession] = useState<CorridorsSession | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opfsAvailable, setOpfsAvailable] = useState<boolean | null>(null)

  const handlesRef = useRef<{ sessionsDir?: FileSystemDirectoryHandle; sessionDir?: FileSystemDirectoryHandle }>({})

  useEffect(() => {
    (async () => {
      setOpfsAvailable(null)
      const ok = await detectOPFSWriteSupport()
      setOpfsAvailable(ok)
      const id = loadOrCreateSessionId()
      setSessionId(id)
      if (!ok) {
        setSession(defaultSession(id))
        return
      }
      try {
        const { sessions } = await initOPFS()
        const { dir } = await ensureSessionDir({ root: {} as any, sessions }, id)
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
  }, [])

  const persistSession = useCallback(async (next: CorridorsSession) => {
    setSession(next)
    if (handlesRef.current.sessionDir) {
      try { await writeJSON(handlesRef.current.sessionDir, 'session.json', next) } catch {}
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
    const dir = handlesRef.current.sessionDir
    if (dir) {
      if (text == null) {
        // overwrite with empty file for clarity
        await writeTextFile(dir, 'original.kml', '')
      } else {
        await writeTextFile(dir, 'original.kml', text, 'application/vnd.google-earth.kml+xml')
      }
    }
  }, [session])

  const loadOriginalKmlText = useCallback(async (): Promise<string | null> => {
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
    loading,
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


