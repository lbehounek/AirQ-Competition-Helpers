import mapboxgl from 'mapbox-gl'
import type { LngLatBoundsLike, StyleSpecification } from 'mapbox-gl'
import type { GeoJSON } from 'geojson'
import { groundMarkerSvgString } from '../components/GroundMarkerIcons'
import type { GroundMarkerType, PhotoLabel } from '../types/markers'

type OverlayConfig = {
  id: string
  data: GeoJSON
  type: 'line' | 'circle'
  // Mapbox paint/layout shapes are a layer-type-keyed discriminated union;
  // `Record<string, unknown>` is narrow enough to catch typos without enumerating it.
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
}

type MarkerConfig = {
  lng: number
  lat: number
  label?: PhotoLabel
}

type GroundMarkerPrintConfig = {
  lng: number
  lat: number
  type: GroundMarkerType
}

type PrintOptions = {
  bbox: [[number, number], [number, number]] // [[minLng, minLat], [maxLng, maxLat]]
  /** `mapbox://` URL, hosted style JSON URL, or an inline `StyleSpecification`. */
  style: string | StyleSpecification
  accessToken?: string
  overlays: OverlayConfig[]
  markers: MarkerConfig[]
  groundMarkers?: GroundMarkerPrintConfig[]
}

// Result of a print capture. `warnings` lists non-fatal issues (e.g. ground-marker
// SVGs that failed to load and were substituted with the diamond fallback) so the
// caller can surface them to the user rather than silently shipping a wrong map.
export type PrintCaptureResult = {
  blob: Blob
  warnings: string[]
}

// A4 at 300 DPI
const A4_LANDSCAPE = { width: 3508, height: 2480 }
const A4_PORTRAIT = { width: 2480, height: 3508 }
const TIMEOUT_MS = 15_000
const PADDING = 100 // pixels padding around track in print

/**
 * Render a high-resolution offscreen map at A4 300 DPI.
 * Auto-detects landscape vs portrait from the track bounding box.
 */
