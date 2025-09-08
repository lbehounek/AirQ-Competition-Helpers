import { kml as kmlToGeoJSON, gpx as gpxToGeoJSON } from '@tmcw/togeojson'
import type { GeoJSON } from 'geojson'

export async function parseFileToGeoJSON(file: File): Promise<GeoJSON> {
  const text = await file.text()
  return parseTextToGeoJSON(text, file.name)
}

export function parseTextToGeoJSON(text: string, fileNameHint?: string): GeoJSON {
  const parser = new DOMParser()
  const xml = parser.parseFromString(text, 'application/xml')
  // Detect XML parse errors
  const parseError = xml.getElementsByTagName('parsererror')[0] || (xml as any).querySelector?.('parsererror')
  if (parseError) {
    const msg = parseError.textContent || 'Invalid XML'
    throw new Error(`XML parse error: ${msg}`)
  }

  const name = (fileNameHint || '').toLowerCase()
  const rootTag = xml.documentElement?.nodeName?.toLowerCase?.() || ''
  const tryParseKml = () => kmlToGeoJSON(xml) as unknown as GeoJSON
  const tryParseGpx = () => gpxToGeoJSON(xml) as unknown as GeoJSON

  // Prefer content-based detection
  if (rootTag.includes('kml')) {
    return tryParseKml()
  }
  if (rootTag.includes('gpx')) {
    return tryParseGpx()
  }

  // Fall back to extension
  if (name.endsWith('.kml')) {
    return tryParseKml()
  }
  if (name.endsWith('.gpx')) {
    return tryParseGpx()
  }

  // As a last resort, attempt both and aggregate errors
  let kmlErr: unknown = null
  try { return tryParseKml() } catch (e) { kmlErr = e }
  try { return tryParseGpx() } catch (gpxErr) {
    const kmlMsg = (kmlErr as any)?.message || String(kmlErr)
    const gpxMsg = (gpxErr as any)?.message || String(gpxErr)
    throw new Error(`Could not parse as KML or GPX. KML error: ${kmlMsg}. GPX error: ${gpxMsg}`)
  }
}


