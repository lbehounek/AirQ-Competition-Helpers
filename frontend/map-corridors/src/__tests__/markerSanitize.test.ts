import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GROUND_MARKER_TYPE,
  GROUND_MARKER_TYPES,
  isGroundMarker,
  isPhotoMarker,
  sanitizeGroundMarkers,
  sanitizePhotoMarkers,
} from '../types/markers'

describe('DEFAULT_GROUND_MARKER_TYPE', () => {
  it('is a member of GROUND_MARKER_TYPES', () => {
    expect(GROUND_MARKER_TYPES).toContain(DEFAULT_GROUND_MARKER_TYPE)
  })
})

describe('isGroundMarker', () => {
  const valid = { id: 'gm-1', lng: 14.5, lat: 50.1, type: 'LETTER_A' }

  it('accepts a well-formed marker', () => {
    expect(isGroundMarker(valid)).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'not-an-object'],
    ['empty id', { ...valid, id: '' }],
    ['non-string id', { ...valid, id: 42 }],
    ['NaN lng', { ...valid, lng: NaN }],
    ['Infinity lat', { ...valid, lat: Infinity }],
    ['lng out of range', { ...valid, lng: 181 }],
    ['lat out of range', { ...valid, lat: -91 }],
    ['unknown type', { ...valid, type: 'LETTER_J' }],
    ['prototype-polluting type', { ...valid, type: 'constructor' }],
    ['missing type', { id: 'gm-1', lng: 14, lat: 50 }],
  ])('rejects %s', (_label, input) => {
    expect(isGroundMarker(input)).toBe(false)
  })
})

describe('sanitizeGroundMarkers', () => {
  it('returns [] for non-array input', () => {
    expect(sanitizeGroundMarkers(undefined)).toEqual([])
    expect(sanitizeGroundMarkers(null)).toEqual([])
    expect(sanitizeGroundMarkers({})).toEqual([])
    expect(sanitizeGroundMarkers('nope')).toEqual([])
  })

  it('drops invalid entries and keeps valid ones', () => {
    const input = [
      { id: 'gm-1', lng: 14, lat: 50, type: 'LETTER_A' },
      { id: '', lng: 14, lat: 50, type: 'LETTER_A' },           // bad id
      { id: 'gm-2', lng: 500, lat: 50, type: 'LETTER_C' },      // bad coords
      { id: 'gm-3', lng: 14, lat: 50, type: 'LETTER_UNKNOWN' }, // bad type
      { id: 'gm-4', lng: 14, lat: 50, type: 'HOOK' },
    ]
    const result = sanitizeGroundMarkers(input)
    expect(result).toHaveLength(2)
    expect(result.map(r => r.id)).toEqual(['gm-1', 'gm-4'])
  })
})

describe('isPhotoMarker', () => {
  const valid = { id: 'pm-1', lng: 14, lat: 50, name: 'Test', label: 'A' }

  it('accepts a well-formed marker', () => {
    expect(isPhotoMarker(valid)).toBe(true)
  })

  it('accepts a marker without a label', () => {
    const { label: _label, ...noLabel } = valid
    expect(isPhotoMarker(noLabel)).toBe(true)
  })

  it('rejects unknown labels', () => {
    expect(isPhotoMarker({ ...valid, label: 'Z' })).toBe(false)
  })

  it('rejects non-string name', () => {
    expect(isPhotoMarker({ ...valid, name: 123 })).toBe(false)
  })
})

describe('sanitizePhotoMarkers', () => {
  it('drops invalid photo markers', () => {
    const input = [
      { id: 'pm-1', lng: 14, lat: 50, name: 'ok' },
      { id: 'pm-2', lng: 14, lat: 50, name: 'bad', label: 'ZZ' }, // bad label
      { id: 'pm-3', lng: NaN, lat: 50, name: 'bad' },              // bad coords
    ]
    const result = sanitizePhotoMarkers(input)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('pm-1')
  })
})
