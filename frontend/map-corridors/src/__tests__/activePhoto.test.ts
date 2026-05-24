import { describe, it, expect } from 'vitest'
import { shouldClearActivePhoto, resolveActivePhotoId } from '../activePhoto/activePhoto'
import type { PhotoMarker } from '../types/markers'

// Phase 13 (active-photo highlight). Two load-bearing rules:
//  - the active photo is dropped when its marker is deleted or rejected
//    (rejected markers are hidden from the map — a lingering highlight would
//    point at nothing);
//  - the list-panel highlight resolves to the active photoId only while the
//    marker is still visible, so a reject can't leave a one-render tint flash.

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: 'pm', lng: 14, lat: 50, name: 'x.jpg', photoId: 'pm', ...over } as PhotoMarker
}

const pick = pm({ id: 'a', photoId: 'pa', flag: 'pick' })
const neutral = pm({ id: 'b', photoId: 'pb' })
const rejected = pm({ id: 'c', photoId: 'pc', flag: 'reject' })
const kml = pm({ id: 'k', photoId: undefined }) // KML marker, no photoId
const markers = [pick, neutral, rejected, kml]

describe('shouldClearActivePhoto', () => {
  it('false when nothing is active (null id is not a reason to clear)', () => {
    expect(shouldClearActivePhoto(markers, null)).toBe(false)
  })

  it('false when the active marker still exists and is visible', () => {
    expect(shouldClearActivePhoto(markers, 'a')).toBe(false)
    expect(shouldClearActivePhoto(markers, 'b')).toBe(false)
  })

  it('true when the active marker was deleted (no longer present)', () => {
    expect(shouldClearActivePhoto(markers, 'gone')).toBe(true)
  })

  it('true when the active marker became rejected (hidden from the map)', () => {
    expect(shouldClearActivePhoto(markers, 'c')).toBe(true)
  })
})

describe('resolveActivePhotoId', () => {
  it('null when nothing is active', () => {
    expect(resolveActivePhotoId(markers, null)).toBeNull()
  })

  it('returns the photoId of a visible active marker', () => {
    expect(resolveActivePhotoId(markers, 'a')).toBe('pa')
    expect(resolveActivePhotoId(markers, 'b')).toBe('pb')
  })

  it('null when the active marker is rejected (prevents tint flash on the reject row)', () => {
    expect(resolveActivePhotoId(markers, 'c')).toBeNull()
  })

  it('null when the active marker was deleted', () => {
    expect(resolveActivePhotoId(markers, 'gone')).toBeNull()
  })

  it('null for a marker without a photoId (KML marker is never photo-active)', () => {
    expect(resolveActivePhotoId(markers, 'k')).toBeNull()
  })
})
