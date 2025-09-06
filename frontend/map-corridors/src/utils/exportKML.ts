import type { Feature, FeatureCollection, GeoJSON, LineString } from 'geojson'

export function geoJSONToKML(geojson: GeoJSON, filename: string = 'corridors'): string {
  let kml = '<?xml version="1.0" encoding="UTF-8"?>\n'
  kml += '<kml xmlns="http://www.opengis.net/kml/2.2">\n'
  kml += '<Document>\n'
  kml += `  <name>${filename}</name>\n`
  
  // Define styles
  kml += '  <Style id="greenLine">\n'
  kml += '    <LineStyle>\n'
  kml += '      <color>ff00ff00</color>\n'
  kml += '      <width>2</width>\n'
  kml += '    </LineStyle>\n'
  kml += '  </Style>\n'
  
  // gates now share the same style as corridors (green)
  
  // Process features
  const features = geojson.type === 'FeatureCollection' 
    ? (geojson as FeatureCollection).features 
    : [geojson as Feature]
  
  features.forEach((feature, index) => {
    if (feature.geometry?.type === 'LineString') {
      const lineString = feature.geometry as LineString
      const properties = feature.properties || {}
      const name = properties.segment || properties.role || `Line_${index + 1}`
      const style = 'greenLine'
      
      kml += '  <Placemark>\n'
      kml += `    <name>${name}</name>\n`
      kml += `    <styleUrl>#${style}</styleUrl>\n`
      kml += '    <LineString>\n'
      kml += '      <coordinates>\n'
      
      lineString.coordinates.forEach(coord => {
        const lon = coord[0]
        const lat = coord[1]
        const alt = coord[2] || 0
        kml += `        ${lon},${lat},${alt}\n`
      })
      
      kml += '      </coordinates>\n'
      kml += '    </LineString>\n'
      kml += '  </Placemark>\n'
    }
  })
  
  kml += '</Document>\n'
  kml += '</kml>'
  
  return kml
}

export function downloadKML(kmlContent: string, filename: string = 'corridors.kml') {
  const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