export async function captureMapForPrint(options: PrintOptions): Promise<PrintCaptureResult> {
  const { bbox, style, accessToken, overlays, markers } = options
  const warnings: string[] = []

  const dims = detectOrientation(bbox)

  // Create hidden container
  const container = document.createElement('div')
  container.style.width = `${dims.width}px`
  container.style.height = `${dims.height}px`
  container.style.position = 'absolute'
  container.style.left = '-9999px'
  container.style.top = '-9999px'
  container.style.visibility = 'hidden'
  document.body.appendChild(container)

  if (accessToken) {
    // Writes the Mapbox singleton directly instead of going through
    // `setProviderToken` so this utility stays dep-free of the mapProviders
    // module. The caller is expected to pass the same value the rest of the
    // app uses (`getMapboxAccessToken()`), so this is normally a no-op write.
    // If a caller ever passes a different value, the module-scoped
    // `_tokens.mapbox` will briefly lag until the next `setProviderToken`.
    mapboxgl.accessToken = accessToken
  }

  const map = new mapboxgl.Map({
    container,
    style,
    preserveDrawingBuffer: true,
    interactive: false,
    fadeDuration: 0,
    attributionControl: false,
    pixelRatio: 1,
  } as mapboxgl.MapOptions)

  try {
    // Wait for style to load
    await withTimeout(
      new Promise<void>(resolve => map.once('load', () => resolve())),
      TIMEOUT_MS,
      'Map style load timed out'
    )

    // Boost settlement/place labels so printed A4 maps have prominent town
    // names (feedback 2026-04-18). This only affects vector Mapbox styles —
    // raster styles (Mapy.cz, OSM, ESRI) bake labels into the tile image and
    // can't be re-styled at render time, but Mapy.cz's default Czech label
    // density is already strong enough.
    boostSettlementLabels(map)

    // Fit to track bounds
    map.fitBounds(bbox as LngLatBoundsLike, { padding: PADDING, duration: 0 })

    // Add GeoJSON overlays (track line, gates, exact-point labels)
    for (const ov of overlays) {
      map.addSource(ov.id, { type: 'geojson', data: ov.data })

      if (ov.type === 'line') {
        const isTrack = ov.id === 'uploaded-geojson'
        const basePaint = { 'line-color': '#00b3ff', 'line-width': 8, ...(ov.paint || {}) }
        // Boost line widths for print legibility
        const printPaint = isTrack
          ? { ...basePaint, 'line-width': 12 }
          : { ...basePaint, 'line-width': Math.max(6, (basePaint['line-width'] as number) * 4) }
        map.addLayer({
          id: `${ov.id}-line`,
          type: 'line',
          source: ov.id,
          paint: printPaint,
          layout: ov.layout ?? {},
        })
      } else if (ov.type === 'circle') {
        map.addLayer({
          id: `${ov.id}-circles`,
          type: 'circle',
          source: ov.id,
          paint: { 'circle-radius': 0, 'circle-color': '#000000', ...(ov.paint || {}) },
        })
        map.addLayer({
          id: `${ov.id}-labels`,
          type: 'symbol',
          source: ov.id,
          paint: { 'text-color': '#000000', 'text-halo-color': '#ffffff', 'text-halo-width': 4 },
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
            'text-size': 36,
            'text-offset': [0, -2],
            'text-anchor': 'bottom',
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            ...(ov.layout ?? {}),
          },
        })
      }
    }

    // Wait for all tiles + layers to render
    await withTimeout(
      new Promise<void>(resolve => map.once('idle', () => resolve())),
      TIMEOUT_MS,
      'Map tile rendering timed out'
    )

    // Capture the WebGL canvas
    const mapCanvas = map.getCanvas()
    const offscreen = document.createElement('canvas')
    offscreen.width = mapCanvas.width
    offscreen.height = mapCanvas.height
    const ctx = offscreen.getContext('2d')
    if (!ctx) throw new Error('Failed to create 2D canvas context — image may be too large for this device')
    ctx.drawImage(mapCanvas, 0, 0)

    // Scale factor: canvas pixels may differ from CSS pixels
    const scaleX = mapCanvas.width / dims.width
    const scaleY = mapCanvas.height / dims.height

    // Composite photo markers. Screen uses 8px diameter; print was tuned up to
    // 36px diameter originally — testing feedback (2026-04-18) said that was too
    // large on paper, so we drop to 20px diameter (10px radius) here.
    const markerRadius = 10 * scaleX
    const fontSize = Math.round(42 * scaleX)

    for (const m of markers) {
      const px = map.project([m.lng, m.lat])
      const x = px.x * scaleX
      const y = px.y * scaleY

      // Yellow circle with dark border
      ctx.beginPath()
      ctx.arc(x, y, markerRadius, 0, Math.PI * 2)
      ctx.fillStyle = '#FFFF00'
      ctx.fill()
      ctx.strokeStyle = '#333333'
      ctx.lineWidth = 1.5 * scaleX
      ctx.stroke()

      // Label pill
      if (m.label) {
        ctx.font = `bold ${fontSize}px Arial, sans-serif`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        const labelX = x + markerRadius + 4 * scaleX
        const metrics = ctx.measureText(m.label)
        const padX = 4 * scaleX
        const padY = 2 * scaleY
        const bgW = metrics.width + padX * 2
        const bgH = fontSize + padY * 2
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
        ctx.beginPath()
        ctx.roundRect(labelX - padX, y - bgH / 2, bgW, bgH, 4 * scaleX)
        ctx.fill()
        ctx.strokeStyle = '#e5e7eb'
        ctx.lineWidth = 1 * scaleX
        ctx.stroke()
        ctx.fillStyle = '#111111'
        ctx.fillText(m.label, labelX, y)
      }
    }

    // Composite ground markers (SVG icons).
    // SVG load failures are collected into `warnings` so the caller can surface them —
    // silently substituting a diamond for the wrong shape on a printed competition map
    // is a correctness bug, not a cosmetic one.
    const gms = options.groundMarkers || []
    if (gms.length) {
      // Match the photo-marker label pill height (~46 px) so the two symbol
      // types read at the same visual weight on A4 (feedback 2026-04-18 —
      // 72 px made ground markers dominate their photo neighbours).
      const iconSize = Math.round(40 * scaleX)
      const uniqueTypes = [...new Set(gms.map(gm => gm.type))]
      const gmImages = new Map<GroundMarkerType, HTMLImageElement>()
      const failedTypes = new Set<GroundMarkerType>()
      await Promise.all(uniqueTypes.map(async (type) => {
        const svgStr = groundMarkerSvgString(type, iconSize)
        if (!svgStr) {
          failedTypes.add(type)
          warnings.push(`Unknown ground marker type "${type}" — rendered as fallback diamond`)
          return
        }
        try {
          const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`
          const img = new Image()
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = () => reject(new Error(`image onerror for ${type}`))
            img.src = dataUrl
          })
          gmImages.set(type, img)
        } catch (err) {
          failedTypes.add(type)
          const reason = err instanceof Error ? err.message : String(err)
          warnings.push(`Failed to rasterize ground marker "${type}" (${reason}) — rendered as fallback diamond`)
        }
      }))
      if (failedTypes.size) {
        console.warn('[mapCapture] Ground marker SVG load failures:', Array.from(failedTypes))
      }
      // Match the on-screen layout: 8px dot at the true point, icon in a white
      // pill offset to the upper-right (feedback 2026-04-18 — the icon was
      // previously centered on the point and obscured the exact position).
      const iconPad = 4 * scaleX
      const pillRadius = 4 * scaleX
      for (const gm of gms) {
        const px = map.project([gm.lng, gm.lat])
        const x = px.x * scaleX
        const y = px.y * scaleY
        // Yellow dot marks the exact position.
        ctx.beginPath()
        ctx.arc(x, y, markerRadius, 0, Math.PI * 2)
        ctx.fillStyle = '#FFFF00'
        ctx.fill()
        ctx.strokeStyle = '#333333'
        ctx.lineWidth = 1.5 * scaleX
        ctx.stroke()

        const img = gmImages.get(gm.type)
        if (img) {
          // Offset the icon pill up and to the right of the dot. The pill's
          // left edge sits at `markerRadius + iconPad` from the dot; its
          // vertical midline is raised ~60% of the icon height so the pill
          // never overlaps the dot itself.
          const pillW = img.width + iconPad * 2
          const pillH = img.height + iconPad * 2
          const pillLeft = x + markerRadius + iconPad
          const pillTop = y - pillH * 0.6 - markerRadius * 0.5
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
          ctx.beginPath()
          ctx.roundRect(pillLeft, pillTop, pillW, pillH, pillRadius)
          ctx.fill()
          ctx.strokeStyle = '#e5e7eb'
          ctx.lineWidth = 1 * scaleX
          ctx.stroke()
          ctx.drawImage(img, pillLeft + iconPad, pillTop + iconPad, img.width, img.height)
        } else {
          // Fallback: orange diamond offset to the right (shape unavailable — see `warnings`)
          const r = 24 * scaleX
          const cx = x + markerRadius + iconPad + r
          const cy = y - r * 0.4 - markerRadius * 0.5
          ctx.beginPath()
          ctx.moveTo(cx, cy - r)
          ctx.lineTo(cx + r, cy)
          ctx.lineTo(cx, cy + r)
          ctx.lineTo(cx - r, cy)
          ctx.closePath()
          ctx.fillStyle = '#FF9800'
          ctx.fill()
          ctx.strokeStyle = '#333'
          ctx.lineWidth = 1 * scaleX
          ctx.stroke()
        }
      }
    }

    // Attribution
    const attrSize = Math.round(10 * scaleX)
    ctx.font = `${attrSize}px Arial, sans-serif`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillText('\u00A9 Mapbox \u00A9 OpenStreetMap', offscreen.width - 8 * scaleX, offscreen.height - 4 * scaleY)

    const blob = await new Promise<Blob>((resolve, reject) => {
      offscreen.toBlob(b => {
        if (b) resolve(b)
        else reject(new Error('Canvas toBlob returned null'))
      }, 'image/png')
    })
    return { blob, warnings }
  } finally {
    map.remove()
    document.body.removeChild(container)
  }
}

/** Detect landscape vs portrait from bbox aspect ratio, adjusted for Mercator projection. */
export function detectOrientation(bbox: [[number, number], [number, number]]) {
  const midLat = (bbox[0][1] + bbox[1][1]) / 2
  const lngSpan = Math.abs(bbox[1][0] - bbox[0][0]) * Math.cos(midLat * Math.PI / 180)
  const latSpan = Math.abs(bbox[1][1] - bbox[0][1])
  return lngSpan >= latSpan ? A4_LANDSCAPE : A4_PORTRAIT
}

/**
 * Vector Mapbox styles expose town / village labels as symbol layers whose
 * ids contain "settlement" or "place". Bump their `text-size` by 1.8× and
 * widen the halo so small towns don't disappear at print scale.
 *
 * Silent on raster styles (no matching layers). Silent on any layer whose
 * existing `text-size` is an expression we can't multiply — better to leave
 * it unchanged than throw and lose the whole print.
 */
export function boostSettlementLabels(map: mapboxgl.Map): void {
  const style = map.getStyle?.()
  if (!style || !Array.isArray(style.layers)) return
  const targetIdFragments = ['settlement', 'place-label', 'place_label', 'town-label', 'city-label']
  for (const layer of style.layers) {
    if (layer.type !== 'symbol') continue
    const id = String(layer.id)
    if (!targetIdFragments.some(frag => id.includes(frag))) continue

    // Split the three property writes so a failure on one doesn't skip the
    // others. Previously a single try/catch could leave a layer with boosted
    // text but no halo, making small towns unreadable on satellite imagery.
    let sizeBoosted = false
    try {
      const curr = map.getLayoutProperty(id, 'text-size')
      if (curr === undefined) {
        // Default Mapbox text-size applies; wrapping `undefined` in an
        // expression ('*', 1.8, undefined) would produce an invalid spec.
        // Skip rather than silently crashing the layer.
      } else {
        // Wrap existing value in a multiply expression so zoom-dependent
        // ramps keep their shape — just scaled up.
        const boosted = typeof curr === 'number' ? curr * 1.8 : ['*', 1.8, curr]
        map.setLayoutProperty(id, 'text-size', boosted as unknown as number)
        sizeBoosted = true
      }
    } catch (err) {
      console.warn(`[mapCapture] boostSettlementLabels: text-size failed for layer "${id}":`, err)
    }

    try {
      map.setPaintProperty(id, 'text-halo-width', 2)
      map.setPaintProperty(id, 'text-halo-color', '#ffffff')
    } catch (err) {
      console.warn(`[mapCapture] boostSettlementLabels: halo failed for layer "${id}" (size boosted: ${sizeBoosted}):`, err)
    }
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      val => { clearTimeout(timer); resolve(val) },
      err => { clearTimeout(timer); reject(err) }
    )
  })
}
