import { describe, it, expect } from 'vitest'
import { isPhotoMarkerVisible, isMarkerVisibleOnMap } from '../map/photoLayers/markerVisibility'
import type { PhotoMarker } from '../types/markers'

// The live-pin filter for the map. Rejecting a photo must remove its pin (it
// then lives only in the side panel's "Odmítnuté" group); picks and neutrals
// stay drawn. KML markers (no photoId) are not photo pins.

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: 'pm', lng: 14, lat: 50, name: 'x.jpg', photoId: 'pm', ...over } as PhotoMarker
}

describe('isPhotoMarkerVisible', () => {
  it('shows a neutral photo (no flag)', () => {
    expect(isPhotoMarkerVisible(pm({}))).toBe(true)
  })

  it('shows a picked photo (both track and turning categories)', () => {
    expect(isPhotoMarkerVisible(pm({ flag: 'pick-track' }))).toBe(true)
    expect(isPhotoMarkerVisible(pm({ flag: 'pick-turning' }))).toBe(true)
  })

  it('hides a rejected photo (disappears from the map)', () => {
    expect(isPhotoMarkerVisible(pm({ flag: 'reject' }))).toBe(false)
  })

  it('hides a marker without a photoId (KML/click-placed, not a photo pin)', () => {
    expect(isPhotoMarkerVisible(pm({ photoId: undefined }))).toBe(false)
  })
})

// The export gate (PNG print + KML). Must equal the union of the live map's two
// render passes — photo pins AND non-photo (KML/click) pins — so an export ships
// exactly what's on screen. Regression: the print path used to render EVERY
// marker, reprinting a rejected co-located variant at its original EXIF spot
// next to the kept photo the user dragged into place (the "duplicate dot" bug).
describe('isMarkerVisibleOnMap (export gate)', () => {
  it('keeps neutral and picked photos (both track and turning categories)', () => {
    expect(isMarkerVisibleOnMap(pm({}))).toBe(true)
    expect(isMarkerVisibleOnMap(pm({ flag: 'pick-track' }))).toBe(true)
    expect(isMarkerVisibleOnMap(pm({ flag: 'pick-turning' }))).toBe(true)
  })

  it('drops a rejected photo so it is not reprinted at its original location', () => {
    expect(isMarkerVisibleOnMap(pm({ flag: 'reject' }))).toBe(false)
  })

  it('keeps KML/click-placed markers (no photoId — always rendered on the live map)', () => {
    expect(isMarkerVisibleOnMap(pm({ photoId: undefined }))).toBe(true)
  })
})
