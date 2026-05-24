import { describe, it, expect } from 'vitest'
import {
  buildDashedLineFeatures,
  buildGhostFeatures,
  isPhotoMoved,
} from '../map/photoLayers/captureFeatures'
import type { PhotoMarker } from '../types/markers'

// Phase 4/5 follow-up of photo-map-culling.
// The "every photo is a draggable <Marker>" model retired the
// capture-dots layer. The remaining GeoJSON-layer projections are:
//   • ghost dot at the original EXIF capture point
//   • dashed line from capturedAt to the live subject pin
// Both render ONLY when the user has dragged the photo (subject ≠
// capture). Unmoved photos see only their live <Marker>.

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: 'pm', lng: 14, lat: 50, name: 'x.jpg', ...over } as PhotoMarker
}

describe('isPhotoMoved', () => {
  it('false when capturedAt is absent', () => {
    expect(isPhotoMoved(pm({}))).toBe(false)
  })
  it('false when subject == capture (untouched)', () => {
    expect(isPhotoMoved(pm({
      lng: 14, lat: 50,
      capturedAt: { lng: 14, lat: 50 },
    }))).toBe(false)
  })
  it('true when only longitude moved', () => {
    expect(isPhotoMoved(pm({
      lng: 14.001, lat: 50,
      capturedAt: { lng: 14, lat: 50 },
    }))).toBe(true)
  })
  it('true when only latitude moved', () => {
    expect(isPhotoMoved(pm({
      lng: 14, lat: 50.001,
      capturedAt: { lng: 14, lat: 50 },
    }))).toBe(true)
  })
})

describe('buildGhostFeatures', () => {
  it('emits nothing for unmoved photos', () => {
    const fc = buildGhostFeatures([
      pm({ photoId: 'pid-1', lng: 14, lat: 50, capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features).toEqual([])
  })

  it('emits one ghost per moved photo, positioned at capturedAt', () => {
    const fc = buildGhostFeatures([
      pm({ id: 'm1', photoId: 'pid-1', lng: 14.5, lat: 50.5, capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].geometry.coordinates).toEqual([14, 50])
    expect(fc.features[0].properties.photoId).toBe('pid-1')
    expect(fc.features[0].id).toBe('m1')
  })

  it('skips KML markers (no photoId)', () => {
    const fc = buildGhostFeatures([
      pm({ photoId: undefined, lng: 14.5, lat: 50.5 }),
    ])
    expect(fc.features).toEqual([])
  })

  it('skips photos without capturedAt (no-GPS placements)', () => {
    const fc = buildGhostFeatures([
      pm({ photoId: 'pid-1', capturedAt: undefined, lng: 14, lat: 50 }),
    ])
    expect(fc.features).toEqual([])
  })

  it("skips rejected photos so the ghost dot disappears with the marker", () => {
    // Rejecting hides the live <Marker> in MapProviderView; the ghost dot is the
    // visual echo of "where the camera was" and must vanish with it, otherwise
    // a stray grey dot would remain on the map with no pin to explain it.
    const fc = buildGhostFeatures([
      pm({ photoId: 'pid-1', lng: 14.5, lat: 50.5, capturedAt: { lng: 14, lat: 50 }, flag: 'reject' }),
    ])
    expect(fc.features).toEqual([])
  })

  it('mixed batch — only moved photo markers leave a ghost', () => {
    const fc = buildGhostFeatures([
      pm({ id: 'kml', photoId: undefined, lng: 14, lat: 50 }),
      pm({ id: 'unmoved', photoId: 'p1', lng: 14, lat: 50, capturedAt: { lng: 14, lat: 50 } }),
      pm({ id: 'moved', photoId: 'p2', lng: 14.2, lat: 50.2, capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features.map(f => f.id)).toEqual(['moved'])
  })
})

describe('buildDashedLineFeatures', () => {
  it('emits a LineString from capturedAt to lng/lat for moved photos', () => {
    const fc = buildDashedLineFeatures([
      pm({ photoId: 'p1', lng: 14.5, lat: 50.5, capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].geometry.type).toBe('LineString')
    expect(fc.features[0].geometry.coordinates).toEqual([[14, 50], [14.5, 50.5]])
  })

  it('skips unmoved photos (no need for a zero-length line)', () => {
    const fc = buildDashedLineFeatures([
      pm({ photoId: 'p1', lng: 14, lat: 50, capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features).toEqual([])
  })

  it('skips photos without capturedAt', () => {
    const fc = buildDashedLineFeatures([
      pm({ photoId: 'p1', capturedAt: undefined }),
    ])
    expect(fc.features).toEqual([])
  })

  it('writes photoId into properties for downstream lookups', () => {
    const fc = buildDashedLineFeatures([
      pm({ photoId: 'pid-abc', lng: 14.5, lat: 50.5, capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features[0].properties.photoId).toBe('pid-abc')
  })

  it('skips rejected photos so the dashed line disappears with the marker', () => {
    const fc = buildDashedLineFeatures([
      pm({ photoId: 'pid-1', lng: 14.5, lat: 50.5, capturedAt: { lng: 14, lat: 50 }, flag: 'reject' }),
    ])
    expect(fc.features).toEqual([])
  })
})
