import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import MapGL, { Layer, Source, Marker, Popup } from 'react-map-gl/mapbox'
import type { MapRef } from 'react-map-gl/mapbox'
import type { GeoJSON, Geometry, Position } from 'geojson'
import type { LngLatBoundsLike, LngLatLike, StyleSpecification } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useI18n } from '../contexts/I18nContext'
import { shouldClearActivePhoto } from '../activePhoto/activePhoto'
import { isPhotoMarkerVisible, isMarkerVisibleOnMap } from './photoLayers/markerVisibility'
import { captureMapForPrint } from '../utils/mapCapture'
import type { PrintCaptureResult } from '../utils/mapCapture'
import type { PhotoFlag, PhotoLabel, PhotoMarker, GroundMarkerCallbacks } from '../types/markers'
import { ALL_PHOTO_LABELS, GROUND_MARKER_TYPES } from '../types/markers'
import { CaptureDotsLayer } from './photoLayers/CaptureDotsLayer'
import { useMarkerFan } from './photoLayers/useMarkerFan'
import { useEdgePanDrag } from './useEdgePanDrag'
import { MarkerDragHandle } from './MarkerDragHandle'
import { PhotoMarkerPopup } from '../components/PhotoMarkerPopup'
import { NO_GPS_PHOTO_DRAG_TYPE } from '../components/NoGpsTray'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import { isPickFlag } from '@airq/shared-handoff'
import { GROUND_MARKER_ICON } from '../components/GroundMarkerIcons'
import {
  LIVE_GROUND_MARKER_ICON_PX,
  LIVE_MARKER_DOT_BORDER_RADIUS_PX,
  LIVE_MARKER_DOT_PX,
  LIVE_MARKER_HIT_PX,
} from '../utils/markerSizes'

type Overlay = {
  id: string
  data: GeoJSON
  type: 'line' | 'fill' | 'circle'
  // Mapbox paint/layout prop shapes are a large discriminated union keyed by layer type.
  // `Record<string, unknown>` is narrow enough to catch typos without enumerating the union here.
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
}

export type MapProviderViewHandle = {
  captureForPrint: () => Promise<PrintCaptureResult>
  /**
   * Phase 7 — fly the map to a photo marker's location. Uses subject
   * coordinates for picks (`m.lng/lat`) and capture coordinates for
   * neutral/reject (`m.capturedAt.lng/lat`) so the user lands on the
   * dot they clicked in the side panel. No-op for unknown id or for
   * markers without coordinates we can land on.
   */
  flyToPhotoMarker: (markerId: string) => void
  /**
   * Phase 14 — current map center in lng/lat, or null if the map isn't ready.
   * Used to drop a provisional no-GPS placement pin at the view center.
   */
  getCenter: () => { lng: number; lat: number } | null
}

