import { describe, it, expect } from 'vitest'
import { isPhotoMarkerVisible } from '../map/photoLayers/markerVisibility'
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
