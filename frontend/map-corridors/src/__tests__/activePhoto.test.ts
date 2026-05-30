import { describe, it, expect } from 'vitest'
import { shouldClearActivePhoto, resolveActivePhotoId } from '../activePhoto/activePhoto'
import type { PhotoMarker } from '../types/markers'

// Phase 13 (active-photo highlight). Two load-bearing rules:
//  - the active photo is dropped ONLY when its marker is deleted — NOT on
//    reject, so a rejected photo's popup stays openable from the list and can
//    be un-rejected (regression guard: clearing on reject broke re-opening);
//  - the list-panel highlight resolves to the active photoId whenever the
//    marker exists (rejected included, so the un-reject row highlights).

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: 'pm', lng: 14, lat: 50, name: 'x.jpg', photoId: 'pm', ...over } as PhotoMarker
}

const pick = pm({ id: 'a', photoId: 'pa', flag: 'pick-track' })
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

  it('false when the active marker is rejected — popup must stay open to un-reject (regression guard)', () => {
    expect(shouldClearActivePhoto(markers, 'c')).toBe(false)
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

  it('returns the photoId of a rejected active marker (the un-reject row highlights)', () => {
    expect(resolveActivePhotoId(markers, 'c')).toBe('pc')
  })

  it('null when the active marker was deleted', () => {
    expect(resolveActivePhotoId(markers, 'gone')).toBeNull()
  })

  it('null for a marker without a photoId (KML marker is never photo-active)', () => {
    expect(resolveActivePhotoId(markers, 'k')).toBeNull()
  })
})
