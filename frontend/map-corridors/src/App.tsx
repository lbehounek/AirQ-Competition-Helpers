import { useCallback, useMemo, useRef, useState } from 'react'
import './App.css'

import { MapProviderView } from './map/MapProviderView'
import type { MapProviderId } from './map/providers'
import { mapProviders } from './map/providers'
// DropZone removed; map area acts as drop target
import type { GeoJSON } from 'geojson'
// import { buildBufferedCorridor } from './corridors/bufferCorridor'
import { buildPreciseCorridorsAndGates } from './corridors/preciseCorridor'

import { AppBar, Box, Button, Container, Toolbar, Typography, Dialog, DialogTitle, DialogContent, Table, TableHead, TableRow, TableCell, TableBody, Switch } from '@mui/material'
import { Download, Place } from '@mui/icons-material'
import { downloadKML } from './utils/exportKML'
import { appendFeaturesToKML } from './utils/kmlMerge'
import { booleanPointInPolygon, point as turfPoint, polygon as turfPolygon } from '@turf/turf'
import { calculateDistance } from './corridors/segments'

function App() {
  const [provider] = useState<MapProviderId>('mapbox')
  const [baseStyle, setBaseStyle] = useState<'streets' | 'satellite'>('streets')
  const [geojson, setGeojson] = useState<GeoJSON | null>(null)
  // Remove buffer corridor state since we don't use it
  // continuous corridors removed; we use segmented only
  const [gates, setGates] = useState<GeoJSON | null>(null)
  const [points, setPoints] = useState<GeoJSON | null>(null)
  const [exactPoints, setExactPoints] = useState<GeoJSON | null>(null)
  const [leftSegments, setLeftSegments] = useState<GeoJSON | null>(null)
  const [rightSegments, setRightSegments] = useState<GeoJSON | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [originalKmlText, setOriginalKmlText] = useState<string | null>(null)
  type PhotoLabel = 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P'|'Q'|'R'|'S'|'T'
  const [markers, setMarkers] = useState<{ id: string; lng: number; lat: number; name: string; label?: PhotoLabel }[]>([])
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null)
  const [isAnswerSheetOpen, setAnswerSheetOpen] = useState(false)
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

  // Precompute corridor polygons and start TP coordinates
  const corridorPolygons = useMemo(() => {
    type Ring = [number, number][]
    const res: Array<{ name: string; ring: Ring; bbox: [number, number, number, number]; startName: string; startCoord?: [number, number] } > = []
    const left = (leftSegments && (leftSegments as any).features) ? (leftSegments as any).features : []
    const right = (rightSegments && (rightSegments as any).features) ? (rightSegments as any).features : []
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
    if (exactPoints && (exactPoints as any).features) {
      for (const f of (exactPoints as any).features) {
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
  }, [leftSegments, rightSegments, exactPoints])

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

  const providerConfig = useMemo(() => mapProviders[provider], [provider])

  const onFiles = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    // Store original KML text for export
    const fileText = await file.text()
    if (file.name.toLowerCase().endsWith('.kml')) {
      setOriginalKmlText(fileText)
    } else {
      setOriginalKmlText(null)
    }
    const { parseFileToGeoJSON } = await import('./parsers/detect')
    const parsed = await parseFileToGeoJSON(file)
    setGeojson(parsed)
    // Remove buffer corridor computation since we only use precise corridors
    try {
      const { gates, points, exactPoints, leftSegments, rightSegments } = buildPreciseCorridorsAndGates(parsed, 300)
      setGates(gates && gates.length ? ({ type: 'FeatureCollection', features: gates } as any) : null)
      setPoints(points && points.length ? ({ type: 'FeatureCollection', features: points } as any) : null)
      setExactPoints(exactPoints && exactPoints.length ? ({ type: 'FeatureCollection', features: exactPoints } as any) : null)
      setLeftSegments(leftSegments && leftSegments.length ? ({ type: 'FeatureCollection', features: leftSegments } as any) : null)
      setRightSegments(rightSegments && rightSegments.length ? ({ type: 'FeatureCollection', features: rightSegments } as any) : null)
    } catch {
      setGates(null); setPoints(null); setExactPoints(null); setLeftSegments(null); setRightSegments(null)
    }
  }, [])

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

  const handleExportKML = useCallback(() => {
    if (!originalKmlText) {
      alert('Original KML file not available for export')
      return
    }
    // Build only corridors, gates, and exact points as features to append
    const features: any[] = []
    if (leftSegments && leftSegments.type === 'FeatureCollection') {
      features.push(...leftSegments.features)
    }
    if (rightSegments && rightSegments.type === 'FeatureCollection') {
      features.push(...rightSegments.features)
    }
    if (gates && gates.type === 'FeatureCollection') {
      features.push(...gates.features)
    }
    if (exactPoints && exactPoints.type === 'FeatureCollection') {
      features.push(...exactPoints.features)
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
  }, [leftSegments, rightSegments, gates, exactPoints, originalKmlText])

  // Drag source for placing markers
  const onDragStartMarker = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-photo-marker', '1')
    e.dataTransfer.effectAllowed = 'copy'
  }, [])

  // Marker callbacks passed to map
  const handleMarkerAdd = useCallback((lng: number, lat: number) => {
    const id = Math.random().toString(36).slice(2)
    setMarkers(prev => [...prev, { id, lng, lat, name: '' }])
    setActiveMarkerId(id)
  }, [])

  const handleMarkerDragEnd = useCallback((id: string, lng: number, lat: number) => {
    setMarkers(prev => prev.map(m => m.id === id ? { ...m, lng, lat } : m))
  }, [])

  const handleMarkerClick = useCallback((id: string | null) => {
    setActiveMarkerId(id)
  }, [])

  const handleMarkerNameChange = useCallback((id: string, name: string) => {
    setMarkers(prev => prev.map(m => m.id === id ? { ...m, name: name.slice(0, 30) } : m))
  }, [])

  const handleMarkerDelete = useCallback((id: string) => {
    setMarkers(prev => prev.filter(m => m.id !== id))
    setActiveMarkerId(current => current === id ? null : current)
  }, [])

  const handleMarkerLabelChange = useCallback((id: string, label: PhotoLabel) => {
    setMarkers(prev => {
      const current = prev.find(m => m.id === id)
      if (!current) return prev
      const isUsedElsewhere = prev.some(m => m.id !== id && m.label === label)
      if (isUsedElsewhere) return prev
      return prev.map(m => m.id === id ? { ...m, label } : m)
    })
  }, [])

  const handleMarkerLabelClear = useCallback((id: string) => {
    setMarkers(prev => prev.map(m => m.id === id ? ({ ...m, label: undefined }) : m))
  }, [])

  return (
    <>
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%' }}>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" sx={{ mr: 1 }}>Map Corridors</Typography>
          <input
            type="file"
            ref={fileInputRef}
            onChange={onFileInputChange}
            accept=".kml,.gpx,application/vnd.google-earth.kml+xml,application/gpx+xml"
            style={{ display: 'none' }}
          />
          <Button variant="contained" color="primary" onClick={onClickSelectFile}>
            Select KML/GPX
          </Button>
          {(leftSegments || rightSegments || gates) && (
            <Button 
              variant="outlined" 
              color="success" 
              onClick={handleExportKML}
              startIcon={<Download />}
            >
              Export KML
            </Button>
          )}
          <Button
            variant="outlined"
            color="primary"
            draggable
            onDragStart={onDragStartMarker}
            startIcon={<Place />}
            title="Drag onto the map to place a photo marker"
          >
            Drag to place
          </Button>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography
              variant="body2"
              sx={{
                cursor: 'pointer',
                color: baseStyle === 'streets' ? 'primary.main' : 'text.secondary',
                fontWeight: baseStyle === 'streets' ? 600 : 400
              }}
              onClick={() => setBaseStyle('streets')}
            >
              Streets
            </Typography>
            <Switch
              checked={baseStyle === 'satellite'}
              onChange={() => setBaseStyle(prev => prev === 'streets' ? 'satellite' : 'streets')}
              inputProps={{ 'aria-label': 'Toggle base map' }}
            />
            <Typography
              variant="body2"
              sx={{
                cursor: 'pointer',
                color: baseStyle === 'satellite' ? 'primary.main' : 'text.secondary',
                fontWeight: baseStyle === 'satellite' ? 600 : 400
              }}
              onClick={() => setBaseStyle('satellite')}
            >
              Satellite
            </Typography>
          </Box>
          {/* Provider selection removed to use Mapbox only */}
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => setAnswerSheetOpen(true)}
            sx={{ ml: 'auto' }}
          >
            Generate Answer Sheet
          </Button>
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
          {isDragOver && (
            <Box sx={{
              position: 'absolute', inset: 0, zIndex: 10,
              bgcolor: 'rgba(25,118,210,0.06)',
              border: '2px dashed', borderColor: 'primary.main',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none'
            }}>
              <Typography variant="h6" color="primary.main">Drop KML/GPX to load</Typography>
            </Box>
          )}
          <MapProviderView
            provider={provider}
            baseStyle={baseStyle}
            providerConfig={providerConfig}
            geojsonOverlays={[
              geojson ? { id: 'uploaded-geojson', data: geojson, type: 'line' as const, paint: { 'line-color': '#f7ca00', 'line-width': 2 } } : null,
              // Segmented corridor borders in green
              leftSegments ? { id: 'left-segments', data: leftSegments, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              rightSegments ? { id: 'right-segments', data: rightSegments, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              // Gates as red perpendicular lines marking corridor start points
              gates ? { id: 'gates', data: gates, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              // Hide original KML waypoint labels to avoid duplicates; keep exactPoints labels
              points ? { id: 'waypoints', data: points, type: 'circle' as const, paint: { 'circle-opacity': 0 }, layout: { 'text-field': '' } } : null,
              // Exact waypoints with visible markers and labels
              exactPoints ? { id: 'exact-points', data: exactPoints, type: 'circle' as const, paint: { 'circle-radius': 4, 'circle-color': '#111111' }, layout: { 'text-field': ['get', 'name'], 'text-offset': [0, 1.2], 'text-anchor': 'top' } } : null,
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
      <DialogTitle>Answer Sheet</DialogTitle>
      <DialogContent dividers>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Photo label</TableCell>
              <TableCell>Distance</TableCell>
              <TableCell>From TP</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {allLabels.map((L) => {
              const m = labelToMarker.get(L)
              const dist = m ? markerDistanceNmById[m.id] : null
              const from = m ? (markerFromTpById[m.id] || '') : ''
              return (
                <TableRow key={L}>
                  <TableCell>{L}</TableCell>
                  <TableCell>{dist != null ? dist.toFixed(2) : ''}</TableCell>
                  <TableCell>{from}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
    </>
  )
}

export default App
