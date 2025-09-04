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

function App() {
  const defaultProvider = ((import.meta as any).env?.VITE_MAPBOX_TOKEN ? 'mapbox' : 'maplibre') as MapProviderId
  const [provider, setProvider] = useState<MapProviderId>(defaultProvider)
  const [baseStyle, setBaseStyle] = useState<'streets' | 'satellite'>('streets')
  const [geojson, setGeojson] = useState<GeoJSON | null>(null)
  // Remove buffer corridor state since we don't use it
  // continuous corridors removed; we use segmented only
  const [gates, setGates] = useState<GeoJSON | null>(null)
  const [points, setPoints] = useState<GeoJSON | null>(null)
  const [leftSegments, setLeftSegments] = useState<GeoJSON | null>(null)
  const [rightSegments, setRightSegments] = useState<GeoJSON | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const providerConfig = useMemo(() => mapProviders[provider], [provider])

  const onFiles = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    const { parseFileToGeoJSON } = await import('./parsers/detect')
    const parsed = await parseFileToGeoJSON(file)
    setGeojson(parsed)
    // Remove buffer corridor computation since we only use precise corridors
    try {
      const { gates, points, leftSegments, rightSegments } = buildPreciseCorridorsAndGates(parsed, 300)
      setGates(gates && gates.length ? ({ type: 'FeatureCollection', features: gates } as any) : null)
      setPoints(points && points.length ? ({ type: 'FeatureCollection', features: points } as any) : null)
      setLeftSegments(leftSegments && leftSegments.length ? ({ type: 'FeatureCollection', features: leftSegments } as any) : null)
      setRightSegments(rightSegments && rightSegments.length ? ({ type: 'FeatureCollection', features: rightSegments } as any) : null)
    } catch {
      setGates(null); setPoints(null); setLeftSegments(null); setRightSegments(null)
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
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="provider-label">Provider</InputLabel>
            <Select
              labelId="provider-label"
              value={provider}
              label="Provider"
              onChange={(e) => setProvider(e.target.value as MapProviderId)}
            >
              <MenuItem value="maplibre">MapLibre</MenuItem>
              <MenuItem value="mapbox">Mapbox</MenuItem>
            </Select>
          </FormControl>
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
              geojson ? { id: 'uploaded-geojson', data: geojson, type: 'line' as const, paint: { 'line-color': '#888', 'line-width': 2 } } : null,
              // Segmented corridor borders in green
              leftSegments ? { id: 'left-segments', data: leftSegments, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              rightSegments ? { id: 'right-segments', data: rightSegments, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              // Render gates with same green styling so "red lines" become corridor borders
              gates ? { id: 'gates', data: gates, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              // Waypoint labels only, no points
              points ? { id: 'waypoints', data: points, type: 'circle' as const, paint: { 'circle-opacity': 0 } } : null,
            ].filter(Boolean) as any}
          />
        </Box>
      </Container>
    </Box>
  )
}

export default App
