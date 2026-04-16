import mapboxgl from 'mapbox-gl'
import { groundMarkerSvgString } from '../components/GroundMarkerIcons'
import type { GroundMarkerType, PhotoLabel } from '../types/markers'

type OverlayConfig = {
  id: string
  data: any
  type: 'line' | 'circle'
  paint?: Record<string, any>
  layout?: Record<string, any>
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
  style: string
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

    // Fit to track bounds
    map.fitBounds(bbox as any, { padding: PADDING, duration: 0 })

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

    // Composite photo markers (3x size for print legibility)
    const markerRadius = 18 * scaleX
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
      const iconSize = Math.round(72 * scaleX)
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
      for (const gm of gms) {
        const px = map.project([gm.lng, gm.lat])
        const x = px.x * scaleX
        const y = px.y * scaleY
        const img = gmImages.get(gm.type)
        if (img) {
          ctx.drawImage(img, x - img.width / 2, y - img.height / 2, img.width, img.height)
        } else {
          // Fallback: orange diamond (shape unavailable — see `warnings`)
          const r = 24 * scaleX
          ctx.beginPath()
          ctx.moveTo(x, y - r)
          ctx.lineTo(x + r, y)
          ctx.lineTo(x, y + r)
          ctx.lineTo(x - r, y)
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

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      val => { clearTimeout(timer); resolve(val) },
      err => { clearTimeout(timer); reject(err) }
    )
  })
}
