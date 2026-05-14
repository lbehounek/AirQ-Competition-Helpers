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

  it('accepts numeric labels (precision discipline) — boundary 1 and 20', () => {
    expect(isPhotoMarker({ ...valid, label: '1' })).toBe(true)
    expect(isPhotoMarker({ ...valid, label: '20' })).toBe(true)
  })

  it('rejects out-of-range numeric labels', () => {
    expect(isPhotoMarker({ ...valid, label: '0' })).toBe(false)
    expect(isPhotoMarker({ ...valid, label: '21' })).toBe(false)
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

// EXIF photo-import fields (docs/photo-map-culling/implementation-plan.md Phase 0)
describe('isPhotoMarker — capturedAt', () => {
  const base = { id: 'pm-1', lng: 14, lat: 50, name: 'Test' }

  it('accepts a marker with valid capturedAt', () => {
    expect(isPhotoMarker({ ...base, capturedAt: { lng: 14.1, lat: 50.1 } })).toBe(true)
  })

  it('accepts capturedAt with optional altitude/timestamp', () => {
    expect(isPhotoMarker({
      ...base,
      capturedAt: { lng: 14.1, lat: 50.1, altitude: 320, timestamp: '2026-05-14T08:00:00Z' },
    })).toBe(true)
  })

  it.each([
    ['non-object capturedAt', { ...base, capturedAt: 'not an object' }],
    ['null capturedAt', { ...base, capturedAt: null }],
    ['capturedAt missing coords', { ...base, capturedAt: {} }],
    ['capturedAt with out-of-range lng', { ...base, capturedAt: { lng: 999, lat: 50 } }],
    ['capturedAt with NaN lat', { ...base, capturedAt: { lng: 14, lat: NaN } }],
    ['capturedAt with non-numeric altitude', { ...base, capturedAt: { lng: 14, lat: 50, altitude: 'high' } }],
    ['capturedAt with non-string timestamp', { ...base, capturedAt: { lng: 14, lat: 50, timestamp: 1234 } }],
  ])('rejects %s', (_label, input) => {
    expect(isPhotoMarker(input)).toBe(false)
  })
})

describe('isPhotoMarker — photoId', () => {
  const base = { id: 'pm-1', lng: 14, lat: 50, name: 'Test' }

  it('accepts non-empty photoId', () => {
    expect(isPhotoMarker({ ...base, photoId: 'photo-abc-123' })).toBe(true)
  })

  it('accepts absent photoId', () => {
    expect(isPhotoMarker(base)).toBe(true)
  })

  it.each([
    ['empty photoId', { ...base, photoId: '' }],
    ['non-string photoId', { ...base, photoId: 42 }],
  ])('rejects %s', (_label, input) => {
    expect(isPhotoMarker(input)).toBe(false)
  })
})

describe('isPhotoMarker — flag', () => {
  const base = { id: 'pm-1', lng: 14, lat: 50, name: 'Test' }

  it.each(['pick', 'reject'])('accepts flag = %s', (flag) => {
    expect(isPhotoMarker({ ...base, flag })).toBe(true)
  })

  it('accepts absent flag (neutral state)', () => {
    expect(isPhotoMarker(base)).toBe(true)
  })

  it.each([
    ['unknown string', { ...base, flag: 'something' }],
    ['empty string', { ...base, flag: '' }],
    ['number', { ...base, flag: 1 }],
    ['null', { ...base, flag: null }],
  ])('rejects %s', (_label, input) => {
    expect(isPhotoMarker(input)).toBe(false)
  })
})

describe('sanitizePhotoMarkers — round-trip of EXIF fields', () => {
  it('preserves capturedAt and photoId on valid markers', () => {
    const input = [{
      id: 'pm-1',
      lng: 14.5,
      lat: 50.1,
      name: 'IMG_001.JPG',
      label: 'A',
      capturedAt: { lng: 14.49, lat: 50.105, altitude: 280, timestamp: '2026-05-14T08:00:00Z' },
      photoId: 'photo-abc',
    }]
    const result = sanitizePhotoMarkers(input)
    expect(result).toHaveLength(1)
    const m = result[0]
    expect(m.capturedAt).toEqual({ lng: 14.49, lat: 50.105, altitude: 280, timestamp: '2026-05-14T08:00:00Z' })
    expect(m.photoId).toBe('photo-abc')
  })

  it('drops markers whose EXIF fields are corrupted (fail-loud philosophy)', () => {
    const input = [
      { id: 'pm-1', lng: 14, lat: 50, name: 'good' },
      { id: 'pm-2', lng: 14, lat: 50, name: 'bad-capturedAt', capturedAt: { lng: 999, lat: 50 } },
      { id: 'pm-3', lng: 14, lat: 50, name: 'bad-photoId', photoId: '' },
    ]
    const result = sanitizePhotoMarkers(input)
    expect(result.map(m => m.id)).toEqual(['pm-1'])
  })

  it('round-trips a pre-feature marker (v1 → v2 migration: missing fields stay missing)', () => {
    const v1Marker = { id: 'pm-1', lng: 14, lat: 50, name: 'old-format' }
    const result = sanitizePhotoMarkers([v1Marker])
    expect(result).toHaveLength(1)
    expect(result[0].capturedAt).toBeUndefined()
    expect(result[0].photoId).toBeUndefined()
  })
})
