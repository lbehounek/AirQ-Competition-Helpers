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
 * and for environments that can't mint a 2D canvas context.
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
  ctx.drawImage(img, 0, 0, sizePx, sizePx)
  return canvas.toDataURL('image/png')
}

/** Build a `type → dataUri` map for the given marker types, skipping any that fail. */
export async function rasterizeGroundMarkerSet(
  types: readonly GroundMarkerType[],
  sizePx = 64,
  stroke: SafeStroke = 'white',
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  await Promise.all(
    types.map(async (t) => {
      const uri = await rasterizeGroundMarker(t, sizePx, stroke)
      if (uri) out[t] = uri
    }),
  )
  return out
}
