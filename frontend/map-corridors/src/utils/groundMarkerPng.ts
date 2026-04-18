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
  stroke: SafeStroke = 'white',
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
  const canvas = document.createElement('canvas')
  canvas.width = sizePx
  canvas.height = sizePx
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(img, 0, 0, sizePx, sizePx)
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
