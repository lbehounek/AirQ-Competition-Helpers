import type { Feature, FeatureCollection, GeoJSON, LineString, Polygon } from 'geojson'
import { buffer, featureCollection } from '@turf/turf'

export function buildBufferedCorridor(input: GeoJSON, distance: number, units: 'meters' | 'kilometers' = 'meters'): GeoJSON | null {
  const lines: Feature<LineString>[] = []

  function collectLines(g: any) {
    if (!g) return
    if (g.type === 'FeatureCollection') {
      for (const f of (g as FeatureCollection).features) collectLines(f)
    } else if (g.type === 'Feature') {
      const geom = (g as Feature).geometry
      if (geom?.type === 'LineString') {
        lines.push(g as Feature<LineString>)
      } else if (geom?.type === 'MultiLineString') {
        const props = (g as Feature).properties || {}
        for (const coords of (geom as any).coordinates || []) {
          lines.push({ type: 'Feature', properties: { ...props }, geometry: { type: 'LineString', coordinates: coords } as LineString })
        }
      } else if (geom?.type === 'GeometryCollection') {
        for (const sub of (geom as any).geometries || []) {
          collectLines({ type: 'Feature', properties: (g as Feature).properties || {}, geometry: sub })
        }
      }
    } else if (g.type === 'LineString') {
      lines.push({ type: 'Feature', properties: {}, geometry: g })
    } else if (g.type === 'MultiLineString') {
      for (const coords of (g as any).coordinates || []) {
        lines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } as LineString })
      }
    } else if (g.type === 'GeometryCollection') {
      for (const sub of (g as any).geometries || []) collectLines(sub)
    }
  }

  collectLines(input)
  if (lines.length === 0) return null

  const fc = featureCollection(lines)
  const poly = buffer(fc, distance, { units }) as Feature<Polygon> | FeatureCollection<Polygon>
  return poly as unknown as GeoJSON
}


