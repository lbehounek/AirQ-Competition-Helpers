import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import './App.css'

import { MapProviderView } from './map/MapProviderView'
import type { MapProviderViewHandle } from './map/MapProviderView'
// DropZone removed; map area acts as drop target
import type { GeoJSON } from 'geojson'
// import { buildBufferedCorridor } from './corridors/bufferCorridor'
import { buildPreciseCorridorsAndGates, DISCIPLINE_CONFIGS } from './corridors/preciseCorridor'
import type { Discipline } from './corridors/preciseCorridor'

import { Box, Button, Checkbox, Chip, Container, FormControlLabel, Typography, Dialog, DialogContent, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Tooltip, Alert } from '@mui/material'
import { Download, Place, Print, Home, PhotoCamera, Flag } from '@mui/icons-material'
import { downloadKML } from './utils/exportKML'
import { appendFeaturesToKML } from './utils/kmlMerge'
import { rasterizeGroundMarkerSet } from './utils/groundMarkerPng'
import { parseDisciplineFromSearch } from './utils/parseDiscipline'
import { MapStyleSelector } from './components/MapStyleSelector'
import { useMapStyle } from './hooks/useMapStyle'
import {
  getStyleForId,
  setProviderToken,
  subscribeToProvider,
  getProviderSnapshot,
  getMapboxAccessToken,
  type MapStyleId,
} from './config/mapProviders'
import { booleanPointInPolygon, point as turfPoint, polygon as turfPolygon } from '@turf/turf'
import { calculateDistance } from './corridors/segments'
import { useI18n } from './contexts/I18nContext'
import { useCorridorSessionOPFS } from './hooks/useCorridorSessionOPFS'
import type { PhotoLabel, GroundMarker, GroundMarkerType } from './types/markers'
import { ALL_PHOTO_LABELS, DEFAULT_GROUND_MARKER_TYPE } from './types/markers'

