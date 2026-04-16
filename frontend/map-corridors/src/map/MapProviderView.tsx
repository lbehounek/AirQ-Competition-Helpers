import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import MapGL, { Layer, Source, Marker, Popup } from 'react-map-gl/mapbox'
import type { MapRef } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { MapProviderId, ProviderConfig } from './providers'
import { useI18n } from '../contexts/I18nContext'
import { captureMapForPrint } from '../utils/mapCapture'

type PhotoLabel = 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J'|'K'|'L'|'M'|'N'|'O'|'P'|'Q'|'R'|'S'|'T'
const ALL_LABELS: PhotoLabel[] = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T']

type Overlay = {
  id: string
  data: any
  type: 'line' | 'fill' | 'circle'
  paint?: any
  layout?: any
}

export type MapProviderViewHandle = {
  captureForPrint: () => Promise<Blob>
}

export const MapProviderView = forwardRef<MapProviderViewHandle, {
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
}>(function MapProviderView(props, ref) {
  const { baseStyle, providerConfig, geojsonOverlays } = props

  const styleUrl = providerConfig.styles[baseStyle]
  const { t } = useI18n()

  const mapRef = useRef<MapRef | null>(null)
  const [isMapLoaded, setIsMapLoaded] = useState(false)
  const [confirmDeleteForId, setConfirmDeleteForId] = useState<string | null>(null)
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

  const isElectron = !!(typeof window !== 'undefined' && (window as any).electronAPI?.isElectron)
  const needsToken = !providerConfig.accessToken && typeof styleUrl === 'string' && styleUrl.startsWith('mapbox://')

  useImperativeHandle(ref, () => ({
    async captureForPrint() {
      // Compute bbox from the track overlay
      const trackOverlay = (geojsonOverlays || []).find(ov => ov.id === 'uploaded-geojson')
      if (!trackOverlay) throw new Error('No track data to print')
      const bbox = computeBbox(trackOverlay.data)
      if (!bbox) throw new Error('Could not compute track bounds')

      // Only include track line, gates, and exact-point labels — no corridors
      const printOverlayIds = new Set(['uploaded-geojson', 'gates', 'exact-points'])
      const printOverlays = (geojsonOverlays || [])
        .filter(ov => printOverlayIds.has(ov.id))
        .map(ov => ({
          id: ov.id,
          data: ov.data,
          type: ov.type as 'line' | 'circle',
          paint: ov.paint,
          layout: ov.layout,
        }))

      const printMarkers = (props.markers || []).map(m => ({
        lng: m.lng,
        lat: m.lat,
        label: m.label,
      }))

      return captureMapForPrint({
        bbox: bbox as [[number, number], [number, number]],
        style: styleUrl,
        accessToken: providerConfig.accessToken,
        overlays: printOverlays,
        markers: printMarkers,
      })
    }
  }), [geojsonOverlays, props.markers, styleUrl, providerConfig.accessToken])

  if (needsToken) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', height: '100%',
        color: '#1A202C', background: '#F8FAFC',
        textAlign: 'center', padding: 24
      }}>
        <div style={{ maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🗺️</div>
          <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>{t('errors.mapboxTokenRequired')}</div>
          <div style={{ fontSize: 14, color: '#4A5568', lineHeight: 1.6, marginBottom: 20 }}>
            {t('errors.mapboxTokenDescription')}
          </div>
          {isElectron ? (
            <button
              onClick={() => (window as any).electronAPI?.openMapboxSettings?.()}
              style={{
                padding: '12px 24px',
                fontSize: 15,
                fontWeight: 500,
                background: '#1976D2',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer'
              }}
            >
              {t('errors.configureToken')}
            </button>
          ) : (
            <div style={{ fontSize: 13, color: '#718096' }}>
              {t('errors.setTokenWeb')}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <a
              href="https://mapbox.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, color: '#1976D2', textDecoration: 'none' }}
            >
              {t('errors.getTokenLink')}
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <MapGL
      mapStyle={styleUrl}
      mapboxAccessToken={providerConfig.accessToken}
      preserveDrawingBuffer
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
                'text-size': 16, 
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
              background: '#FFFF00',
              border: '1px solid #333333',
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
                padding: '1px 4px',
                fontSize: 14,
                lineHeight: '18px',
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
                  {ALL_LABELS.map((L) => {
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
                {confirmDeleteForId === m.id ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <div style={{ fontSize: 12, color: '#374151' }}>{t('popup.confirmDelete')}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => setConfirmDeleteForId(null)}
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
                        {t('popup.cancel')}
                      </button>
                      <button
                        onClick={() => { props.onMarkerDelete?.(m.id); setConfirmDeleteForId(null); props.onMarkerClick?.(null as any) }}
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
                        {t('popup.delete')}
                      </button>
                    </div>
                  </div>
                ) : (
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
                      {t('popup.clear')}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteForId(m.id)}
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
                      {t('popup.delete')}
                    </button>
                    <button
                      onClick={() => props.onMarkerClick?.(null as any)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid #1d4ed8',
                        background: '#1d4ed8',
                        color: '#ffffff',
                        cursor: 'pointer',
                        fontSize: 13
                      }}
                    >
                      {t('popup.ok')}
                    </button>
                  </div>
                )}
              </div>
            </Popup>
          )}
        </React.Fragment>
      ))}
    </MapGL>
  )
})




