import { describe, it, expect } from 'vitest'
import { buildCaptureDotFeatures } from '../map/photoLayers/captureFeatures'
import type { PhotoMarker } from '../types/markers'

// Phase 4 of photo-map-culling.
// captureFeatures is the pure projection that turns the in-memory marker
// array into the GeoJSON the capture-dots layer consumes. The component
// itself can't be tested in jsdom (no Mapbox); these tests cover the
// filter and shape — the parts that decide what the user actually sees.

function pm(overrides: Partial<PhotoMarker>): PhotoMarker {
  return {
    id: 'pm-1',
    lng: 14,
    lat: 50,
    name: 'IMG_0001.JPG',
    ...overrides,
  } as PhotoMarker
}

describe('buildCaptureDotFeatures — filter', () => {
  it('includes a photo marker with capturedAt + photoId + no label', () => {
    const fc = buildCaptureDotFeatures([
      pm({ photoId: 'pid-1', capturedAt: { lng: 14.1, lat: 50.1 } }),
    ])
    expect(fc.features).toHaveLength(1)
  })

  it('excludes markers without capturedAt (KML click placements)', () => {
    const fc = buildCaptureDotFeatures([
      pm({ photoId: undefined, capturedAt: undefined }),
    ])
    expect(fc.features).toEqual([])
  })

  it('excludes markers without photoId even if capturedAt is set', () => {
    // Defensive: capturedAt without photoId would be a malformed state,
    // but we tolerate it instead of breaking the renderer.
    const fc = buildCaptureDotFeatures([
      pm({ photoId: undefined, capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features).toEqual([])
  })

  it('excludes labelled markers (picks are rendered as subject pins, not capture dots)', () => {
    const fc = buildCaptureDotFeatures([
      pm({ photoId: 'pid-1', label: 'A', capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features).toEqual([])
  })

  it('mixed batch — keeps only the photo-imported neutral ones', () => {
    const fc = buildCaptureDotFeatures([
      pm({ id: 'kml-1', photoId: undefined, capturedAt: undefined }),         // KML click
      pm({ id: 'pm-1', photoId: 'pid-1', capturedAt: { lng: 14, lat: 50 } }), // photo, neutral
      pm({ id: 'pm-2', photoId: 'pid-2', label: 'A', capturedAt: { lng: 14.5, lat: 50.5 } }), // photo, picked
    ])
    expect(fc.features.map(f => f.id)).toEqual(['pm-1'])
  })
})

describe('buildCaptureDotFeatures — geometry + properties', () => {
  it('positions the feature at capturedAt, NOT at the marker subject (lng/lat)', () => {
    // Critical: after the user drags the subject pin, marker.lng/lat moves
    // but capturedAt does not. The capture dot must stay where the camera
    // GPS recorded the photo, otherwise it'd be a duplicate of the pin.
    const fc = buildCaptureDotFeatures([
      pm({
        photoId: 'pid-1',
        lng: 14.999,        // subject dragged far away
        lat: 50.999,
        capturedAt: { lng: 14.1, lat: 50.1 }, // EXIF source
      }),
    ])
    expect(fc.features[0].geometry.coordinates).toEqual([14.1, 50.1])
  })

  it('writes photoId, filename and flag into the feature properties', () => {
    const fc = buildCaptureDotFeatures([
      pm({ photoId: 'pid-abc', name: 'RIMG0169.JPG', capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features[0].properties).toEqual({
      photoId: 'pid-abc',
      name: 'RIMG0169.JPG',
      flag: 'neutral',
    })
  })

  it('uses marker.id as the GeoJSON feature id (stable identity for paint expressions)', () => {
    const fc = buildCaptureDotFeatures([
      pm({ id: 'pm-feature-id', photoId: 'pid-1', capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features[0].id).toBe('pm-feature-id')
  })

  it('returns a valid empty FeatureCollection for empty input', () => {
    expect(buildCaptureDotFeatures([])).toEqual({ type: 'FeatureCollection', features: [] })
  })

  it('feature type is always Point', () => {
    const fc = buildCaptureDotFeatures([
      pm({ photoId: 'pid-1', capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features[0].geometry.type).toBe('Point')
  })
})

describe('buildCaptureDotFeatures — flag (Phase 5)', () => {
  it('absent flag denormalizes to "neutral" in properties', () => {
    const fc = buildCaptureDotFeatures([
      pm({ photoId: 'pid-1', capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features[0].properties.flag).toBe('neutral')
  })

  it('flag="reject" is preserved (red dot via paint expression)', () => {
    const fc = buildCaptureDotFeatures([
      pm({ photoId: 'pid-1', flag: 'reject', capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties.flag).toBe('reject')
  })

  it('flag="pick" excludes the marker from the capture-dot layer entirely', () => {
    // Picks render as a draggable subject pin, even without a label yet.
    const fc = buildCaptureDotFeatures([
      pm({ photoId: 'pid-1', flag: 'pick', capturedAt: { lng: 14, lat: 50 } }),
    ])
    expect(fc.features).toEqual([])
  })

  it('mixed flags — keeps neutral + reject, drops pick', () => {
    const fc = buildCaptureDotFeatures([
      pm({ id: 'n', photoId: 'pid-n', capturedAt: { lng: 14, lat: 50 } }),
      pm({ id: 'r', photoId: 'pid-r', flag: 'reject', capturedAt: { lng: 14.1, lat: 50.1 } }),
      pm({ id: 'p', photoId: 'pid-p', flag: 'pick', capturedAt: { lng: 14.2, lat: 50.2 } }),
    ])
    expect(fc.features.map(f => f.id).sort()).toEqual(['n', 'r'])
  })
})
