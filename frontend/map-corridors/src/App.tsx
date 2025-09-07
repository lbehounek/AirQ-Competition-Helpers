import { useCallback, useMemo, useRef, useState } from 'react'
import './App.css'

import { MapProviderView } from './map/MapProviderView'
import type { MapProviderId } from './map/providers'
import { mapProviders } from './map/providers'
// DropZone removed; map area acts as drop target
import type { GeoJSON } from 'geojson'
// import { buildBufferedCorridor } from './corridors/bufferCorridor'
import { buildPreciseCorridorsAndGates } from './corridors/preciseCorridor'

import { AppBar, Box, Button, Container, FormControl, InputLabel, MenuItem, Select, Toolbar, Typography } from '@mui/material'
import { Download, Place } from '@mui/icons-material'
import { downloadKML } from './utils/exportKML'
import { appendFeaturesToKML } from './utils/kmlMerge'

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
  const [markers, setMarkers] = useState<{ id: string; lng: number; lat: number; name: string }[]>([])
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null)

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
        properties: { name: m.name || 'photo', role: 'track_photos' },
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

  return (
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
          {(leftSegments || rightSegments || gates) && (
            <Button 
              variant="outlined" 
              color="secondary" 
              onClick={handleExportKML}
              startIcon={<Download />}
            >
              Export KML
            </Button>
          )}
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="base-style-label">Base</InputLabel>
            <Select
              labelId="base-style-label"
              value={baseStyle}
              label="Base"
              onChange={(e) => setBaseStyle(e.target.value as any)}
            >
              <MenuItem value="streets">Streets</MenuItem>
              <MenuItem value="satellite">Satellite</MenuItem>
            </Select>
          </FormControl>
          {/* Provider selection removed to use Mapbox only */}
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
            onMarkerAdd={handleMarkerAdd}
            onMarkerDragEnd={handleMarkerDragEnd}
            onMarkerClick={handleMarkerClick}
            onMarkerNameChange={handleMarkerNameChange}
            onMarkerDelete={handleMarkerDelete}
          />
        </Box>
      </Container>
    </Box>
  )
}

export default App
