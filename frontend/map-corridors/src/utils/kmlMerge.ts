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

function addPointPlacemark(doc: Document, name: string, coord: number[], role?: string, styleId?: string, markerType?: string) {
  const parentEl = role === 'track_photos'
    ? ensureFolder(doc, 'track_photos')
    : (doc.getElementsByTagName('Document')[0] || doc.documentElement)
  const pm = doc.createElementNS(KML_NS, 'Placemark')
  const nm = doc.createElementNS(KML_NS, 'name')
  nm.textContent = name
  const ext = (role || markerType) ? doc.createElementNS(KML_NS, 'ExtendedData') : null
  if (ext && role) {
    const data = doc.createElementNS(KML_NS, 'Data')
    data.setAttribute('name', 'role')
    const val = doc.createElementNS(KML_NS, 'value')
    val.textContent = role
    data.appendChild(val)
    ext.appendChild(data)
  }
  if (ext && markerType) {
    // Preserve the raw enum so round-tripping the KML (re-import / external
    // tooling) can recover the shape without parsing the icon image.
    const data = doc.createElementNS(KML_NS, 'Data')
    data.setAttribute('name', 'markerType')
    const val = doc.createElementNS(KML_NS, 'value')
    val.textContent = markerType
    data.appendChild(val)
    ext.appendChild(data)
  }
  if (ext) pm.appendChild(ext)
  const styleUrl = doc.createElementNS(KML_NS, 'styleUrl')
  styleUrl.textContent = `#${styleId || 'labelPoint'}`
  const pt = doc.createElementNS(KML_NS, 'Point')
  const coordsEl = doc.createElementNS(KML_NS, 'coordinates')
  coordsEl.textContent = `${coord[0]},${coord[1]},${coord[2] || 0}`
  pt.appendChild(coordsEl)
  pm.appendChild(nm)
  pm.appendChild(styleUrl)
  pm.appendChild(pt)
  parentEl.appendChild(pm)
}

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function ensureGroundMarkerStyle(doc: Document, type: string, iconHref: string) {
  const id = `groundMarker_${type}`
  // LabelStyle scale=0 hides the visible `<name>` text (feedback 2026-04-18:
  // labels cluttered the map; users want the icon only).
  // hotSpot anchors the icon's centre on the point so the shape lands exactly
  // where the user placed it.
  ensureStyle(
    doc,
    id,
    `<IconStyle><scale>1.2</scale><Icon><href>${escapeXmlAttr(iconHref)}</href></Icon><hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle><LabelStyle><scale>0</scale></LabelStyle>`,
  )
  return id
}

export type AppendOptions = {
  /**
   * Optional map of ground marker type → PNG data URI. When provided, each
   * ground marker placemark gets its own IconStyle pointing at the raster of
   * the shape users see in the app (see `rasterizeGroundMarkerSet`). Missing
   * entries fall back to the default yellow-dot style.
   */
  groundMarkerIcons?: Record<string, string>
}

export function appendFeaturesToKML(originalKml: string, extra: GeoJSON, docName?: string, options?: AppendOptions): string {
  const parser = new DOMParser()
  const xml = parser.parseFromString(originalKml, 'application/xml')
  let documentEl = xml.getElementsByTagName('Document')[0]
  if (!documentEl) {
    // Ensure a single Document element under <kml>
    const kmlRoot = xml.documentElement
    const newDoc = xml.createElementNS(KML_NS, 'Document')
    // Move existing feature children under Document
    const toMove: Element[] = []
    for (const child of Array.from(kmlRoot.children)) {
      if (child.tagName !== 'Document') toMove.push(child)
    }
    for (const el of toMove) newDoc.appendChild(el)
    kmlRoot.appendChild(newDoc)
    documentEl = newDoc
  }
  if (docName && documentEl) {
    const nameEl = documentEl.getElementsByTagName('name')[0] || xml.createElementNS(KML_NS, 'name')
    nameEl.textContent = docName
    if (!nameEl.parentElement) documentEl.insertBefore(nameEl, documentEl.firstChild)
  }

  // Ensure styles for appended content
  ensureStyle(xml, 'greenLine', '<LineStyle><color>ff00ff00</color><width>2</width></LineStyle>')
  ensureStyle(xml, 'labelPoint', '<IconStyle><color>ff00ffff</color><scale>0.8</scale></IconStyle><LabelStyle><scale>1</scale></LabelStyle>')
  // Dedicated style for photo markers — explicit yellow-pushpin href so every
  // KML viewer (Google Earth, Maps, mobile) shows the same pin the app and
  // PNG export render. The default `labelPoint` style drops to a grey
  // placeholder in some viewers because it lacks an `<Icon>` (feedback
  // 2026-04-23: yellow pin missing from KML, but present in PNG).
  ensureStyle(
    xml,
    'photoMarker',
    '<IconStyle><color>ff00ffff</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon><hotSpot x="20" y="2" xunits="pixels" yunits="pixels"/></IconStyle><LabelStyle><scale>0.9</scale></LabelStyle>',
  )

  // Register one IconStyle per used ground-marker type (feedback 2026-04-18:
  // KML should show the same shapes as screen + print, not just generic pins).
  const iconMap = options?.groundMarkerIcons || {}
  const groundMarkerStyleIds = new Map<string, string>()
  for (const [type, href] of Object.entries(iconMap)) {
    if (!type || !href) continue
    groundMarkerStyleIds.set(type, ensureGroundMarkerStyle(xml, type, href))
  }

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
      // Treat an explicit empty `name` as intentional (feedback 2026-04-18:
      // hide ground-marker label text in Google Earth) rather than falling
      // through to the role/'point' fallback.
      const rawName = (props as any).name
      const name = typeof rawName === 'string' ? rawName : ((props as any).role || 'point')
      const role = (props as any).role as string | undefined
      const markerType = (props as any).markerType as string | undefined
      const customStyleId = role === 'ground_markers' && markerType
        ? groundMarkerStyleIds.get(markerType)
        : role === 'track_photos'
          ? 'photoMarker'
          : undefined
      addPointPlacemark(xml, name, pt.coordinates as any, role, customStyleId, markerType)
    }
  }

  const serializer = new XMLSerializer()
  return serializer.serializeToString(xml)
}


