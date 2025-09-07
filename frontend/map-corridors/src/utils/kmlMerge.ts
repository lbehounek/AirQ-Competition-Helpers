import type { Feature, FeatureCollection, GeoJSON, LineString, Point } from 'geojson'

const KML_NS = 'http://www.opengis.net/kml/2.2'

function ensureStyle(doc: Document, id: string, innerXml: string) {
  const styles = Array.from(doc.getElementsByTagName('Style'))
  const exists = styles.some(s => s.getAttribute('id') === id)
  if (exists) return
  const style = doc.createElementNS(KML_NS, 'Style')
  style.setAttribute('id', id)
  // naive innerXML injection (safe for our simple styles)
  const container = doc.createElement('div')
  container.innerHTML = `<Style xmlns=\"${KML_NS}\" id=\"${id}\">${innerXml}</Style>`
  const created = container.firstChild as Element
  const documentEl = doc.getElementsByTagName('Document')[0] || doc.documentElement
  if (created && documentEl) documentEl.appendChild(created)
}

function ensureFolder(doc: Document, folderName: string): Element {
  const documentEl = doc.getElementsByTagName('Document')[0] || doc.documentElement
  const folders = Array.from(doc.getElementsByTagName('Folder'))
  for (const f of folders) {
    const nameEl = f.getElementsByTagName('name')[0]
    if (nameEl && nameEl.textContent === folderName) return f
  }
  const folder = doc.createElementNS(KML_NS, 'Folder')
  const nm = doc.createElementNS(KML_NS, 'name')
  nm.textContent = folderName
  folder.appendChild(nm)
  documentEl.appendChild(folder)
  return folder
}

function addLinePlacemark(doc: Document, name: string, coords: number[][], styleId: string, role?: string) {
  const documentEl = doc.getElementsByTagName('Document')[0] || doc.documentElement
  const pm = doc.createElementNS(KML_NS, 'Placemark')
  const nm = doc.createElementNS(KML_NS, 'name')
  nm.textContent = name
  if (role) {
    const ext = doc.createElementNS(KML_NS, 'ExtendedData')
    const data = doc.createElementNS(KML_NS, 'Data')
    data.setAttribute('name', 'role')
    const val = doc.createElementNS(KML_NS, 'value')
    val.textContent = role
    data.appendChild(val)
    ext.appendChild(data)
    pm.appendChild(ext)
  }
  const styleUrl = doc.createElementNS(KML_NS, 'styleUrl')
  styleUrl.textContent = `#${styleId}`
  const line = doc.createElementNS(KML_NS, 'LineString')
  const coordsEl = doc.createElementNS(KML_NS, 'coordinates')
  coordsEl.textContent = coords.map(c => `${c[0]},${c[1]},${c[2] || 0}`).join('\n')
  line.appendChild(coordsEl)
  pm.appendChild(nm)
  pm.appendChild(styleUrl)
  pm.appendChild(line)
  documentEl.appendChild(pm)
}

function addPointPlacemark(doc: Document, name: string, coord: number[], role?: string) {
  const parentEl = role === 'track_photos' 
    ? ensureFolder(doc, 'track_photos') 
    : (doc.getElementsByTagName('Document')[0] || doc.documentElement)
  const pm = doc.createElementNS(KML_NS, 'Placemark')
  const nm = doc.createElementNS(KML_NS, 'name')
  nm.textContent = name
  if (role) {
    const ext = doc.createElementNS(KML_NS, 'ExtendedData')
    const data = doc.createElementNS(KML_NS, 'Data')
    data.setAttribute('name', 'role')
    const val = doc.createElementNS(KML_NS, 'value')
    val.textContent = role
    data.appendChild(val)
    ext.appendChild(data)
    pm.appendChild(ext)
  }
  const styleUrl = doc.createElementNS(KML_NS, 'styleUrl')
  styleUrl.textContent = '#labelPoint'
  const pt = doc.createElementNS(KML_NS, 'Point')
  const coordsEl = doc.createElementNS(KML_NS, 'coordinates')
  coordsEl.textContent = `${coord[0]},${coord[1]},${coord[2] || 0}`
  pt.appendChild(coordsEl)
  pm.appendChild(nm)
  pm.appendChild(styleUrl)
  pm.appendChild(pt)
  parentEl.appendChild(pm)
}

export function appendFeaturesToKML(originalKml: string, extra: GeoJSON, docName?: string): string {
  const parser = new DOMParser()
  const xml = parser.parseFromString(originalKml, 'application/xml')
  const documentEl = xml.getElementsByTagName('Document')[0] || xml.documentElement
  if (docName && documentEl) {
    const nameEl = documentEl.getElementsByTagName('name')[0] || xml.createElementNS(KML_NS, 'name')
    nameEl.textContent = docName
    if (!nameEl.parentElement) documentEl.insertBefore(nameEl, documentEl.firstChild)
  }

  // Ensure styles for appended content
  ensureStyle(xml, 'greenLine', '<LineStyle><color>ff00ff00</color><width>2</width></LineStyle>')
  ensureStyle(xml, 'labelPoint', '<IconStyle><color>ff000000</color><scale>0.8</scale></IconStyle><LabelStyle><scale>1</scale></LabelStyle>')

  const features = extra.type === 'FeatureCollection' ? (extra as FeatureCollection).features : [extra as Feature]

  for (const feature of features) {
    if (!feature.geometry) continue
    const props = feature.properties || {}
    if (feature.geometry.type === 'LineString') {
      const ls = feature.geometry as LineString
      const name = (props as any).segment || (props as any).role || 'corridor'
      const style = 'greenLine'
      const role = (props as any).role || ((props as any).segment ? 'corridor' : undefined)
      addLinePlacemark(xml, name, ls.coordinates as any, style, role)
    } else if (feature.geometry.type === 'Point') {
      const pt = feature.geometry as Point
      const name = (props as any).name || (props as any).role || 'point'
      addPointPlacemark(xml, name, pt.coordinates as any)
    }
  }

  const serializer = new XMLSerializer()
  return serializer.serializeToString(xml)
}


