// Unit tests for the shared display/order primitives added for the
// rename-preserves-filename feature (user feedback 2026-05-17). These back
// the list row, marker popup, tray, KML export and map-picks projection — one
// place to pin "custom name shows, original filename orders".

import { describe, it, expect } from 'vitest'
import {
  buildPhotoMarkerKmlName,
  compareFilenames,
  noGpsPhotoDisplayName,
  normalizeDisplayName,
  photoMarkerDisplayName,
} from '../types/markers'

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

describe('normalizeDisplayName', () => {
  it('keeps a meaningful custom name', () => {
    expect(normalizeDisplayName('TP1', 'DSC_0001.JPG')).toBe('TP1')
  })
  it('passes undefined through', () => {
    expect(normalizeDisplayName(undefined, 'DSC_0001.JPG')).toBeUndefined()
  })
  it('strips an empty / whitespace-only displayName', () => {
    expect(normalizeDisplayName('', 'DSC_0001.JPG')).toBeUndefined()
    expect(normalizeDisplayName('   ', 'DSC_0001.JPG')).toBeUndefined()
  })
  it('strips a redundant displayName equal to the original filename', () => {
    expect(normalizeDisplayName('DSC_0001.JPG', 'DSC_0001.JPG')).toBeUndefined()
  })
  it('keeps a case-only difference (matches clear-on-original being case-sensitive)', () => {
    expect(normalizeDisplayName('dsc_0001.jpg', 'DSC_0001.JPG')).toBe('dsc_0001.jpg')
  })
})

describe('buildPhotoMarkerKmlName', () => {
  it('no label, no custom name → just the filename', () => {
    expect(buildPhotoMarkerKmlName({ name: 'DSC_0123.JPG' })).toBe('DSC_0123.JPG')
  })
  it('custom name → "TP1 (DSC_0123.JPG)"', () => {
    expect(buildPhotoMarkerKmlName({ name: 'DSC_0123.JPG', displayName: 'TP1' }))
      .toBe('TP1 (DSC_0123.JPG)')
  })
  it('label only → "A - DSC_0123.JPG"', () => {
    expect(buildPhotoMarkerKmlName({ name: 'DSC_0123.JPG', label: 'A' }))
      .toBe('A - DSC_0123.JPG')
  })
  it('label + custom name → "A - TP1 (DSC_0123.JPG)"', () => {
    expect(buildPhotoMarkerKmlName({ name: 'DSC_0123.JPG', displayName: 'TP1', label: 'A' }))
      .toBe('A - TP1 (DSC_0123.JPG)')
  })
  it('never doubles a redundant displayName equal to the filename', () => {
    // Would otherwise emit "DSC_0123.JPG (DSC_0123.JPG)".
    expect(buildPhotoMarkerKmlName({ name: 'DSC_0123.JPG', displayName: 'DSC_0123.JPG' }))
      .toBe('DSC_0123.JPG')
  })
  it('treats a blank displayName as absent (matches photoMarkerDisplayName)', () => {
    expect(buildPhotoMarkerKmlName({ name: 'DSC_0123.JPG', displayName: '  ' }))
      .toBe('DSC_0123.JPG')
  })
  it('returns raw text — XML special chars are NOT escaped here (serializer does that)', () => {
    // The builder is the composition layer; escaping happens downstream at the
    // KML serializer (textContent). A raw "<" must survive verbatim so the
    // serializer can escape it exactly once.
    expect(buildPhotoMarkerKmlName({ name: 'a.jpg', displayName: 'T<P>1' }))
      .toBe('T<P>1 (a.jpg)')
  })
})
