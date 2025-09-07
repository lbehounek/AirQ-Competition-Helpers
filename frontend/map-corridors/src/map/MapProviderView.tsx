import React, { useEffect, useMemo, useRef, useState } from 'react'
import MapGL, { Layer, Source, Marker, Popup } from '@vis.gl/react-mapbox'
import type { MapRef } from '@vis.gl/react-mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { MapProviderId, ProviderConfig } from './providers'
import { useI18n } from '../contexts/I18nContext'

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
  markers?: { id: string; lng: number; lat: number; name: string; label?: 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P'|'Q'|'R'|'S'|'T' }[]
  activeMarkerId?: string | null
  usedLabels?: string[]
  markerDistanceNmById?: Record<string, number | null>
  onMarkerAdd?: (lng: number, lat: number) => void
  onMarkerDragEnd?: (id: string, lng: number, lat: number) => void
  onMarkerClick?: (id: string | null) => void
  onMarkerNameChange?: (id: string, name: string) => void
  onMarkerDelete?: (id: string) => void
  onMarkerLabelChange?: (id: string, label: 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P'|'Q'|'R'|'S'|'T') => void
  onMarkerLabelClear?: (id: string) => void
}) {
  const { baseStyle, providerConfig, geojsonOverlays } = props

  const styleUrl = providerConfig.styles[baseStyle]
  const { t } = useI18n()

  const mapRef = useRef<MapRef | null>(null)
  const [isMapLoaded, setIsMapLoaded] = useState(false)
  const dragStartLngLatRef = useRef<Map<string, { lng: number, lat: number }>>(new Map())
  const dragMovedPxRef = useRef<Map<string, number>>(new Map())
  // Attach native DnD listeners on the canvas to support custom marker drops
  useEffect(() => {
    if (!isMapLoaded || !mapRef.current) return
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
  }, [isMapLoaded, props.onMarkerAdd])

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
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{t('errors.mapboxTokenRequired')}</div>
          <div style={{ fontSize: 14 }}>
            {t('errors.setToken')}
          </div>
        </div>
      </div>
    )
  }

  const allLabels: ('A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P'|'Q'|'R'|'S'|'T')[] = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T']

  return (
    <MapGL
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
            onClick={(ev: any) => {
              const moved = dragMovedPxRef.current.get(m.id) || 0
              if (moved < 8) {
                ev?.preventDefault?.()
                ev?.originalEvent?.stopPropagation?.()
                props.onMarkerClick?.(m.id)
              }
              dragStartLngLatRef.current.delete(m.id)
              dragMovedPxRef.current.delete(m.id)
            }}
            onDragStart={(ev: any) => {
              const ll = ev.lngLat
              dragStartLngLatRef.current.set(m.id, { lng: ll.lng, lat: ll.lat })
              dragMovedPxRef.current.set(m.id, 0)
            }}
            onDrag={(ev: any) => {
              const start = dragStartLngLatRef.current.get(m.id)
              if (!start || !mapRef.current) return
              const map = mapRef.current.getMap()
              const p0 = map.project([start.lng, start.lat] as any)
              const p1 = map.project([ev.lngLat.lng, ev.lngLat.lat] as any)
              const dx = p1.x - p0.x
              const dy = p1.y - p0.y
              const dist = Math.sqrt(dx*dx + dy*dy)
              dragMovedPxRef.current.set(m.id, dist)
            }}
            onDragEnd={(ev: any) => {
              const moved = dragMovedPxRef.current.get(m.id) || 0
              dragStartLngLatRef.current.delete(m.id)
              dragMovedPxRef.current.delete(m.id)
              if (moved < 8) {
                // Treat as click: do not update position, just open popup
                props.onMarkerClick?.(m.id)
              } else {
                const ll = ev.lngLat
                props.onMarkerDragEnd?.(m.id, ll.lng, ll.lat)
                props.onMarkerClick?.(m.id)
              }
            }}
          >
            <div style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: '#d32f2f',
              border: '1px solid #ffffff',
              cursor: 'pointer',
              position: 'relative'
            }} />
            {/* Letter label near the marker */}
            {m.label && (
              <div style={{
                position: 'absolute',
                transform: 'translate(10px, -6px)',
                background: 'rgba(255,255,255,0.85)',
                borderRadius: 4,
                padding: '0px 2px',
                fontSize: 11,
                lineHeight: '14px',
                fontWeight: 600,
                color: '#111',
                border: '1px solid #e5e7eb'
              }}>{m.label}</div>
            )}
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
                {/* Distance info */}
                <div style={{ fontSize: 12, color: '#374151' }}>
                  {props.markerDistanceNmById && props.markerDistanceNmById[m.id] != null
                    ? (<span>Distance from previous TP: <strong>{props.markerDistanceNmById[m.id]?.toFixed(2)}</strong> NM</span>)
                    : (<span>Outside corridors</span>)}
                </div>
                <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>Label</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 6 }}>
                  {allLabels.map((L) => {
                    const used = (props.usedLabels || []).includes(L)
                    const isCurrent = m.label === L
                    const disabled = used && !isCurrent
                    return (
                      <button
                        key={L}
                        onClick={() => !disabled && props.onMarkerLabelChange?.(m.id, L)}
                        disabled={disabled}
                        title={disabled ? 'Already used' : `Set label ${L}`}
                        style={{
                          padding: '4px 0',
                          borderRadius: 6,
                          border: '1px solid #cbd5e1',
                          background: isCurrent ? '#1d4ed8' : '#ffffff',
                          color: isCurrent ? '#ffffff' : (disabled ? '#9ca3af' : '#111827'),
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          fontWeight: 600,
                          fontSize: 12
                        }}
                      >{L}</button>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                  <button
                    onClick={() => props.onMarkerLabelClear?.(m.id)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid #e5e7eb',
                      background: '#ffffff',
                      color: '#111827',
                      cursor: 'pointer',
                      fontSize: 13
                    }}
                  >
                    Clear
                  </button>
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
    </MapGL>
  )
}


