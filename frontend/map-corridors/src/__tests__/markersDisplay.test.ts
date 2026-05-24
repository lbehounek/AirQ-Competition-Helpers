// Unit tests for the shared display/order primitives added for the
// rename-preserves-filename feature (user feedback 2026-05-17). These back
// the list row, marker popup, tray, KML export and map-picks projection — one
// place to pin "custom name shows, original filename orders".

import { describe, it, expect } from 'vitest'
import { compareFilenames, noGpsPhotoDisplayName, photoMarkerDisplayName } from '../types/markers'

describe('photoMarkerDisplayName', () => {
  it('returns the custom displayName when set', () => {
    expect(photoMarkerDisplayName({ name: 'DSC_0001.JPG', displayName: 'TP1' })).toBe('TP1')
  })
  it('falls back to the original filename when no custom name', () => {
    expect(photoMarkerDisplayName({ name: 'DSC_0001.JPG' })).toBe('DSC_0001.JPG')
    expect(photoMarkerDisplayName({ name: 'DSC_0001.JPG', displayName: undefined })).toBe('DSC_0001.JPG')
  })
})

describe('noGpsPhotoDisplayName', () => {
  it('returns the custom displayName when set, else the filename', () => {
    expect(noGpsPhotoDisplayName({ filename: 'DSC_0003.JPG', displayName: 'TP3' })).toBe('TP3')
    expect(noGpsPhotoDisplayName({ filename: 'DSC_0003.JPG' })).toBe('DSC_0003.JPG')
  })
})

describe('compareFilenames', () => {
  it('is numeric-aware: 9 sorts before 10 (not lexical)', () => {
    expect(compareFilenames('DSC_0009.JPG', 'DSC_0010.JPG')).toBeLessThan(0)
    expect(['DSC_0010.JPG', 'DSC_0009.JPG', 'DSC_0100.JPG'].sort(compareFilenames))
      .toEqual(['DSC_0009.JPG', 'DSC_0010.JPG', 'DSC_0100.JPG'])
  })

  it('is case-insensitive (sensitivity: base)', () => {
    expect(compareFilenames('img_1.jpg', 'IMG_1.JPG')).toBe(0)
  })

  it('returns 0 for identical strings', () => {
    expect(compareFilenames('same.jpg', 'same.jpg')).toBe(0)
  })
})
