import { groundMarkerSvgInner } from '../components/GroundMarkerIcons'
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
  // Kept for backwards compatibility with `rasterizeGroundMarkerSet`.
  // Composite pin design always uses black symbol on white square; the
  // arg is ignored. Removing it would break the existing test signature.
  _stroke: SafeStroke = 'black',
): Promise<string | null> {
  const symbolPaths = groundMarkerSvgInner(type)
  if (!symbolPaths) return null

  // Build the composite icon as a single inline SVG — feedback 2026-04-25:
  // "kml export for ground marker is not supposed to be yellow circle, but
  //  a pin … like square white with black marker shape on it, next to a
  //  pin that marks the exact position".
  // Compositing in canvas via two `drawImage` calls was unreliable: the
  // outer pin shell rendered but the inner FAI symbol came out blank in
  // Google Earth (user screenshot). One self-contained SVG sidesteps that
  // entirely — the browser rasterises everything in one pass.
  //
  // viewBox 100×150: top 100×100 is a white square with the symbol inside
  // (already in the 0–100 coordinate space the symbol paths assume), the
  // bottom 100×50 is a light-blue triangle pointing down, with the pin
  // tip at (50, 150). `kmlMerge.ts` sets `hotSpot x=0.5 y=0` (fraction)
  // so that tip lands on the marker's lat/lng.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150" width="${sizePx}" height="${Math.round(sizePx * 1.5)}">` +
    // White square with black border
    `<rect x="2" y="2" width="96" height="96" fill="#ffffff" stroke="#000000" stroke-width="3"/>` +
    // Light-blue pin (downward triangle) — outline first via fill+stroke
    `<polygon points="34,98 66,98 50,148" fill="#29B6F6" stroke="#01579B" stroke-width="2.5"/>` +
    // FAI symbol — paths inherit the stroke/fill on this group
    `<g stroke="#000000" stroke-width="10" fill="none" stroke-linecap="square" stroke-linejoin="miter">` +
      symbolPaths +
    `</g>` +
    `</svg>`
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

  const w = sizePx
  const h = Math.round(sizePx * 1.5)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(img, 0, 0, w, h)
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
