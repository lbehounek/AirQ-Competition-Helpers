import type { Feature, FeatureCollection, GeoJSON, LineString, Point } from 'geojson'

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
  
  // Yellow for original track (#f7ca00 -> ABGR: ff00caf7)
  kml += '  <Style id="yellowLine">\n'
  kml += '    <LineStyle>\n'
  kml += '      <color>ff00caf7</color>\n'
  kml += '      <width>2</width>\n'
  kml += '    </LineStyle>\n'
  kml += '  </Style>\n'
  
  // Point labels (exact waypoints)
  kml += '  <Style id="labelPoint">\n'
  kml += '    <IconStyle>\n'
  kml += '      <color>ff000000</color>\n'
  kml += '      <scale>0.8</scale>\n'
  kml += '    </IconStyle>\n'
  kml += '    <LabelStyle>\n'
  kml += '      <scale>1</scale>\n'
  kml += '    </LabelStyle>\n'
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
      const style = properties.role === 'original-track' ? 'yellowLine' : 'greenLine'
      
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
    } else if (feature.geometry?.type === 'Point') {
      const pointGeom = feature.geometry as Point
      const properties = feature.properties || {}
      const name = properties.name || properties.role || `Point_${index + 1}`
      const coord = pointGeom.coordinates as any
      const lon = coord[0]
      const lat = coord[1]
      const alt = (coord[2] ?? 0)
      kml += '  <Placemark>\n'
      kml += `    <name>${name}</name>\n`
      kml += `    <styleUrl>#labelPoint</styleUrl>\n`
      kml += '    <Point>\n'
      kml += `      <coordinates>${lon},${lat},${alt}</coordinates>\n`
      kml += '    </Point>\n'
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
