import { groundMarkerSvgString } from '../components/GroundMarkerIcons'
import type { GroundMarkerType } from '../types/markers'

/**
 * Rasterize a ground-marker SVG to a PNG data URI.
 *
 * KML `IconStyle` supports image hrefs via data URIs; Google Earth
 * renders PNG data URIs reliably while inline SVG support is
 * inconsistent. We draw the SVG to an offscreen canvas and export PNG
 * so the KML export can show the same marker shape users see on screen
 * and in printed A4 (feedback 2026-04-18).
 *
 * Returns `null` for unknown types (mirrors `groundMarkerSvgString`),
 * and for environments that can't mint a 2D canvas context. Any error
 * thrown by `drawImage` / `toDataURL` (e.g. canvas tainting, OOM on
 * very large canvases) is also caught and returned as `null` so the
 * function's contract holds — callers can branch on `null` to surface
 * a warning instead of producing a broken KML `<href>`.
 *
 * `stroke` is restricted to a safe whitelist because it is embedded into
 * the SVG source unescaped — any caller wanting a new color has to be
 * added explicitly.
 */
type SafeStroke = 'black' | 'white'

export async function rasterizeGroundMarker(
  type: GroundMarkerType,
  sizePx: number,
  stroke: SafeStroke = 'black',
): Promise<string | null> {
  const svg = groundMarkerSvgString(type, sizePx, stroke)
  if (!svg) return null
  const svgUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const img = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(`image onerror for ${type}`))
      img.src = svgUri
    })
  } catch {
    return null
  }
  // Pin-style composite icon — feedback 2026-04-25:
  // "kml export for ground marker is not supposed to be yellow circle, but
  //  a pin … like square white with black marker shape on it, next to a
  //  pin that marks the exact position".
  // The image is a tall canvas: a white square with the FAI symbol on top,
  // a small connector, and a light-blue downward-pointing pin that anchors
  // to the exact lat/lng (via `hotSpot` x=0.5 y=0 set in `kmlMerge.ts`).
  const w = sizePx
  const h = Math.round(sizePx * 1.5)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    // Section 1 — white square with the FAI symbol, black border (top 2/3).
    const boxH = Math.round(h * 2 / 3)
    const border = Math.max(2, Math.round(sizePx / 32))
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, w, boxH)
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = border
    ctx.strokeRect(border / 2, border / 2, w - border, boxH - border)

    // Symbol drawn inside the square with breathing room.
    const pad = Math.max(4, Math.round(sizePx * 0.10))
    ctx.drawImage(img, pad, pad, w - 2 * pad, boxH - 2 * pad)

    // Section 2 — light-blue pin pointing down (bottom 1/3).
    // Wide enough at the top to clearly attach to the square, taper to a
    // single point that lands on the marker's lat/lng.
    const PIN_FILL = '#29B6F6'
    const PIN_STROKE = '#01579B'
    const pinTopY = boxH
    const pinTipY = h - 1
    const pinHalfTop = Math.max(8, Math.round(w * 0.18))
    ctx.beginPath()
    ctx.moveTo(w / 2 - pinHalfTop, pinTopY)
    ctx.lineTo(w / 2 + pinHalfTop, pinTopY)
    ctx.lineTo(w / 2, pinTipY)
    ctx.closePath()
    ctx.fillStyle = PIN_FILL
    ctx.fill()
    ctx.strokeStyle = PIN_STROKE
    ctx.lineWidth = Math.max(1, sizePx / 48)
    ctx.stroke()

    const uri = canvas.toDataURL('image/png')
    // `toDataURL` returns `"data:,"` on allocation failure in some engines
    // instead of throwing; treat it as failure so the caller can surface it.
    if (!uri || uri === 'data:,' || !uri.startsWith('data:image/png')) return null
    return uri
  } catch {
    return null
  }
}

export type RasterizeSetResult = {
  /** `type → PNG data URI` for every type that rasterized successfully. */
  icons: Record<string, string>
  /** Types that failed to rasterize (unknown type, canvas unavailable, etc.). */
  failed: GroundMarkerType[]
}

/**
 * Build a `type → dataUri` map for the given marker types.
 *
 * Returns both the successful icons AND the list of failed types so the
 * caller can surface a warning instead of silently downgrading the KML
 * export to default-style placemarks (feedback 2026-04-18 regression risk).
 */
export async function rasterizeGroundMarkerSet(
  types: readonly GroundMarkerType[],
  sizePx = 64,
  stroke: SafeStroke = 'white',
): Promise<RasterizeSetResult> {
  const icons: Record<string, string> = {}
  const failed: GroundMarkerType[] = []
  await Promise.all(
    types.map(async (t) => {
      const uri = await rasterizeGroundMarker(t, sizePx, stroke)
      if (uri) icons[t] = uri
      else failed.push(t)
    }),
  )
  return { icons, failed }
}
