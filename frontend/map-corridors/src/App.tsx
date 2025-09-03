import { useCallback, useMemo, useState } from 'react'
import './App.css'

import { MapProviderView } from './map/MapProviderView'
import type { MapProviderId } from './map/providers'
import { mapProviders } from './map/providers'
import { DropZone } from './components/DropZone'
import type { GeoJSON } from 'geojson'
// import { buildBufferedCorridor } from './corridors/bufferCorridor'
import { buildPreciseCorridorsAndGates } from './corridors/preciseCorridor'

import { AppBar, Box, Container, FormControl, InputLabel, MenuItem, Select, Toolbar, Typography } from '@mui/material'

function App() {
  const [provider, setProvider] = useState<MapProviderId>('maplibre')
  const [baseStyle, setBaseStyle] = useState<'streets' | 'satellite'>('streets')
  const [geojson, setGeojson] = useState<GeoJSON | null>(null)
  // Remove buffer corridor state since we don't use it
  const [leftCorr, setLeftCorr] = useState<GeoJSON | null>(null)
  const [rightCorr, setRightCorr] = useState<GeoJSON | null>(null)
  const [gates, setGates] = useState<GeoJSON | null>(null)
  const [points, setPoints] = useState<GeoJSON | null>(null)

  const providerConfig = useMemo(() => mapProviders[provider], [provider])

  const onFiles = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    const { parseFileToGeoJSON } = await import('./parsers/detect')
    const parsed = await parseFileToGeoJSON(file)
    setGeojson(parsed)
    // Remove buffer corridor computation since we only use precise corridors
    try {
      const { left, right, gates, points } = buildPreciseCorridorsAndGates(parsed, 300)
      setLeftCorr(left || null)
      setRightCorr(right || null)
      setGates(gates && gates.length ? ({ type: 'FeatureCollection', features: gates } as any) : null)
      setPoints(points && points.length ? ({ type: 'FeatureCollection', features: points } as any) : null)
    } catch {
      setLeftCorr(null); setRightCorr(null); setGates(null); setPoints(null)
    }
  }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%' }}>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" sx={{ mr: 1 }}>Map Corridors</Typography>
          <DropZone onDropFiles={onFiles} accept={{ 'application/vnd.google-earth.kml+xml': ['.kml'] }} />
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
      <Container disableGutters maxWidth={false} sx={{ flex: 1, minHeight: 0 }}>
        <Box sx={{ height: '100%', width: '100%' }}>
          <MapProviderView
            provider={provider}
            baseStyle={baseStyle}
            providerConfig={providerConfig}
            geojsonOverlays={[
              geojson ? { id: 'uploaded-geojson', data: geojson, type: 'line' as const, paint: { 'line-color': '#888', 'line-width': 2 } } : null,
              leftCorr ? { id: 'left-corr', data: leftCorr, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              rightCorr ? { id: 'right-corr', data: rightCorr, type: 'line' as const, paint: { 'line-color': '#00ff00', 'line-width': 2 } } : null,
              gates ? { id: 'gates', data: gates, type: 'line' as const, paint: { 'line-color': '#ff0000', 'line-width': 4 } } : null,
              points ? { id: 'waypoints', data: points, type: 'circle' as const, paint: { 'circle-color': '#0066ff', 'circle-radius': 6, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } } : null,
            ].filter(Boolean) as any}
          />
        </Box>
      </Container>
    </Box>
  )
}

export default App