export const MapProviderView = forwardRef<MapProviderViewHandle, {
  /**
   * Already-resolved Mapbox style: either a `mapbox://` URL, a
   * hosted style JSON URL, or an inline `StyleSpecification` (raster
   * or vector). The caller resolves this from the selected style id
   * via `getStyleForId()` so the map doesn't need to know about the
   * provider registry.
   */
  mapStyle: string | StyleSpecification
  /** Mapbox access token — required for `mapbox://` styles, optional otherwise. */
  mapboxAccessToken?: string
  geojsonOverlays?: Overlay[]
  // Now `PhotoMarker[]` — the type gained optional `capturedAt`/`photoId`
  // in Phase 0. Markers without `capturedAt` are KML/click-placed (today's
  // behaviour); markers WITH `capturedAt` are EXIF-imported photos and
  // render through the photo-layers path (CaptureDotsLayer for unlabelled,
  // Phase 5 subject-pin for labelled).
  markers?: readonly PhotoMarker[]
  activeMarkerId?: string | null
  usedLabels?: string[]
  /**
   * Discipline-specific label set for the marker label picker. Defaults to
   * the legacy A..T letters when omitted (preserves rally / web behaviour).
   * Precision sessions pass the numeric set (1..20) so the popup buttons
   * match what photo-helper prints on the photos.
   */
  availableLabels?: readonly PhotoLabel[]
  markerDistanceNmById?: Record<string, number | null>
  onMarkerAdd?: (lng: number, lat: number) => void
  onMarkerDragEnd?: (id: string, lng: number, lat: number) => void
  onMarkerClick?: (id: string | null) => void
  onMarkerNameChange?: (id: string, name: string) => void
  onMarkerDelete?: (id: string) => void
  onMarkerLabelChange?: (id: string, label: PhotoLabel) => void
  onMarkerLabelClear?: (id: string) => void
  groundMarkerProps?: GroundMarkerCallbacks
  // Phase 5 of photo-map-culling — popup wiring for capture dots.
  // `storage` + `photosDir` let the popup load its thumbnail on demand.
  // The three action callbacks mutate `marker.flag` in the parent.
  // All five are optional so existing call sites (KML-only flows) don't
  // have to touch them; absence simply means no photo popup is shown.
  photoStorage?: StorageInterface | null
  photoDir?: DirectoryHandle | null
  // Two pick categories — track vs turning-point — so the cross-app handoff
  // can route the photo into the editor's matching print set (A3, 2026-05-30).
  onPhotoIncludeTrack?: (markerId: string) => void
  onPhotoIncludeTurning?: (markerId: string) => void
  onPhotoSkip?: (markerId: string) => void
  onPhotoReject?: (markerId: string) => void
  // Phase 6 — fires when a no-GPS thumbnail from NoGpsTray is dropped
  // on the map. Receives the photoId and the unprojected drop coords.
  onNoGpsPhotoPlaced?: (photoId: string, lng: number, lat: number) => void
  // Phase 13 — the active photo (its popup is open) is now lifted to App so
  // the side panel can highlight the same photo. This component is controlled:
  // it reads `activePhotoMarkerId` and requests changes via
  // `onActivePhotoMarkerChange`. `null` = no photo popup / nothing active.
  activePhotoMarkerId?: string | null
  onActivePhotoMarkerChange?: (id: string | null) => void
  // Double-clicking the popup thumbnail opens the full-res single-photo
  // preview. Receives the photoId (keyed the same as the panel rows).
  onPhotoPreview?: (photoId: string) => void
  // Phase 14 — provisional placement of a no-GPS photo: a draggable pin at the
  // map center whose popup commits the photo to a chosen category. `null` =
  // no placement in progress.
  provisionalPlacement?: { photoId: string; filename: string; lng: number; lat: number } | null
  onProvisionalDrag?: (lng: number, lat: number) => void
  onProvisionalCommit?: (flag: PhotoFlag | null) => void
  onProvisionalCancel?: () => void
}>(function MapProviderView(props, ref) {
  const { mapStyle, mapboxAccessToken, geojsonOverlays } = props

  const { t } = useI18n()

  const mapRef = useRef<MapRef | null>(null)
  const [isMapLoaded, setIsMapLoaded] = useState(false)
  // Live map bearing (degrees). Kept in sync via onMove so the reset-to-north
  // compass can rotate its needle and hide itself once the map is north-up.
  const [bearing, setBearing] = useState(0)
  const isRotated = Math.abs(((bearing % 360) + 360) % 360) > 0.5
  // Google-Earth-style "reset to north": animate bearing back to 0. easeTo
  // picks the shortest rotation path automatically. Shared by the compass
  // button and the `N` shortcut below.
  const resetNorth = useCallback(() => {
    mapRef.current?.getMap()?.easeTo({ bearing: 0, duration: 400 })
  }, [])
  const [confirmDeleteForId, setConfirmDeleteForId] = useState<string | null>(null)
  // Phase 5/13: which photo marker has its popup open. Lifted to App (Phase
  // 13) so the side panel can highlight the same photo — this component is now
  // controlled. Aliased to the same names the rest of the file already uses so
  // the read/set call sites below stay unchanged. Null = no photo popup.
  const activePhotoMarkerId = props.activePhotoMarkerId ?? null
  const onActivePhotoMarkerChange = props.onActivePhotoMarkerChange
  const setActivePhotoMarkerId = useCallback(
    (id: string | null) => { onActivePhotoMarkerChange?.(id) },
    [onActivePhotoMarkerChange],
  )
  // Custom marker drag with auto-pan when the cursor nears a viewport edge
  // (replaces react-map-gl's built-in `draggable`, which can't scroll the map
  // mid-drag without the dot sliding off the cursor — see useEdgePanDrag).
  // `activeDrag` is the live override position of whichever marker is mid-drag.
  const { activeDrag, controller: dragController } = useEdgePanDrag(mapRef)
  // Position a marker at its live drag override (if it's the one being dragged)
  // or its committed prop position otherwise.
  const liveDragPos = useCallback(
    (id: string, lng: number, lat: number) =>
      activeDrag && activeDrag.id === id ? { lng: activeDrag.lng, lat: activeDrag.lat } : { lng, lat },
    [activeDrag],
  )
  const photoFan = useMarkerFan({
    mapRef,
    isMapLoaded,
    markers: props.markers,
    // Auto-fan excludes the dragging marker so its dot snaps to the cursor
    // instead of sitting at its fan offset.
    draggingMarkerId: activeDrag?.id ?? null,
  })
  // `N` resets the map to north (Google-Earth style). Suppressed while typing
  // in a field (marker-name inputs live in popups) and for modifier combos
  // (e.g. Ctrl/Cmd+N "new window").
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      e.preventDefault()
      resetNorth()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [resetNorth])

  // Attach native DnD listeners on the canvas to support custom marker drops
  useEffect(() => {
    if (!isMapLoaded || !mapRef.current) return
    const map = mapRef.current.getMap()
    const canvas = map.getCanvas()
    const onDragOver = (e: DragEvent) => {
      const dt = e.dataTransfer
      if (!dt) return
      const types = Array.from(dt.types)
      const wantsPhoto = types.includes('application/x-photo-marker') && !!props.onMarkerAdd
      const wantsGround = types.includes('application/x-ground-marker') && !!props.groundMarkerProps
      const wantsNoGps = types.includes(NO_GPS_PHOTO_DRAG_TYPE) && !!props.onNoGpsPhotoPlaced
      if (wantsPhoto || wantsGround || wantsNoGps) {
        e.preventDefault()
        dt.dropEffect = wantsNoGps ? 'move' : 'copy'
      }
    }
    const onDrop = (e: DragEvent) => {
      if (!mapRef.current) return
      const dt = e.dataTransfer
      if (!dt) return
      const types = Array.from(dt.types)
      const unprojectAt = (clientX: number, clientY: number) => {
        const rect = (canvas as HTMLCanvasElement).getBoundingClientRect()
        return mapRef.current!.getMap().unproject([clientX - rect.left, clientY - rect.top])
      }
      if (types.includes('application/x-photo-marker')) {
        if (!props.onMarkerAdd) {
          console.error('[MapProviderView] Photo marker drop received but onMarkerAdd is not configured')
          return
        }
        e.preventDefault()
        const lngLat = unprojectAt(e.clientX, e.clientY)
        props.onMarkerAdd(lngLat.lng, lngLat.lat)
      } else if (types.includes('application/x-ground-marker')) {
        if (!props.groundMarkerProps) {
          console.error('[MapProviderView] Ground marker drop received but groundMarkerProps is not configured')
          return
        }
        e.preventDefault()
        const lngLat = unprojectAt(e.clientX, e.clientY)
        props.groundMarkerProps.onGroundMarkerAdd(lngLat.lng, lngLat.lat)
      } else if (types.includes(NO_GPS_PHOTO_DRAG_TYPE)) {
        if (!props.onNoGpsPhotoPlaced) return
        const photoId = dt.getData(NO_GPS_PHOTO_DRAG_TYPE)
        if (!photoId) return
        e.preventDefault()
        const lngLat = unprojectAt(e.clientX, e.clientY)
        props.onNoGpsPhotoPlaced(photoId, lngLat.lng, lngLat.lat)
      }
    }
    canvas.addEventListener('dragover', onDragOver)
    canvas.addEventListener('drop', onDrop)
    return () => {
      canvas.removeEventListener('dragover', onDragOver)
      canvas.removeEventListener('drop', onDrop)
    }
  }, [isMapLoaded, props.onMarkerAdd, props.groundMarkerProps, props.onNoGpsPhotoPlaced])

  // No MapGL.onClick / interactiveLayerIds needed in the
  // "every-photo-is-a-Marker" model — clicks land directly on the
  // <Marker> div, not on a GeoJSON layer feature.

  // Close the photo popup ONLY when the active marker disappears entirely
  // (deleted elsewhere). We must NOT close on flag/label transitions —
  // including reject — because clicking a rejected row in the side panel
  // re-opens its popup so the user can un-reject it; closing on reject breaks
  // that. Rejecting *via this popup* is dismissed by the explicit onReject
  // handler below, not here.
  useEffect(() => {
    if (shouldClearActivePhoto(props.markers ?? [], activePhotoMarkerId)) {
      setActivePhotoMarkerId(null)
    }
  }, [props.markers, activePhotoMarkerId, setActivePhotoMarkerId])

  const uploadedGeojson = useMemo(() => {
    return geojsonOverlays?.find((o) => o.id === 'uploaded-geojson')?.data
  }, [geojsonOverlays])

  function computeBbox(geojson: GeoJSON | null | undefined): [[number, number], [number, number]] | null {
    if (!geojson) return null
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity

    function processPosition(pos: Position | Position[] | Position[][] | Position[][][]) {
      if (!Array.isArray(pos)) return
      if (typeof pos[0] === 'number' && typeof pos[1] === 'number') {
        const lng = pos[0] as number
        const lat = pos[1] as number
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          if (lng < minLng) minLng = lng
          if (lat < minLat) minLat = lat
          if (lng > maxLng) maxLng = lng
          if (lat > maxLat) maxLat = lat
        }
        return
      }
      for (const p of pos as Position[] | Position[][] | Position[][][]) processPosition(p)
    }

    function processGeometry(geom: Geometry | null | undefined) {
      if (!geom) return
      if (geom.type === 'GeometryCollection') {
        for (const g of geom.geometries) processGeometry(g)
        return
      }
      processPosition(geom.coordinates)
    }

    if (geojson.type === 'FeatureCollection') {
      for (const f of geojson.features) processGeometry(f.geometry)
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
      ref.flyTo({ center: bounds[0] as LngLatLike, zoom: 18, duration: 600 })
      return
    }
    ref.fitBounds(bounds as LngLatBoundsLike, { padding: 40, maxZoom: 19, duration: 600 })
  }, [isMapLoaded, uploadedGeojson])

  const isElectron = !!(typeof window !== 'undefined' && window.electronAPI?.isElectron)
  // Only block the map when the currently selected style *needs* a Mapbox
  // token we don't have. Non-mapbox styles (OSM, Mapy.cz, ESRI) work with
  // no token, so we must not show the "configure token" wall for them.
  const needsToken = !mapboxAccessToken && typeof mapStyle === 'string' && mapStyle.startsWith('mapbox://')

  useImperativeHandle(ref, () => ({
    async captureForPrint() {
      // Compute bbox from the track overlay
      const trackOverlay = (geojsonOverlays || []).find(ov => ov.id === 'uploaded-geojson')
      if (!trackOverlay) throw new Error('No track data to print')
      const bbox = computeBbox(trackOverlay.data)
      if (!bbox) throw new Error('Could not compute track bounds')

      // Only include track line and exact-point labels — no corridors, no gates.
      // Gates (perpendicular start lines) cluttered the printed A4 (2026-04-18 feedback).
      const printOverlayIds = new Set(['uploaded-geojson', 'exact-points'])
      const printOverlays = (geojsonOverlays || [])
        .filter(ov => printOverlayIds.has(ov.id))
        .map(ov => ({
          id: ov.id,
          data: ov.data,
          type: ov.type as 'line' | 'circle',
          paint: ov.paint,
          layout: ov.layout,
        }))

      // Match the live map: rejected photos are hidden on screen, so the print
      // must skip them too — otherwise a rejected co-located variant prints a
      // stray dot at its original EXIF location next to the kept photo the user
      // dragged into place, looking like a duplicate. (isMarkerVisibleOnMap.)
      const printMarkers = (props.markers || [])
        .filter(isMarkerVisibleOnMap)
        .map(m => ({
          lng: m.lng,
          lat: m.lat,
          label: m.label,
        }))

      const printGroundMarkers = (props.groundMarkerProps?.groundMarkers || []).map(gm => ({
        lng: gm.lng,
        lat: gm.lat,
        type: gm.type,
      }))

      return captureMapForPrint({
        bbox: bbox as [[number, number], [number, number]],
        style: mapStyle,
        accessToken: mapboxAccessToken,
        overlays: printOverlays,
        markers: printMarkers,
        groundMarkers: printGroundMarkers,
      })
    },
    flyToPhotoMarker(markerId: string) {
      const marker = props.markers?.find(m => m.id === markerId)
      if (!marker) return
      const map = mapRef.current?.getMap()
      if (!map) return
      // Picks live at subject coords; neutral/reject live at capture
      // coords. Both use lng/lat or capturedAt.lng/lat — subject is
      // initialised to capturedAt on import (ADR-007), so for unmoved
      // markers either works. Picks may have been dragged.
      const center: [number, number] = isPickFlag(marker.flag)
        ? [marker.lng, marker.lat]
        : [marker.capturedAt?.lng ?? marker.lng, marker.capturedAt?.lat ?? marker.lat]
      map.flyTo({ center, zoom: Math.max(map.getZoom(), 14), duration: 700 })
      // Also open the photo popup so the panel click is a one-step
      // action (fly + preview + actions). KML/click markers don't have
      // a photo popup — guarded by photoId + capturedAt.
      if (marker.photoId && marker.capturedAt) {
        setActivePhotoMarkerId(markerId)
      }
    },
    getCenter() {
      const map = mapRef.current?.getMap()
      if (!map) return null
      const c = map.getCenter()
      return { lng: c.lng, lat: c.lat }
    },
  }), [geojsonOverlays, props.markers, props.groundMarkerProps?.groundMarkers, mapStyle, mapboxAccessToken, setActivePhotoMarkerId])

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
              onClick={() => window.electronAPI?.openMapboxSettings?.()}
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
      mapStyle={mapStyle}
      mapboxAccessToken={mapboxAccessToken}
      preserveDrawingBuffer
      initialViewState={{ longitude: 14.42076, latitude: 50.08804, zoom: 6 }}
      style={{ width: '100%', height: '100%' }}
      onLoad={() => setIsMapLoaded(true)}
      // Keep the local bearing in sync so the reset-to-north compass can rotate
      // its needle and show/hide itself. Bail when the rounded value is
      // unchanged to avoid a re-render on every drag-rotate frame.
      onMove={(e) => {
        const b = e.viewState.bearing ?? 0
        setBearing(prev => (Math.round(prev) === Math.round(b) ? prev : b))
      }}
      ref={mapRef}
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
      {/* Photo overlay layers: ghost dot at captured location + dashed
          line back to the live subject pin. Both only emit features for
          photos the user has dragged (capturedAt ≠ lng/lat). Unmoved
          photos see only their live <Marker> pin. */}
      {props.markers && <CaptureDotsLayer markers={props.markers} />}
      {/* Auto-fan leader lines: thin spokes from each overlapping cluster's
          centroid out to the fanned dots, so a stack of photos at one point
          reads as "these N belong here". Sits below the DOM markers (GL is
          always under react-map-gl <Marker> elements), so no z-fighting. */}
      {photoFan.leaders.features.length > 0 && (
        <Source id="photo-fan-leaders" type="geojson" data={photoFan.leaders}>
          <Layer
            id="photo-fan-leaders"
            type="line"
            paint={{
              'line-color': '#888888',
              'line-width': 1,
              'line-opacity': 0.7,
            }}
          />
        </Source>
      )}
      {/* KML / click-placed markers — existing render path. Photo
          markers (m.photoId !== undefined) are handled in the photo-
          pin block below to keep the click + popup semantics distinct
          (photo popup vs KML label picker). */}
      {props.markers?.filter(m => !m.photoId).map(m => {
        const pos = liveDragPos(m.id, m.lng, m.lat)
        return (
        <React.Fragment key={m.id}>
          <Marker
            longitude={pos.lng}
            latitude={pos.lat}
          >
            <MarkerDragHandle
              controller={dragController}
              id={m.id}
              lng={m.lng}
              lat={m.lat}
              // Drag: update position then open the popup (parity with the old
              // native onDragEnd). Tap: just open the popup.
              onCommit={(lng, lat) => { props.onMarkerDragEnd?.(m.id, lng, lat); props.onMarkerClick?.(m.id) }}
              onClick={() => props.onMarkerClick?.(m.id)}
            >
              <div style={{
                width: LIVE_MARKER_DOT_PX,
                height: LIVE_MARKER_DOT_PX,
                borderRadius: LIVE_MARKER_DOT_BORDER_RADIUS_PX,
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
            </MarkerDragHandle>
          </Marker>
          {props.activeMarkerId === m.id && (
            <Popup longitude={m.lng} latitude={m.lat} anchor="top" closeButton={true} closeOnMove={false}
              onClose={() => props.onMarkerClick?.(null)}
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
                  {(props.availableLabels ?? ALL_PHOTO_LABELS).map((L) => {
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
                        onClick={() => { props.onMarkerDelete?.(m.id); setConfirmDeleteForId(null); props.onMarkerClick?.(null) }}
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
                      onClick={() => props.onMarkerClick?.(null)}
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
        )
      })}
      {/* Photo markers — every photo is draggable. Pin position is the
          subject (m.lng/lat); fill is solid when the user has moved the
          marker away from its EXIF capture spot (= processed), hollow
          when still at the capture point (= awaiting placement).
          Click → photo popup (Phase 5). Drag → onMarkerDragEnd updates
          subject coords. The ghost dot + dashed line in
          PhotoOverlayLayers render only for moved photos.
          Rejected photos (flag='reject') are hidden from the map
          entirely — they remain in the list's "Odmítnuté" group as the
          undo path. Variant resolution (Phase 12) reuses this. */}
      {props.markers?.filter(isPhotoMarkerVisible).map(m => {
        const moved = !!m.capturedAt && (m.lng !== m.capturedAt.lng || m.lat !== m.capturedAt.lat)
        // Yellow = "labelled, answer-sheet ready" — matches the KML
        // marker color so a user scanning the map sees one consistent
        // visual for "this is going on the score sheet" regardless of
        // origin. Unlabelled photos colour by flag.
        // Unflagged ("neutral") photos use a high-contrast amber instead of the
        // old grey (#616161), which was nearly invisible on both street and
        // satellite basemaps — feedback 2026-05-30 ("brown dots, invisible").
        const ringColor = m.label ? '#facc15'
          : m.flag === 'pick-track' ? '#1976d2'
          : m.flag === 'pick-turning' ? '#7b1fa2'
          : m.flag === 'reject' ? '#d32f2f'
          : '#fb8c00'
        const bg = moved ? ringColor : '#ffffff'
        // Phase 13 — the active photo (popup open / selected in the side
        // panel) gets a glow + scale-up and is lifted above its neighbours.
        const isActive = activePhotoMarkerId === m.id
        const pos = liveDragPos(m.id, m.lng, m.lat)
        return (
          <Marker
            key={m.id}
            longitude={pos.lng}
            latitude={pos.lat}
            // Auto-fan: nudge overlapping markers apart by a pixel offset
            // (anchor stays at the true lng/lat). Suppressed while THIS marker
            // is being dragged so its dot tracks the cursor without a jump.
            offset={activeDrag?.id === m.id ? undefined : photoFan.offsets.get(m.id)}
            style={isActive ? { zIndex: 2 } : undefined}
          >
            <MarkerDragHandle
              controller={dragController}
              id={m.id}
              lng={m.lng}
              lat={m.lat}
              // Tap → open the photo popup. Real drag → commit the new subject
              // coords; intentionally do NOT auto-open the popup afterwards, so
              // it doesn't interrupt the user who has just placed the subject.
              onCommit={(lng, lat) => props.onMarkerDragEnd?.(m.id, lng, lat)}
              onClick={() => setActivePhotoMarkerId(m.id)}
            >
            <div style={{
              width: LIVE_MARKER_DOT_PX,
              height: LIVE_MARKER_DOT_PX,
              borderRadius: '50%',
              background: bg,
              border: `2px solid ${ringColor}`,
              position: 'relative',
              // Active marker: white halo + blue glow so it reads on any
              // basemap; otherwise the subtle drop shadow for moved photos.
              boxShadow: isActive
                ? '0 0 0 3px rgba(255,255,255,0.9), 0 0 10px 4px rgba(25,118,210,0.65)'
                : moved ? '0 1px 2px rgba(0,0,0,0.25)' : 'none',
              transform: isActive ? 'scale(1.3)' : undefined,
              transition: 'transform 120ms ease, box-shadow 120ms ease',
              cursor: 'pointer',
            }}>
              {/* Transparent click/tap halo — enlarges the hit target a few px
                  beyond the visible dot so markers are easier to grab without
                  making the dot itself huge (feedback 2026-05-30). Centered on
                  the dot; does not affect layout or the label offset. */}
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: LIVE_MARKER_HIT_PX,
                height: LIVE_MARKER_HIT_PX,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                background: 'transparent',
                cursor: 'pointer',
              }} />
            </div>
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
                border: '1px solid #e5e7eb',
              }}>{m.label}</div>
            )}
            </MarkerDragHandle>
          </Marker>
        )
      })}
      {/* Ground markers */}
      {props.groundMarkerProps?.groundMarkers.map(gm => {
        const gmp = props.groundMarkerProps!
        const Icon = GROUND_MARKER_ICON[gm.type]
        // Defense in depth: a persisted session with an unknown type would crash React here
        // without this guard. Session load already runs sanitizeGroundMarkers, but any future
        // code path that bypasses that validation (KML import, tests, migrations) is covered.
        if (!Icon) {
          console.error('[MapProviderView] Unknown ground marker type in session:', gm.type, gm.id)
          return null
        }
        const pos = liveDragPos(gm.id, gm.lng, gm.lat)
        return (
          <React.Fragment key={`gm-${gm.id}`}>
            <Marker
              longitude={pos.lng}
              latitude={pos.lat}
            >
              <MarkerDragHandle
                controller={dragController}
                id={gm.id}
                lng={gm.lng}
                lat={gm.lat}
                // Drag → move then open the type picker; tap → just open it
                // (parity with the old native handlers).
                onCommit={(lng, lat) => { gmp.onGroundMarkerDragEnd(gm.id, lng, lat); gmp.onGroundMarkerClick(gm.id) }}
                onClick={() => gmp.onGroundMarkerClick(gm.id)}
              >
                <div style={{
                  width: LIVE_MARKER_DOT_PX,
                  height: LIVE_MARKER_DOT_PX,
                  borderRadius: LIVE_MARKER_DOT_BORDER_RADIUS_PX,
                  background: '#FF9800',
                  border: '1px solid #333333',
                  cursor: 'pointer',
                  position: 'relative'
                }} />
                {/* Type icon label near the marker */}
                <div style={{
                  position: 'absolute',
                  transform: 'translate(10px, -6px)',
                  background: 'rgba(255,255,255,0.9)',
                  borderRadius: 4,
                  padding: '2px',
                  border: '1px solid #e5e7eb',
                  display: 'flex',
                  alignItems: 'center',
                }}>
                  <Icon size={LIVE_GROUND_MARKER_ICON_PX} />
                </div>
              </MarkerDragHandle>
            </Marker>
            {gmp.activeGroundMarkerId === gm.id && (
              <Popup longitude={gm.lng} latitude={gm.lat} anchor="top" closeButton closeOnMove={false}
                onClose={() => gmp.onGroundMarkerClick(null)}
              >
                <div style={{ minWidth: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, color: '#374151' }}>{t('groundPopup.type')}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                    {GROUND_MARKER_TYPES.map(type => {
                      const TypeIcon = GROUND_MARKER_ICON[type]
                      const isCurrent = gm.type === type
                      return (
                        <button
                          key={type}
                          onClick={() => gmp.onGroundMarkerTypeChange(gm.id, type)}
                          title={t(`groundTypes.${type}`)}
                          style={{
                            padding: 4,
                            borderRadius: 6,
                            border: isCurrent ? '2px solid #1d4ed8' : '1px solid #cbd5e1',
                            background: isCurrent ? '#eff6ff' : '#ffffff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <TypeIcon size={20} />
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                    <button
                      onClick={() => { gmp.onGroundMarkerDelete(gm.id); gmp.onGroundMarkerClick(null) }}
                      style={{
                        background: '#ef4444', color: 'white', border: 'none', borderRadius: 6,
                        padding: '6px 10px', fontSize: 13, cursor: 'pointer'
                      }}
                    >
                      {t('popup.delete')}
                    </button>
                    <button
                      onClick={() => gmp.onGroundMarkerClick(null)}
                      style={{
                        padding: '6px 10px', borderRadius: 6, border: '1px solid #1d4ed8',
                        background: '#1d4ed8', color: '#ffffff', cursor: 'pointer', fontSize: 13
                      }}
                    >
                      {t('popup.ok')}
                    </button>
                  </div>
                </div>
              </Popup>
            )}
          </React.Fragment>
        )
      })}
      {/* Phase 5 photo-marker popup. Mounted only when a capture dot is
          clicked AND the parent provides photo storage + handlers. */}
      {(() => {
        if (!activePhotoMarkerId) return null
        if (!props.photoStorage || !props.photoDir) return null
        if (!props.onPhotoIncludeTrack || !props.onPhotoIncludeTurning || !props.onPhotoSkip || !props.onPhotoReject) return null
        const marker = props.markers?.find(m => m.id === activePhotoMarkerId)
        if (!marker || !marker.capturedAt || !marker.photoId) return null
        const popupId = activePhotoMarkerId
        // When the active marker is fanned, shift the popup by the same pixel
        // offset so its tail points at the fanned dot the user clicked rather
        // than the (now-empty) true GPS point under the cluster.
        const fanOffset = photoFan.offsets.get(popupId)
        return (
          <Popup
            longitude={marker.lng}
            latitude={marker.lat}
            anchor="top"
            offset={fanOffset}
            closeButton
            closeOnMove={false}
            // Default Mapbox Popup auto-closes on any map click, which
            // races setActivePhotoMarkerId when the user clicks a
            // different marker — net state ends up null and the popup
            // appears stuck. closeOnClick=false lets the React state be
            // the single source of truth for popup visibility.
            closeOnClick={false}
            onClose={() => setActivePhotoMarkerId(null)}
            maxWidth="240px"
          >
            <PhotoMarkerPopup
              photoId={marker.photoId}
              filename={marker.displayName ?? marker.name}
              originalFilename={marker.displayName ? marker.name : undefined}
              timestamp={marker.capturedAt.timestamp}
              flag={marker.flag}
              storage={props.photoStorage}
              photosDir={props.photoDir}
              label={marker.label}
              availableLabels={props.availableLabels}
              usedLabels={props.usedLabels}
              onLabelChange={(L) => props.onMarkerLabelChange?.(popupId, L)}
              onLabelClear={() => props.onMarkerLabelClear?.(popupId)}
              onIncludeTrack={() => {
                props.onPhotoIncludeTrack?.(popupId)
                // Keep the popup open after picking — user often wants
                // to assign a label right after. Was: closed.
              }}
              onIncludeTurning={() => {
                props.onPhotoIncludeTurning?.(popupId)
              }}
              onSkip={() => {
                props.onPhotoSkip?.(popupId)
                setActivePhotoMarkerId(null)
              }}
              onReject={() => {
                props.onPhotoReject?.(popupId)
                setActivePhotoMarkerId(null)
              }}
              onPreview={props.onPhotoPreview ? () => props.onPhotoPreview?.(marker.photoId!) : undefined}
            />
          </Popup>
        )
      })()}
      {/* Phase 14 — provisional no-GPS placement: a draggable pin at the map
          center whose popup commits the photo to a chosen category. The photo
          stays in "Bez GPS" until a category button is pressed; closing the
          popup cancels. Distinct dashed ring marks it as not-yet-placed. */}
      {(() => {
        const prov = props.provisionalPlacement
        if (!prov) return null
        if (!props.photoStorage || !props.photoDir) return null
        const provPos = liveDragPos('provisional-placement', prov.lng, prov.lat)
        return (
          <React.Fragment key="provisional-placement">
            <Marker
              longitude={provPos.lng}
              latitude={provPos.lat}
            >
              <MarkerDragHandle
                controller={dragController}
                id="provisional-placement"
                lng={prov.lng}
                lat={prov.lat}
                onCommit={(lng, lat) => props.onProvisionalDrag?.(lng, lat)}
              >
                <div style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: 'rgba(25,118,210,0.25)',
                  border: '2px dashed #1976d2',
                  boxShadow: '0 0 0 3px rgba(255,255,255,0.9)',
                  cursor: 'grab',
                }} />
              </MarkerDragHandle>
            </Marker>
            <Popup
              longitude={provPos.lng}
              latitude={provPos.lat}
              anchor="top"
              closeButton
              closeOnMove={false}
              closeOnClick={false}
              onClose={() => props.onProvisionalCancel?.()}
              maxWidth="240px"
            >
              <PhotoMarkerPopup
                photoId={prov.photoId}
                filename={prov.filename}
                storage={props.photoStorage}
                photosDir={props.photoDir}
                onIncludeTrack={() => props.onProvisionalCommit?.('pick-track')}
                onIncludeTurning={() => props.onProvisionalCommit?.('pick-turning')}
                onSkip={() => props.onProvisionalCommit?.(null)}
                onReject={() => props.onProvisionalCommit?.('reject')}
              />
            </Popup>
          </React.Fragment>
        )
      })()}
      {/* Reset-to-north compass — appears only when the map is rotated. The
          needle rotates by -bearing so "N" keeps pointing at true north as the
          map turns; clicking eases the bearing back to 0 (so does the N key). */}
      {isRotated && (
        <button
          type="button"
          onClick={resetNorth}
          aria-label={t('photo.map.resetNorth')}
          title={t('photo.map.resetNorthTooltip')}
          style={{
            position: 'absolute', top: 12, left: 12, zIndex: 25,
            width: 40, height: 40, borderRadius: '50%', border: 'none',
            background: 'rgba(33,33,33,0.94)', color: '#fff', cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
          }}
        >
          <span style={{
            display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
            transform: `rotate(${-bearing}deg)`, transition: 'transform 120ms linear',
            lineHeight: 1,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#ff5252' }}>N</span>
            <span style={{ fontSize: 14, marginTop: -2 }}>▲</span>
          </span>
        </button>
      )}
    </MapGL>
  )
})




