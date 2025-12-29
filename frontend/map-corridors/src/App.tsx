import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

import { MapProviderView } from './map/MapProviderView'
import type { MapProviderViewHandle } from './map/MapProviderView'
import type { MapProviderId } from './map/providers'
import { mapProviders } from './map/providers'
// DropZone removed; map area acts as drop target
import type { GeoJSON } from 'geojson'
// import { buildBufferedCorridor } from './corridors/bufferCorridor'
import { buildPreciseCorridorsAndGates } from './corridors/preciseCorridor'

import { AppBar, Box, Button, Container, Toolbar, Typography, Dialog, DialogContent, Table, TableHead, TableRow, TableCell, TableBody, ToggleButton, ToggleButtonGroup, Checkbox, FormControlLabel, IconButton, Tooltip, Alert } from '@mui/material'
import { Download, Place, Print } from '@mui/icons-material'
import { downloadKML } from './utils/exportKML'
import { appendFeaturesToKML } from './utils/kmlMerge'
import { booleanPointInPolygon, point as turfPoint, polygon as turfPolygon } from '@turf/turf'
import { calculateDistance } from './corridors/segments'
import { useI18n } from './contexts/I18nContext'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { useCorridorSessionOPFS } from './hooks/useCorridorSessionOPFS'

function App() {
  const { t } = useI18n()
  // Keep document title in sync with current language
  useEffect(() => {
    try { document.title = t('app.title') } catch {}
  }, [t])
  const [provider] = useState<MapProviderId>('mapbox')
  const [electronMapboxToken, setElectronMapboxToken] = useState<string | null>(null)

  // Fetch Mapbox token from Electron config if running in desktop app
  useEffect(() => {
    const electronAPI = (window as any).electronAPI
    if (electronAPI?.getConfig) {
      electronAPI.getConfig('mapboxToken').then((token: string | undefined) => {
        if (token) setElectronMapboxToken(token)
      }).catch(() => {})
    }
  }, [])
  const {
    session,
    backendAvailable,
    setBaseStyle,
    setUse1NmAfterSp,
    setMarkers: persistMarkers,
    setComputedData,
    saveOriginalKmlText,
    loadOriginalKmlText,
  } = useCorridorSessionOPFS()
  const baseStyle = (session?.baseStyle || 'streets') as 'streets' | 'satellite'
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mapRef = useRef<MapProviderViewHandle | null>(null)
  type PhotoLabel = 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P'|'Q'|'R'|'S'|'T'
  const markers = (session?.markers || []) as { id: string; lng: number; lat: number; name: string; label?: PhotoLabel }[]
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null)
  const [isAnswerSheetOpen, setAnswerSheetOpen] = useState(false)
  const answerSheetRef = useRef<HTMLDivElement | null>(null)
  const usedLabels = useMemo(() => {
    const set = new Set<PhotoLabel>()
    for (const m of markers) if (m.label) set.add(m.label)
    return Array.from(set)
  }, [markers])
  const allLabels: PhotoLabel[] = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T']
  const labelToMarker = useMemo(() => {
    const mp = new Map<PhotoLabel, { id: string; lng: number; lat: number; name: string; label?: PhotoLabel }>()
    for (const m of markers) if (m.label) mp.set(m.label, m)
    return mp
  }, [markers])

  // Avoid infinite recompute loops by memoizing last compute signature
  const lastComputeSigRef = useRef<{ geojson: GeoJSON; spAfterNm: number } | null>(null)

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

  // Use Electron config token if available, otherwise fall back to env var
  const providerConfig = useMemo(() => {
    const config = { ...mapProviders[provider] }
    if (electronMapboxToken && provider === 'mapbox') {
      config.accessToken = electronMapboxToken
    }
    return config
  }, [provider, electronMapboxToken])

  const onFiles = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    // Store original KML text for export
    const fileText = await file.text()
    await saveOriginalKmlText(file.name.toLowerCase().endsWith('.kml') ? fileText : '')
    const { parseFileToGeoJSON } = await import('./parsers/detect')
    const parsed = await parseFileToGeoJSON(file)
    // compute corridors using current SP-after setting
    const use1 = !!session?.use1NmAfterSp
    try {
      const { gates, points, exactPoints, leftSegments, rightSegments } = buildPreciseCorridorsAndGates(parsed, 300, use1 ? 1 : 5)
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
  }, [saveOriginalKmlText, session?.use1NmAfterSp, setComputedData])

  // Recompute when toggling SP-after distance
  useEffect(() => {
    if (!session?.geojson) return
    const input = session.geojson
    const spAfterNm = session.use1NmAfterSp ? 1 : 5
    const last = lastComputeSigRef.current
    // Only recompute when input or parameter changed
    if (last && last.geojson === input && last.spAfterNm === spAfterNm) return
    try {
      const { gates, points, exactPoints, leftSegments, rightSegments } = buildPreciseCorridorsAndGates(input, 300, spAfterNm)
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
      lastComputeSigRef.current = { geojson: input, spAfterNm }
    }
  }, [session?.geojson, session?.use1NmAfterSp])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer?.types ? Array.from(e.dataTransfer.types as any) : []
    const isMarkerDrag = types.includes('application/x-photo-marker')
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
    const isMarkerDrag = types.includes('application/x-photo-marker')
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
    // Build only corridors, gates, and exact points as features to append
    const features: any[] = []
    if (session?.leftSegments && session.leftSegments.type === 'FeatureCollection') {
      features.push(...session.leftSegments.features)
    }
    if (session?.rightSegments && session.rightSegments.type === 'FeatureCollection') {
      features.push(...session.rightSegments.features)
    }
    if (session?.gates && session.gates.type === 'FeatureCollection') {
      features.push(...session.gates.features)
    }
    if (session?.exactPoints && session.exactPoints.type === 'FeatureCollection') {
      features.push(...session.exactPoints.features)
    }
    // Append photo markers as Point features under track_photos via name property
    if (markers.length) {
      const markerFeatures = markers.map(m => ({
        type: 'Feature',
        properties: { 
          name: m.label ? `${m.label} - ${m.name || 'photo'}` : (m.name || 'photo'),
          role: 'track_photos',
          label: m.label || undefined
        },
        geometry: { type: 'Point', coordinates: [m.lng, m.lat] }
      }))
      features.push(...markerFeatures as any)
    }
    if (features.length > 0) {
      const combinedGeoJSON = {
        type: 'FeatureCollection' as const,
        features
      }
      const mergedKml = appendFeaturesToKML(originalKmlText, combinedGeoJSON, 'corridors_export')
      downloadKML(mergedKml, 'corridors_export.kml')
    }
  }, [session?.leftSegments, session?.rightSegments, session?.gates, session?.exactPoints, markers, loadOriginalKmlText, t])

  // Drag source for placing markers
  const onDragStartMarker = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-photo-marker', '1')
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

  // Marker callbacks passed to map
  const handleMarkerAdd = useCallback((lng: number, lat: number) => {
    const id = Math.random().toString(36).slice(2)
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

  return (
    <>
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%' }}>
      <AppBar position="static" color="default" elevation={1} data-print-hide="true">
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" sx={{ mr: 1 }}>{t('app.title')}</Typography>
          <input
            type="file"
            ref={fileInputRef}
            onChange={onFileInputChange}
            accept=".kml,.gpx,application/vnd.google-earth.kml+xml,application/gpx+xml"
            style={{ display: 'none' }}
          />
          <Button variant="contained" color="primary" onClick={onClickSelectFile}>
            {t('app.selectKml')}
          </Button>
          {(session?.leftSegments || session?.rightSegments || session?.gates) && (
            <Button 
              variant="outlined" 
              color="success" 
              onClick={handleExportKML}
              startIcon={<Download />}
            >
              {t('app.exportKml')}
            </Button>
          )}
          <Button
            variant="outlined"
            color="primary"
            draggable
            onDragStart={onDragStartMarker}
            startIcon={<Place />}
            title={t('app.dragToPlace')}
          >
            {t('app.dragToPlace')}
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            onClick={() => mapRef.current?.printMap()}
          >
            {t('app.printMap')}
          </Button>
          <ToggleButtonGroup
            value={baseStyle}
            exclusive
            onChange={(_, val) => { if (val) setBaseStyle(val) }}
            size="medium"
            color="primary"
            aria-label="Base map style"
            sx={{
              borderRadius: 1.5,
              height: 36,
              '& .MuiToggleButton-root': {
                minHeight: 36,
                lineHeight: 1.5,
                fontSize: 14,
                px: 2
              },
              '& .MuiToggleButtonGroup-grouped': {
                borderRadius: 1.5,
                px: 2,
                '&:not(:first-of-type)': { borderLeft: '1px solid', borderColor: 'divider' }
              }
            }}
          >
            <ToggleButton value="streets" aria-label={t('app.toggleBase.streets')}>{t('app.toggleBase.streets')}</ToggleButton>
            <ToggleButton value="satellite" aria-label={t('app.toggleBase.satellite')}>{t('app.toggleBase.satellite')}</ToggleButton>
          </ToggleButtonGroup>
          <FormControlLabel
            control={<Checkbox size="small" checked={!!session?.use1NmAfterSp} onChange={(e) => setUse1NmAfterSp(e.target.checked)} />}
            label={t('app.use1NmAfterSp')}
          />
          {/* Provider selection removed to use Mapbox only */}
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => setAnswerSheetOpen(true)}
            sx={{ ml: 'auto' }}
          >
            {t('app.answerSheet')}
          </Button>
          <LanguageSwitcher />
        </Toolbar>
      </AppBar>
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
            provider={provider}
            baseStyle={baseStyle}
            providerConfig={providerConfig}
            geojsonOverlays={[
              session?.geojson ? { id: 'uploaded-geojson', data: session.geojson, type: 'line' as const, paint: { 'line-color': '#f7ca00', 'line-width': 2 } } : null,
              // Segmented corridor borders in green
              session?.leftSegments ? { id: 'left-segments', data: session.leftSegments, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              session?.rightSegments ? { id: 'right-segments', data: session.rightSegments, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              // Gates as red perpendicular lines marking corridor start points
              session?.gates ? { id: 'gates', data: session.gates, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              // Hide original KML waypoint labels to avoid duplicates; keep exactPoints labels
              session?.points ? { id: 'waypoints', data: session.points, type: 'circle' as const, paint: { 'circle-opacity': 0 }, layout: { 'text-field': '' } } : null,
              // Exact waypoints: hide dot markers (keep labels via symbol layout below)
              session?.exactPoints ? { id: 'exact-points', data: session.exactPoints, type: 'circle' as const, paint: { 'circle-radius': 0, 'circle-color': '#111111' }, layout: { 'text-field': ['get', 'name'], 'text-offset': [0, 1.2], 'text-anchor': 'top' } } : null,
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
            {allLabels.map((L) => {
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
