import React, { useEffect, useMemo, useRef, useState } from 'react'
import Map, { Layer, Source, Marker, Popup } from '@vis.gl/react-mapbox'
import type { MapRef } from '@vis.gl/react-mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { MapProviderId, ProviderConfig } from './providers'

type Overlay = {
  id: string
  data: any
  type: 'line' | 'fill' | 'circle'
  paint?: any
  layout?: any
}

export function MapProviderView(props: {
  provider: MapProviderId
  baseStyle: 'streets' | 'satellite'
  providerConfig: ProviderConfig
  geojsonOverlays?: Overlay[]
  markers?: { id: string; lng: number; lat: number; name: string }[]
  activeMarkerId?: string | null
  onMarkerAdd?: (lng: number, lat: number) => void
  onMarkerDragEnd?: (id: string, lng: number, lat: number) => void
  onMarkerClick?: (id: string | null) => void
  onMarkerNameChange?: (id: string, name: string) => void
  onMarkerDelete?: (id: string) => void
}) {
  const { baseStyle, providerConfig, geojsonOverlays } = props

  const styleUrl = providerConfig.styles[baseStyle]

  const mapRef = useRef<MapRef | null>(null)
  const [isMapLoaded, setIsMapLoaded] = useState(false)
  // Attach native DnD listeners on the canvas to support custom marker drops
  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current.getMap()
    const canvas = map.getCanvas()
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('application/x-photo-marker')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }
    const onDrop = (e: DragEvent) => {
      if (!mapRef.current) return
      const dt = e.dataTransfer
      if (dt && Array.from(dt.types).includes('application/x-photo-marker')) {
        e.preventDefault()
        const rect = (canvas as HTMLCanvasElement).getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const lngLat = mapRef.current.getMap().unproject([x, y])
        props.onMarkerAdd?.(lngLat.lng, lngLat.lat)
      }
    }
    canvas.addEventListener('dragover', onDragOver)
    canvas.addEventListener('drop', onDrop)
    return () => {
      canvas.removeEventListener('dragover', onDragOver)
      canvas.removeEventListener('drop', onDrop)
    }
  }, [mapRef.current])

  const uploadedGeojson = useMemo(() => {
    return geojsonOverlays?.find((o) => o.id === 'uploaded-geojson')?.data
  }, [geojsonOverlays])

  function computeBbox(geojson: any): [[number, number], [number, number]] | null {
    if (!geojson) return null
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity

    function processPosition(pos: any) {
      if (!Array.isArray(pos)) return
      if (typeof pos[0] === 'number' && typeof pos[1] === 'number') {
        const lng = pos[0]
        const lat = pos[1]
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          if (lng < minLng) minLng = lng
          if (lat < minLat) minLat = lat
          if (lng > maxLng) maxLng = lng
          if (lat > maxLat) maxLat = lat
        }
        return
      }
      for (const p of pos) processPosition(p)
    }

    function processGeometry(geom: any) {
      if (!geom) return
      const type = geom.type
      if (type === 'GeometryCollection') {
        for (const g of geom.geometries || []) processGeometry(g)
        return
      }
      processPosition(geom.coordinates)
    }

    if (geojson.type === 'FeatureCollection') {
      for (const f of geojson.features || []) processGeometry(f.geometry)
    } else if (geojson.type === 'Feature') {
      processGeometry(geojson.geometry)
    } else {
      processGeometry(geojson)
    }

    if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
      return null
    }
    return [[minLng, minLat], [maxLng, maxLat]]
  }

  useEffect(() => {
    if (!isMapLoaded || !uploadedGeojson) return
    const bounds = computeBbox(uploadedGeojson)
    const ref = mapRef.current
    if (!bounds || !ref) return

    // If it's a single point, fly to it with a high zoom
    const isPoint = bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]
    if (isPoint) {
      ref.flyTo({ center: bounds[0] as any, zoom: 18, duration: 600 })
      return
    }
    ref.fitBounds(bounds as any, { padding: 40, maxZoom: 19, duration: 600 })
  }, [isMapLoaded, uploadedGeojson])

  // Mapbox binding reads token via prop

  if (!providerConfig.accessToken && typeof styleUrl === 'string' && styleUrl.startsWith('mapbox://')) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', height: '100%',
        color: '#1A202C', background: '#F8FAFC',
        textAlign: 'center', padding: 16
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Mapbox token required</div>
          <div style={{ fontSize: 14 }}>
            Set VITE_MAPBOX_TOKEN in frontend/map-corridors/.env and restart the dev server.
          </div>
        </div>
      </div>
    )
  }

  return (
    <Map
      mapStyle={styleUrl}
      mapboxAccessToken={providerConfig.accessToken}
      initialViewState={{ longitude: 14.42076, latitude: 50.08804, zoom: 6 }}
      style={{ width: '100%', height: '100%' }}
      onLoad={() => setIsMapLoaded(true)}
      ref={mapRef as any}
    >
      {geojsonOverlays?.map((ov) => (
        <Source id={ov.id} key={ov.id} type="geojson" data={ov.data}>
          {ov.type === 'line' && (
            <Layer id={`${ov.id}-line`} type="line" paint={{ 'line-color': '#00b3ff', 'line-width': 3, ...(ov.paint || {}) }} layout={ov.layout ?? {}} />
          )}
          {ov.type === 'fill' && (
            <Layer id={`${ov.id}-fill`} type="fill" paint={{ 'fill-color': '#1d4ed8', 'fill-opacity': 0.25, ...(ov.paint || {}) }} layout={ov.layout ?? {}} />
          )}
          {ov.type === 'circle' && [
            // Optional visible dots
            <Layer 
              key={`${ov.id}-circles`}
              id={`${ov.id}-circles`} 
              type="circle"
              paint={{ 'circle-radius': 0, 'circle-color': '#000000', ...(ov.paint || {}) }}
            />,
            // Labels
            <Layer 
              key={`${ov.id}-labels`}
              id={`${ov.id}-labels`} 
              type="symbol" 
              paint={{ 'text-color': '#000000', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }} 
              layout={{ 
                'text-field': ['get', 'name'], 
                'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'], 
                'text-size': 12, 
                'text-offset': [0, -2],
                'text-anchor': 'bottom',
                ...(ov.layout ?? {}) 
              }} 
            />
          ]}
        </Source>
      ))}
      {/* Interactive markers */}
      {props.markers?.map(m => (
        <React.Fragment key={m.id}>
          <Marker
            longitude={m.lng}
            latitude={m.lat}
            draggable
            onClick={() => props.onMarkerClick?.(m.id)}
            onDragEnd={(ev: any) => {
              const ll = ev.lngLat
              props.onMarkerDragEnd?.(m.id, ll.lng, ll.lat)
            }}
          >
            <div style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              background: '#1976d2',
              border: '2px solid #ffffff',
              boxShadow: '0 0 0 2px rgba(25,118,210,0.3)',
              cursor: 'pointer'
            }} />
          </Marker>
          {props.activeMarkerId === m.id && (
            <Popup longitude={m.lng} latitude={m.lat} anchor="top" closeButton={true} closeOnMove={false}
              onClose={() => props.onMarkerClick?.(null as any)}
            >
              <div style={{ minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, color: '#374151' }}>Name</label>
                <input
                  type="text"
                  value={m.name}
                  onChange={(e) => props.onMarkerNameChange?.(m.id, e.target.value.slice(0, 30))}
                  placeholder="Photo name"
                  style={{
                    padding: '6px 8px',
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    fontSize: 14
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <button
                    onClick={() => props.onMarkerDelete?.(m.id)}
                    style={{
                      background: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontSize: 13,
                      cursor: 'pointer'
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </Popup>
          )}
        </React.Fragment>
      ))}
    </Map>
  )
}