function App() {
  const { t } = useI18n()
  // Keep document title in sync with current language
  useEffect(() => {
    try { document.title = t('app.title') } catch {}
  }, [t])
  // Both provider tokens live in the shared `mapProviders.ts` module. We
  // don't mirror them into React state because the style resolver and the
  // `<MapProviderView>` token prop both read from that module directly —
  // keeping React state would introduce an extra render where `mapStyle`
  // and `mapboxAccessToken` could diverge.

  // Read competition ID and discipline from URL (set by desktop launcher)
  const competitionId = useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      return params.get('competitionId') || null
    } catch {
      return null
    }
  }, [])

  const urlDiscipline = useMemo(() => parseDisciplineFromSearch(window.location.search), [])

  // Fetch competition name from index for display
  const [competitionName, setCompetitionName] = useState<string | null>(null)
  useEffect(() => {
    if (!competitionId) return
    const electronAPI = window.electronAPI
    if (electronAPI?.competitions) {
      electronAPI.competitions.list().then((index: any) => {
        const comp = index?.competitions?.find((c: any) => c.id === competitionId)
        if (comp) setCompetitionName(comp.name)
      }).catch(() => {})
    }
  }, [competitionId])

  // Fetch Mapbox + Mapy.cz tokens from Electron config if running in desktop app,
  // falling back to Vite env vars in the browser build. Tokens are pushed into
  // the shared mapProviders module so the MapStyleSelector only offers styles
  // the user can actually render.
  useEffect(() => {
    // Vite replaces `import.meta.env.VITE_*` statically at build time — only
    // when the access is plain dot-form. Optional chaining / `(… as any)`
    // casts defeat that static analysis and leave literal `VITE_MAPY_TOKEN`
    // string lookups in the bundle, which of course return undefined at
    // runtime. Keep this direct.
    const envMapbox = import.meta.env.VITE_MAPBOX_TOKEN || null
    const envMapy = import.meta.env.VITE_MAPYCZ_TOKEN || null
    try {
      const mask = (v: unknown) => typeof v === 'string' && v.length > 4 ? `${v.slice(0, 4)}…(${v.length})` : (v ? 'set' : 'missing')
      const env = import.meta.env as Record<string, unknown>
      const detected = Object.keys(env).filter(k => k.startsWith('VITE_MAP'))
      console.info('[map tokens] VITE_MAPBOX_TOKEN:', mask(envMapbox), 'VITE_MAPYCZ_TOKEN:', mask(envMapy), 'detected keys:', detected)
    } catch {}
    const electronAPI = window.electronAPI
    if (electronAPI?.getConfig) {
      electronAPI.getConfig('mapboxToken').then((token: string | undefined) => {
        setProviderToken('mapbox', token || envMapbox)
      }).catch(() => {
        setProviderToken('mapbox', envMapbox)
      })
      electronAPI.getConfig('mapyToken').then((token: string | undefined) => {
        setProviderToken('mapy', token || envMapy)
      }).catch(() => {
        setProviderToken('mapy', envMapy)
      })
    } else {
      setProviderToken('mapbox', envMapbox)
      setProviderToken('mapy', envMapy)
    }
  }, [])
  const {
    session,
    backendAvailable,
    setMapStyleId,
    setMarkers: persistMarkers,
    setGroundMarkers: persistGroundMarkers,
    setUse1NmAfterSp,
    setComputedData,
    saveOriginalKmlText,
    loadOriginalKmlText,
  } = useCorridorSessionOPFS(competitionId)
  // Map-style selector — the hook resolves the user's persisted preference
  // against the currently-available styles (tokens can arrive async). The
  // resolved id is passed through `getStyleForId` to obtain either a
  // `mapbox://` URL or an inline raster style spec for MapProviderView.
  const persistMapStyleId = useCallback((id: MapStyleId) => {
    void setMapStyleId(id)
  }, [setMapStyleId])
  const [mapStyleId, selectMapStyleId, availableStyles] = useMapStyle({
    preferredId: session?.mapStyleId,
    onChange: persistMapStyleId,
  })
  // Subscribe to token changes so `getStyleForId` is re-evaluated once an
  // async-arriving Mapbox/Mapy key lands. Without this, the memo would stay
  // on the first-render fallback style and handing a `mapbox://` URL to the
  // map before the token propagates throws "API access token required".
  const tokenVersion = useSyncExternalStore(subscribeToProvider, getProviderSnapshot, getProviderSnapshot)
  const resolvedStyle = useMemo(() => getStyleForId(mapStyleId), [mapStyleId, tokenVersion])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mapRef = useRef<MapProviderViewHandle | null>(null)
  const markers = session?.markers ?? []
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null)
  const [isAnswerSheetOpen, setAnswerSheetOpen] = useState(false)
  const answerSheetRef = useRef<HTMLDivElement | null>(null)
  const usedLabels = useMemo(() => {
    const set = new Set<PhotoLabel>()
    for (const m of markers) if (m.label) set.add(m.label)
    return Array.from(set)
  }, [markers])

  // Ground markers state
  const groundMarkers: readonly GroundMarker[] = session?.groundMarkers ?? []
  const [activeGroundMarkerId, setActiveGroundMarkerId] = useState<string | null>(null)
  const labelToMarker = useMemo(() => {
    const mp = new Map<PhotoLabel, typeof markers[number]>()
    for (const m of markers) if (m.label) mp.set(m.label, m)
    return mp
  }, [markers])

  // Avoid infinite recompute loops by memoizing last compute signature
  const lastComputeSigRef = useRef<{ geojson: GeoJSON; discipline: Discipline; use1NmAfterSp: boolean } | null>(null)

  // Rally-only toggle: start the corridor 1 NM after SP instead of the 5 NM default.
  // Precision disciplines ignore this flag — the value came back in user feedback
  // 2026-04-18 and is persisted per-competition via `session.use1NmAfterSp`.
  const use1NmAfterSp = !!session?.use1NmAfterSp
  const effectiveDiscipline: Discipline = (urlDiscipline || session?.discipline || 'rally')
  const effectiveConfig = useMemo(() => {
    const base = DISCIPLINE_CONFIGS[effectiveDiscipline]
    if (effectiveDiscipline === 'rally' && use1NmAfterSp) {
      return { ...base, spAfterNm: 1.0 }
    }
    return base
  }, [effectiveDiscipline, use1NmAfterSp])

  // Precompute corridor polygons and start TP coordinates
  const corridorPolygons = useMemo(() => {
    type Ring = [number, number][]
    const res: Array<{ name: string; ring: Ring; bbox: [number, number, number, number]; startName: string; startCoord?: [number, number] } > = []
    const left = (session?.leftSegments && (session.leftSegments as any).features) ? (session.leftSegments as any).features : []
    const right = (session?.rightSegments && (session.rightSegments as any).features) ? (session.rightSegments as any).features : []
    const byName: Record<string, { left?: Ring; right?: Ring }> = {}
    for (const f of left) {
      const name = f.properties?.segment
      if (!name) continue
      byName[name] = byName[name] || {}
      byName[name].left = f.geometry?.coordinates as Ring
    }
    for (const f of right) {
      const name = f.properties?.segment
      if (!name) continue
      byName[name] = byName[name] || {}
      byName[name].right = f.geometry?.coordinates as Ring
    }
    // Build lookup of exact point coords by name (SP, TP n)
    const exactLookup: Record<string, [number, number]> = {}
    if (session?.exactPoints && (session.exactPoints as any).features) {
      for (const f of (session.exactPoints as any).features) {
        const role = f.properties?.role
        const nm = f.properties?.name
        if (role === 'exact' && nm && Array.isArray(f.geometry?.coordinates)) {
          const [lng, lat] = f.geometry.coordinates
          exactLookup[nm] = [lng, lat]
        }
      }
    }
    for (const name of Object.keys(byName)) {
      const pair = byName[name]
      if (!pair.left || !pair.right || pair.left.length < 2 || pair.right.length < 2) continue
      // normalize to 2D positions [lng, lat]
      const left2D: [number, number][] = (pair.left as any[]).map((c: any) => [Number(c[0]), Number(c[1])] as [number, number])
      const right2D: [number, number][] = (pair.right as any[]).map((c: any) => [Number(c[0]), Number(c[1])] as [number, number])
      let ring: Ring = [...left2D, ...right2D.slice().reverse()]
      // close ring after 2D normalization
      if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
        ring.push([ring[0][0], ring[0][1]])
      }
      // ensure minimum valid ring size
      if (ring.length < 4) continue
      // bbox
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng
        if (lat < minLat) minLat = lat
        if (lng > maxLng) maxLng = lng
        if (lat > maxLat) maxLat = lat
      }
      const beforeArrow = String(name).split('→')[0] || ''
      let startName = 'SP'
      if (beforeArrow.includes('SP')) startName = 'SP'
      else if (beforeArrow.includes('after-')) startName = beforeArrow.split('after-').pop() || 'SP'
      const startCoord = exactLookup[startName]
      res.push({ name, ring, bbox: [minLng, minLat, maxLng, maxLat], startName, startCoord })
    }
    return res
  }, [session?.leftSegments, session?.rightSegments, session?.exactPoints])

  // Compute per-marker distance info (NM) if inside a corridor
  const markerDistanceNmById = useMemo(() => {
    const out: Record<string, number | null> = {}
    const NM = 1852
    for (const m of markers) {
      let found: number | null = null
      for (const c of corridorPolygons) {
        const [minLng, minLat, maxLng, maxLat] = c.bbox
        if (m.lng < minLng || m.lng > maxLng || m.lat < minLat || m.lat > maxLat) continue
        try {
          const pt = turfPoint([m.lng, m.lat])
          const poly = turfPolygon([c.ring])
          if (booleanPointInPolygon(pt, poly)) {
            if (c.startCoord) {
              const meters = calculateDistance([c.startCoord[0], c.startCoord[1], 0], [m.lng, m.lat, 0])
              const nm = Math.round((meters / NM) * 100) / 100
              found = nm
            } else {
              found = null
            }
            break
          }
        } catch {}
      }
      out[m.id] = found
    }
    return out
  }, [markers, corridorPolygons])

  const markerFromTpById = useMemo(() => {
    const out: Record<string, string | null> = {}
    for (const m of markers) {
      let start: string | null = null
      for (const c of corridorPolygons) {
        const [minLng, minLat, maxLng, maxLat] = c.bbox
        if (m.lng < minLng || m.lng > maxLng || m.lat < minLat || m.lat > maxLat) continue
        try {
          const pt = turfPoint([m.lng, m.lat])
          const poly = turfPolygon([c.ring])
          if (booleanPointInPolygon(pt, poly)) {
            start = c.startName || null
            break
          }
        } catch {}
      }
      out[m.id] = start
    }
    return out
  }, [markers, corridorPolygons])

  const onFiles = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    // Store original KML text for export
    const fileText = await file.text()
    await saveOriginalKmlText(file.name.toLowerCase().endsWith('.kml') ? fileText : '')
    const { parseFileToGeoJSON } = await import('./parsers/detect')
    const parsed = await parseFileToGeoJSON(file)
    // compute corridors using discipline from URL param (desktop) or session fallback (web).
    // Rally honors the `use1NmAfterSp` flag; see `effectiveConfig` for details.
    try {
      const { gates, points, exactPoints, leftSegments, rightSegments } = buildPreciseCorridorsAndGates(parsed, effectiveConfig)
      await setComputedData({
        geojson: parsed,
        gates: gates && gates.length ? ({ type: 'FeatureCollection', features: gates } as any) : null,
        points: points && points.length ? ({ type: 'FeatureCollection', features: points } as any) : null,
        exactPoints: exactPoints && exactPoints.length ? ({ type: 'FeatureCollection', features: exactPoints } as any) : null,
        leftSegments: leftSegments && leftSegments.length ? ({ type: 'FeatureCollection', features: leftSegments } as any) : null,
        rightSegments: rightSegments && rightSegments.length ? ({ type: 'FeatureCollection', features: rightSegments } as any) : null,
      })
    } catch {
      await setComputedData({ geojson: parsed, gates: null, points: null, exactPoints: null, leftSegments: null, rightSegments: null })
    }
  }, [saveOriginalKmlText, effectiveConfig, setComputedData])

  // Recompute when discipline or the rally 1NM toggle changes
  useEffect(() => {
    if (!session?.geojson) return
    const input = session.geojson
    const last = lastComputeSigRef.current
    // Only recompute when input, discipline, or the 1NM flag changed
    if (last && last.geojson === input && last.discipline === effectiveDiscipline && last.use1NmAfterSp === use1NmAfterSp) return
    try {
      const { gates, points, exactPoints, leftSegments, rightSegments } = buildPreciseCorridorsAndGates(input, effectiveConfig)
      setComputedData({
        geojson: input,
        gates: gates && gates.length ? ({ type: 'FeatureCollection', features: gates } as any) : null,
        points: points && points.length ? ({ type: 'FeatureCollection', features: points } as any) : null,
        exactPoints: exactPoints && exactPoints.length ? ({ type: 'FeatureCollection', features: exactPoints } as any) : null,
        leftSegments: leftSegments && leftSegments.length ? ({ type: 'FeatureCollection', features: leftSegments } as any) : null,
        rightSegments: rightSegments && rightSegments.length ? ({ type: 'FeatureCollection', features: rightSegments } as any) : null,
      })
    } catch {
      setComputedData({ geojson: input, gates: null, points: null, exactPoints: null, leftSegments: null, rightSegments: null })
    } finally {
      lastComputeSigRef.current = { geojson: input, discipline: effectiveDiscipline, use1NmAfterSp }
    }
  }, [session?.geojson, effectiveDiscipline, use1NmAfterSp, effectiveConfig])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer?.types ? Array.from(e.dataTransfer.types as any) : []
    const isMarkerDrag = types.includes('application/x-photo-marker') || types.includes('application/x-ground-marker')
    const isFileDrag = (types.includes('Files') || types.includes('public.file-url')) && !isMarkerDrag
    if (!isFileDrag) return
    e.preventDefault()
    e.stopPropagation()
    if (!isDragOver) setIsDragOver(true)
  }, [isDragOver])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    const types = e.dataTransfer?.types ? Array.from(e.dataTransfer.types as any) : []
    const isMarkerDrag = types.includes('application/x-photo-marker') || types.includes('application/x-ground-marker')
    const isFileDrag = (types.includes('Files') || types.includes('public.file-url')) && !isMarkerDrag
    if (!isFileDrag) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const dt = e.dataTransfer
    const dropped: File[] = []
    if (dt.items && dt.items.length) {
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i]
        if (item.kind === 'file') {
          const f = item.getAsFile()
          if (f) dropped.push(f)
        }
      }
    } else if (dt.files && dt.files.length) {
      for (let i = 0; i < dt.files.length; i++) dropped.push(dt.files[i])
    }
    const kmlOrGpx = dropped.filter(f => f.name.toLowerCase().endsWith('.kml') || f.name.toLowerCase().endsWith('.gpx'))
    if (kmlOrGpx.length) {
      await onFiles(kmlOrGpx)
    }
  }, [onFiles])

  const onClickSelectFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    await onFiles([files[0]])
    // allow selecting the same file again later
    e.target.value = ''
  }, [onFiles])

  const handleExportKML = useCallback(async () => {
    const originalKmlText = await loadOriginalKmlText()
    if (!originalKmlText) {
      alert(t('errors.noOriginalKml'))
      return
    }
    // Export photo markers and ground markers — no corridors, gates, or exact point labels
    const features: any[] = []
    if (markers.length) {
      const markerFeatures = markers.map(m => {
        // Feedback 2026-04-18: drop the " - photo" fallback suffix — readers asked
        // for clean label-only names. Keep the filename only when the user supplied one.
        const displayName = m.label && m.name
          ? `${m.label} - ${m.name}`
          : (m.label || m.name || '')
        return {
          type: 'Feature',
          properties: {
            name: displayName,
            role: 'track_photos',
            label: m.label || undefined
          },
          geometry: { type: 'Point', coordinates: [m.lng, m.lat] }
        }
      })
      features.push(...markerFeatures as any)
    }
    if (groundMarkers.length) {
      const gmFeatures = groundMarkers.map(gm => ({
        type: 'Feature',
        properties: {
          // Feedback 2026-04-18: ground-marker labels cluttered the KML view.
          // Keep the type in ExtendedData (markerType) so round-tripping works,
          // but hide it from the visible <name>.
          name: '',
          role: 'ground_markers',
          markerType: gm.type,
        },
        geometry: { type: 'Point', coordinates: [gm.lng, gm.lat] }
      }))
      features.push(...gmFeatures as any)
    }
    const combinedGeoJSON = {
      type: 'FeatureCollection' as const,
      features
    }
    // Rasterize each used ground-marker shape to a PNG data URI so the exported
    // KML renders the same icons as the app and print output (feedback 2026-04-18).
    // Missing types fall back to the default yellow-dot style inside kmlMerge;
    // we surface the list of failures so the user knows the KML is partial.
    const uniqueTypes = Array.from(new Set(groundMarkers.map(gm => gm.type)))
    let groundMarkerIcons: Record<string, string> | undefined
    if (uniqueTypes.length) {
      const { icons, failed } = await rasterizeGroundMarkerSet(uniqueTypes, 128)
      groundMarkerIcons = icons
      if (failed.length) {
        console.warn('[kmlExport] Ground-marker rasterization failed for:', failed)
        alert(t('errors.someGroundMarkersFailed', { types: failed.join(', ') }))
      }
    }
    const mergedKml = appendFeaturesToKML(originalKmlText, combinedGeoJSON, 'corridors_export', { groundMarkerIcons })
    downloadKML(mergedKml, 'corridors_export.kml')
  }, [markers, groundMarkers, loadOriginalKmlText, t])

  const handlePrintMap = useCallback(async () => {
    if (!mapRef.current) return
    try {
      const { blob, warnings } = await mapRef.current.captureForPrint()
      const electronAPI = window.electronAPI

      if (electronAPI?.saveMapImage) {
        // Electron: save via native dialog
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result as string
            resolve(result.split(',')[1]) // strip data:image/png;base64, prefix
          }
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
        await electronAPI.saveMapImage(base64)
      } else {
        // Browser: download via anchor
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `map-print-${new Date().toISOString().slice(0, 10)}.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      }

      // Surface non-fatal warnings (e.g. ground markers rendered as fallback diamonds
      // because their SVG failed to load). On a competition map this matters.
      if (warnings.length) {
        alert(`${t('app.printMap')}:\n\n${warnings.join('\n')}`)
      }
    } catch (err) {
      console.error('Map print failed:', err)
      alert(err instanceof Error ? err.message : t('errors.printFailed'))
    }
  }, [t])

  // Drag source for placing photo markers
  const onDragStartMarker = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-photo-marker', '1')
    e.dataTransfer.effectAllowed = 'copy'
  }, [])

  // Drag source for placing ground markers
  const onDragStartGroundMarker = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-ground-marker', '1')
    e.dataTransfer.effectAllowed = 'copy'
  }, [])

  const handlePrintAnswerSheet = useCallback(() => {
    const container = answerSheetRef.current
    if (!container) return
    const html = container.innerHTML
    const w = window.open('', '_blank', 'noopener,noreferrer')
    if (!w) return
    try { (w as any).opener = null } catch {}
    const styles = `@page { size: A4 portrait; margin: 12mm; } body { font-family: Arial, sans-serif; color: #111; } table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #999; padding: 6px 8px; font-size: 12px; } th { background: #f2f2f2; text-align: left; }`
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${t('app.title')} - ${t('sheet.print')}</title><style>${styles}</style></head><body>${html}</body></html>`)
    w.document.close()
    try { w.focus() } catch {}
    try { w.print() } catch {}
    try { w.close() } catch {}
  }, [t])

  // Marker callbacks passed to map.
  // IDs are prefixed per marker kind so the shared drag-state refs in MapProviderView
  // (dragStartLngLatRef, dragMovedPxRef) cannot collide between photo and ground markers.
  const handleMarkerAdd = useCallback((lng: number, lat: number) => {
    const id = `pm-${Math.random().toString(36).slice(2)}`
    persistMarkers(prev => [...prev, { id, lng, lat, name: '' }])
    setActiveMarkerId(id)
  }, [persistMarkers])

  const handleMarkerDragEnd = useCallback((id: string, lng: number, lat: number) => {
    persistMarkers(prev => prev.map(m => m.id === id ? { ...m, lng, lat } : m))
  }, [persistMarkers])

  const handleMarkerClick = useCallback((id: string | null) => {
    setActiveMarkerId(id)
  }, [])

  const handleMarkerNameChange = useCallback((id: string, name: string) => {
    persistMarkers(prev => prev.map(m => m.id === id ? { ...m, name: name.slice(0, 30) } : m))
  }, [persistMarkers])

  const handleMarkerDelete = useCallback((id: string) => {
    persistMarkers(prev => prev.filter(m => m.id !== id))
    setActiveMarkerId(current => current === id ? null : current)
  }, [persistMarkers])

  const handleMarkerLabelChange = useCallback((id: string, label: PhotoLabel) => {
    persistMarkers(prev => {
      const current = prev.find(m => m.id === id)
      if (!current) return prev
      const isUsedElsewhere = prev.some(m => m.id !== id && m.label === label)
      if (isUsedElsewhere) return prev
      return prev.map(m => m.id === id ? { ...m, label } : m)
    })
  }, [persistMarkers])

  const handleMarkerLabelClear = useCallback((id: string) => {
    persistMarkers(prev => prev.map(m => m.id === id ? ({ ...m, label: undefined }) : m))
  }, [persistMarkers])

  // Ground marker callbacks
  const handleGroundMarkerAdd = useCallback((lng: number, lat: number) => {
    const id = `gm-${Math.random().toString(36).slice(2)}`
    persistGroundMarkers(prev => [...prev, { id, lng, lat, type: DEFAULT_GROUND_MARKER_TYPE }])
    setActiveGroundMarkerId(id)
  }, [persistGroundMarkers])

  const handleGroundMarkerDragEnd = useCallback((id: string, lng: number, lat: number) => {
    persistGroundMarkers(prev => prev.map(gm => gm.id === id ? { ...gm, lng, lat } : gm))
  }, [persistGroundMarkers])

  const handleGroundMarkerClick = useCallback((id: string | null) => {
    setActiveGroundMarkerId(id)
  }, [])

  const handleGroundMarkerTypeChange = useCallback((id: string, type: GroundMarkerType) => {
    persistGroundMarkers(prev => prev.map(gm => gm.id === id ? { ...gm, type } : gm))
  }, [persistGroundMarkers])

  const handleGroundMarkerDelete = useCallback((id: string) => {
    persistGroundMarkers(prev => prev.filter(gm => gm.id !== id))
    setActiveGroundMarkerId(current => current === id ? null : current)
  }, [persistGroundMarkers])

  return (
    <>
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%' }}>
      {/* Unified blue header */}
      <Box
        sx={{
          bgcolor: '#1565C0',
          color: 'white',
        }}
        data-print-hide="true"
      >
        {/* Title row */}
        <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {competitionId && window.electronAPI && (
              <IconButton size="small" onClick={() => window.electronAPI?.goHome?.()} sx={{ color: 'white' }} title={t('app.backToMenu')}>
                <Home />
              </IconButton>
            )}
            <Place sx={{ fontSize: 28 }} />
            <Typography variant="h6" sx={{ fontWeight: 600, color: 'white' }}>{t('app.title')}</Typography>
            {competitionName && (
              <Chip label={competitionName} size="small" sx={{ ml: 1, bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }} />
            )}
          </Box>
          {competitionId && window.electronAPI && (
            <IconButton size="small" onClick={() => window.electronAPI?.navigateToApp?.('photo-helper', competitionId)} sx={{ color: 'white' }} title="Photo Editor">
              <PhotoCamera />
            </IconButton>
          )}
        </Box>
        {/* Controls row */}
        <Box sx={{
          px: 2, py: 0.75,
          display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
          bgcolor: 'rgba(0,0,0,0.1)',
          '& .MuiButton-root': { color: 'white', borderColor: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', textTransform: 'none' },
          '& .MuiButton-contained': { bgcolor: 'rgba(255,255,255,0.2)', '&:hover': { bgcolor: 'rgba(255,255,255,0.3)' } },
          '& .MuiToggleButton-root': { color: 'rgba(255,255,255,0.7)', borderColor: 'rgba(255,255,255,0.3)', fontSize: '0.8rem', py: 0.25, px: 1.5,
            '&.Mui-selected': { color: 'white', bgcolor: 'rgba(255,255,255,0.2)' } },
          '& .MuiFormControlLabel-label': { color: 'white', fontSize: '0.8rem' },
          '& .MuiCheckbox-root': { color: 'rgba(255,255,255,0.7)', '&.Mui-checked': { color: 'white' } },
        }}>
          <input type="file" ref={fileInputRef} onChange={onFileInputChange} accept=".kml,.gpx,application/vnd.google-earth.kml+xml,application/gpx+xml" style={{ display: 'none' }} />
          <Button variant="contained" size="small" onClick={onClickSelectFile}>{t('app.selectKml')}</Button>
          {(session?.leftSegments || session?.rightSegments || session?.gates) && (
            <Button variant="outlined" size="small" onClick={handleExportKML} startIcon={<Download sx={{ fontSize: 16 }} />}>{t('app.exportKml')}</Button>
          )}
          {session?.geojson && (
            <Button variant="outlined" size="small" onClick={handlePrintMap} startIcon={<Print sx={{ fontSize: 16 }} />}>{t('app.printMap')}</Button>
          )}
          <Button variant="outlined" size="small" draggable onDragStart={onDragStartMarker} startIcon={<Place sx={{ fontSize: 16 }} />} title={t('app.dragToPlace')}>{t('app.dragToPlace')}</Button>
          <Button variant="outlined" size="small" draggable onDragStart={onDragStartGroundMarker} startIcon={<Flag sx={{ fontSize: 16 }} />} title={t('app.dragToPlaceGround')}>{t('app.dragToPlaceGround')}</Button>
          <MapStyleSelector
            mapStyle={mapStyleId}
            setMapStyle={selectMapStyleId}
            availableStyles={availableStyles}
            streetsLabel={t('app.toggleBase.streets')}
            aerialLabel={t('app.toggleBase.satellite')}
          />
          <Chip
            label={effectiveDiscipline === 'precision' ? t('app.discipline.precision') : t('app.discipline.rally')}
            size="small"
            sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white', fontWeight: 600 }}
          />
          {effectiveDiscipline === 'rally' && (
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={use1NmAfterSp}
                  onChange={(e) => setUse1NmAfterSp(e.target.checked)}
                />
              }
              label={t('app.use1NmAfterSp')}
            />
          )}
          <Box sx={{ flex: 1 }} />
          <Button variant="outlined" size="small" onClick={() => setAnswerSheetOpen(true)}>{t('app.answerSheet')}</Button>
        </Box>
      </Box>
      <Container disableGutters maxWidth={false} sx={{ flex: 1, minHeight: 0, width: '100vw' }}>
        <Box
          sx={{ height: '100%', width: '100vw', position: 'relative' }}
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {backendAvailable === false && (
            <Box sx={{ position: 'absolute', top: 8, left: 8, right: 8, zIndex: 20 }}>
              <Alert severity="warning">{t('opfs.warning')}</Alert>
            </Box>
          )}
          {isDragOver && (
            <Box sx={{
              position: 'absolute', inset: 0, zIndex: 10,
              bgcolor: 'rgba(25,118,210,0.06)',
              border: '2px dashed', borderColor: 'primary.main',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none'
            }}>
              <Typography variant="h6" color="primary.main">{t('app.dropHint')}</Typography>
            </Box>
          )}
          <MapProviderView
            ref={mapRef as any}
            mapStyle={resolvedStyle}
            // Pull the Mapbox token from the same module-scoped store the
            // style resolver reads, not from React state — otherwise the
            // token prop can lag one render behind `resolvedStyle` when a
            // `mapbox://` URL resolves in the same batch the token arrived.
            mapboxAccessToken={getMapboxAccessToken()}
            geojsonOverlays={[
              session?.geojson ? { id: 'uploaded-geojson', data: session.geojson, type: 'line' as const, paint: { 'line-color': '#d32f2f', 'line-width': 3 } } : null,
              // Segmented corridor borders in green
              session?.leftSegments ? { id: 'left-segments', data: session.leftSegments, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              session?.rightSegments && effectiveDiscipline !== 'precision' ? { id: 'right-segments', data: session.rightSegments, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              // Gates as red perpendicular lines marking corridor start points
              session?.gates ? { id: 'gates', data: session.gates, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              // Hide original KML waypoint labels to avoid duplicates; keep exactPoints labels
              session?.points ? { id: 'waypoints', data: session.points, type: 'circle' as const, paint: { 'circle-opacity': 0 }, layout: { 'text-field': '' } } : null,
              // Exact waypoints: hide dot markers (keep labels via symbol layout below)
              session?.exactPoints ? { id: 'exact-points', data: session.exactPoints, type: 'circle' as const, paint: { 'circle-radius': 0, 'circle-color': '#111111' }, layout: { 'text-field': ['get', 'name'], 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true } } : null,
            ].filter(Boolean) as any}
            markers={markers}
            activeMarkerId={activeMarkerId}
            usedLabels={usedLabels}
            markerDistanceNmById={markerDistanceNmById}
            onMarkerAdd={handleMarkerAdd}
            onMarkerDragEnd={handleMarkerDragEnd}
            onMarkerClick={handleMarkerClick}
            onMarkerNameChange={handleMarkerNameChange}
            onMarkerDelete={handleMarkerDelete}
            onMarkerLabelChange={handleMarkerLabelChange}
            onMarkerLabelClear={handleMarkerLabelClear}
            groundMarkerProps={{
              groundMarkers,
              activeGroundMarkerId,
              onGroundMarkerAdd: handleGroundMarkerAdd,
              onGroundMarkerDragEnd: handleGroundMarkerDragEnd,
              onGroundMarkerClick: handleGroundMarkerClick,
              onGroundMarkerTypeChange: handleGroundMarkerTypeChange,
              onGroundMarkerDelete: handleGroundMarkerDelete,
            }}
          />
        </Box>
      </Container>
    </Box>
    <Dialog open={isAnswerSheetOpen} onClose={() => setAnswerSheetOpen(false)} maxWidth="sm" fullWidth>
      <DialogContent dividers sx={{ p: 1 }}>
        <Box sx={{ position: 'relative' }}>
          <Tooltip title={t('sheet.print')}>
            <IconButton onClick={handlePrintAnswerSheet} size="small" sx={{ position: 'absolute', top: 4, right: 4 }} aria-label={t('sheet.print')}>
              <Print fontSize="small" />
            </IconButton>
          </Tooltip>
          <div ref={answerSheetRef}>
            <Table size="small" sx={{ '& .MuiTableCell-root': { py: 0.75, px: 1.25, fontSize: 15 } }}>
          <TableHead>
            <TableRow>
              <TableCell>{t('sheet.photoLabel')}</TableCell>
              <TableCell>{t('sheet.distance')}</TableCell>
              <TableCell>{t('sheet.fromTp')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ALL_PHOTO_LABELS.map((L) => {
              const m = labelToMarker.get(L)
              const dist = m ? markerDistanceNmById[m.id] : null
              const from = m ? (markerFromTpById[m.id] || '') : ''
              return (
                <TableRow key={L} hover>
                  <TableCell>{L}</TableCell>
                  <TableCell>{dist != null ? dist.toFixed(2) : ''}</TableCell>
                  <TableCell>{from}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
            </Table>
          </div>
        </Box>
      </DialogContent>
    </Dialog>
    </>
  )
}

export default App
