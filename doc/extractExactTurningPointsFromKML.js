// Minimal, dependency-free algorithm to extract exact TP coordinates from a KML string.
// - Parses KML → DOM → minimal in-memory structures.
// - Builds the continuous main track (skips dashed: 2-point segments < 500 m).
// - Finds TP labels (names like "TP 7").
// - Picks nearest 3-point gate line to each TP and intersects it with the main track.
// - Fallback: if no intersection, snap TP label to nearest point on the track.

export function extractExactTurningPointsFromKml(kmlText) {
  const parser = new DOMParser()
  const xml = parser.parseFromString(kmlText, 'application/xml')
  const placemarks = Array.from(xml.getElementsByTagName('Placemark'))

  const lineStrings = []
  const points = []

  for (const pm of placemarks) {
    const nameEl = pm.getElementsByTagName('name')[0]
    const name = nameEl?.textContent?.trim() || ''

    const lineEl = pm.getElementsByTagName('LineString')[0]
    if (lineEl) {
      const coordsText = (lineEl.getElementsByTagName('coordinates')[0]?.textContent || '').trim()
      const coords = coordsText
        .split(/\s+/)
        .filter(Boolean)
        .map(s => s.split(',').map(Number))
        .map(([lon, lat, alt]) => [lon, lat, alt])
        .filter(([lon, lat, alt]) => Number.isFinite(lon) && Number.isFinite(lat) && (alt == null || Number.isFinite(alt)))
        .map(([lon, lat, alt]) => [lon, lat, Number.isFinite(alt) ? alt : 0])
      if (coords.length >= 2) lineStrings.push({ name, coords })
      continue
    }

    const pointEl = pm.getElementsByTagName('Point')[0]
    if (pointEl) {
      const coordsText = (pointEl.getElementsByTagName('coordinates')[0]?.textContent || '').trim()
      if (coordsText) {
        const parts = coordsText.split(',')
        if (parts.length >= 2) {
          const lon = Number(parts[0])
          const lat = Number(parts[1])
          const altRaw = parts[2] != null ? Number(parts[2]) : NaN
          if (Number.isFinite(lon) && Number.isFinite(lat)) {
            const alt = Number.isFinite(altRaw) ? altRaw : 0
            points.push({ name, coord: [lon, lat, alt] })
          }
        }
      }
    }
  }

  // Utilities
  const R = 6371000
  const toRad = d => d * Math.PI / 180
  const haversine = (a, b) => {
    const [lon1, lat1] = a, [lon2, lat2] = b
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1)
    const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLon / 2)
    const A = s1 * s1 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2
    return 2 * R * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A))
  }

  const isDashedConnector = (coords) =>
    coords.length === 2 && haversine(coords[0], coords[1]) < 500

  function segIntersect(a1, a2, b1, b2) {
    const x1 = a1[0], y1 = a1[1], x2 = a2[0], y2 = a2[1]
    const x3 = b1[0], y3 = b1[1], x4 = b2[0], y4 = b2[1]
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if (Math.abs(den) < 1e-12) return null
    const px = ((x1*y2 - y1*x2)*(x3 - x4) - (x1 - x2)*(x3*y4 - y3*x4)) / den
    const py = ((x1*y2 - y1*x2)*(y3 - y4) - (y1 - y2)*(x3*y4 - y3*x4)) / den
    const onA = Math.min(x1, x2) - 1e-12 <= px && px <= Math.max(x1, x2) + 1e-12 &&
                Math.min(y1, y2) - 1e-12 <= py && py <= Math.max(y1, y2) + 1e-12
    const onB = Math.min(x3, x4) - 1e-12 <= px && px <= Math.max(x3, x4) + 1e-12 &&
                Math.min(y3, y4) - 1e-12 <= py && py <= Math.max(y3, y4) + 1e-12
    return (onA && onB) ? [px, py] : null
  }

  function closestPointOnSegment(p1, p2, c) {
    const ax = p1[0], ay = p1[1], bx = p2[0], by = p2[1], cx = c[0], cy = c[1]
    const ABx = bx - ax, ABy = by - ay
    const t = ((cx - ax) * ABx + (cy - ay) * ABy) / (ABx * ABx + ABy * ABy || 1e-12)
    const tt = Math.max(0, Math.min(1, t))
    return [ax + ABx * tt, ay + ABy * tt]
  }

  function snapToPolyline(poly, pt) {
    let best = null, bestD2 = Infinity
    for (let i = 0; i < poly.length - 1; i++) {
      const q = closestPointOnSegment(poly[i], poly[i+1], pt)
      const dx = q[0] - pt[0], dy = q[1] - pt[1]
      const d2 = dx*dx + dy*dy
      if (d2 < bestD2) { bestD2 = d2; best = q }
    }
    return best || poly[0]
  }

  // Build main track polyline
  const mainSegments = lineStrings.filter(ls => !isDashedConnector(ls.coords) && ls.coords.length >= 2)
  const track = []
  for (let s = 0; s < mainSegments.length; s++) {
    const coords = mainSegments[s].coords
    if (s === 0) {
      for (const c of coords) track.push([c[0], c[1]])
    } else {
      const prev = track[track.length - 1]
      if (haversine(prev, coords[0]) < 50) {
        for (let k = 1; k < coords.length; k++) track.push([coords[k][0], coords[k][1]])
      } else {
        for (const c of coords) track.push([c[0], c[1]])
      }
    }
  }
  if (track.length < 2) return []

  // Find TP labels
  const tps = points
    .filter(p => /^TP\s+\d+$/i.test(p.name || ''))
    .map(p => ({ name: p.name.trim(), coord: [p.coord[0], p.coord[1]] }))

  // Gate candidates: 3-point lines
  const gates = lineStrings.filter(ls => ls.coords.length === 3)
  const gateCenter = g => g.coords[1]
  function nearestGate(tpCoord) {
    let best = null, bestD2 = Infinity
    for (const g of gates) {
      const c = gateCenter(g)
      const dx = c[0] - tpCoord[0], dy = c[1] - tpCoord[1]
      const d2 = dx*dx + dy*dy
      if (d2 < bestD2) { bestD2 = d2; best = g }
    }
    return best
  }

  const results = []
  for (const tp of tps) {
    const g = nearestGate(tp.coord)
    let exact = null
    if (g) {
      const a = g.coords[0], b = g.coords[2]
      let firstHit = null
      for (let i = 0; i < track.length - 1; i++) {
        const hit = segIntersect(track[i], track[i+1], [a[0], a[1]], [b[0], b[1]])
        if (hit) { firstHit = hit; break }
      }
      if (firstHit) exact = firstHit
    }
    if (!exact) exact = snapToPolyline(track, tp.coord)
    results.push({ name: tp.name, lon: exact[0], lat: exact[1] })
  }

  results.sort((a, b) => {
    const na = parseInt(a.name.split(/\s+/).pop(), 10) || 0
    const nb = parseInt(b.name.split(/\s+/).pop(), 10) || 0
    return na - nb
  })

  return results
}


