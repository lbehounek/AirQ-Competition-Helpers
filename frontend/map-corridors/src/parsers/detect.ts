import { kml as kmlToGeoJSON, gpx as gpxToGeoJSON } from '@tmcw/togeojson'
import type { GeoJSON } from 'geojson'

export async function parseFileToGeoJSON(file: File): Promise<GeoJSON> {
  const text = await file.text()
  const parser = new DOMParser()
  const xml = parser.parseFromString(text, 'application/xml')

  const name = file.name.toLowerCase()
  if (name.endsWith('.kml')) {
    return kmlToGeoJSON(xml) as unknown as GeoJSON
  }
  if (name.endsWith('.gpx')) {
    return gpxToGeoJSON(xml) as unknown as GeoJSON
  }
  // Fallback try KML
  return kmlToGeoJSON(xml) as unknown as GeoJSON
}


