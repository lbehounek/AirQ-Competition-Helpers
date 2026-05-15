// Wire-format guard tests. The guards are the trust boundary between
// the two apps' on-disk JSON and the runtime types — a regression here
// would either drop legitimate rows or let through corrupt payloads that
// crash render code. Pin every rule.

import { describe, it, expect } from 'vitest'
import {
  isEditorPickEntry,
  isEditorPicksFile,
  isMapPickEntry,
  isMapPicksFile,
  isWireFlag,
  MAP_PICKS_FILENAME,
  EDITOR_PICKS_FILENAME,
  PM_PHOTO_ID_PREFIX,
} from '@airq/shared-handoff'

describe('constants — wire contract', () => {
  it('pins the on-disk filenames so a typo on one side fails the other', () => {
    expect(MAP_PICKS_FILENAME).toBe('map-picks.json')
    expect(EDITOR_PICKS_FILENAME).toBe('photo-helper-picks.json')
  })

  it('pins the pm- prefix that gates cross-app inclusion', () => {
    expect(PM_PHOTO_ID_PREFIX).toBe('pm-')
  })
})

describe('isWireFlag', () => {
  it.each(['pick', 'neutral', 'reject'])('accepts %s', (f) => {
    expect(isWireFlag(f)).toBe(true)
  })

  it.each([
    ['empty string', ''],
    ['unknown string', 'archived'],
    ['number', 1],
    ['null', null],
    ['undefined', undefined],
    ['object', { kind: 'pick' }],
  ])('rejects %s', (_label, v) => {
    expect(isWireFlag(v)).toBe(false)
  })
})

describe('isMapPickEntry', () => {
  const valid = {
    photoId: 'pm-abc',
    filename: 'IMG_0001.jpg',
    flag: 'pick',
  }

  it('accepts the minimal valid entry', () => {
    expect(isMapPickEntry(valid)).toBe(true)
  })

  it('accepts entry with full optional fields', () => {
    expect(isMapPickEntry({
      ...valid,
      label: 'A',
      labelUpdatedAt: '2026-01-01T00:00:00Z',
      gps: {
        capturedAt: { lng: 14, lat: 50, altitude: 350, timestamp: '2026-01-01T00:00:00Z' },
        subjectAt: { lng: 14.5, lat: 50.5 },
      },
    })).toBe(true)
  })

  it('rejects empty photoId — readers gate inclusion on the prefix; empty would slip through', () => {
    expect(isMapPickEntry({ ...valid, photoId: '' })).toBe(false)
  })

  it('rejects unknown flag values (closed wire union)', () => {
    expect(isMapPickEntry({ ...valid, flag: 'archived' })).toBe(false)
  })

  it('rejects when filename is not a string (a number sneaking in from a buggy writer)', () => {
    expect(isMapPickEntry({ ...valid, filename: 42 })).toBe(false)
  })

  it('rejects gps.capturedAt with NaN coords (math errors corrupt the wire)', () => {
    expect(isMapPickEntry({ ...valid, gps: { capturedAt: { lng: Number.NaN, lat: 50 } } })).toBe(false)
  })

  it('rejects gps.subjectAt missing lng', () => {
    expect(isMapPickEntry({ ...valid, gps: { subjectAt: { lat: 50 } } })).toBe(false)
  })

  it('rejects when labelUpdatedAt is non-string', () => {
    expect(isMapPickEntry({ ...valid, labelUpdatedAt: 1234567890 })).toBe(false)
  })

  it('rejects arrays and primitives', () => {
    expect(isMapPickEntry(null)).toBe(false)
    expect(isMapPickEntry(undefined)).toBe(false)
    expect(isMapPickEntry([])).toBe(false)
    expect(isMapPickEntry('hello')).toBe(false)
    expect(isMapPickEntry(42)).toBe(false)
  })

  it('does NOT confuse __proto__-keyed payloads with prototype pollution (JSON.parse always sets own properties)', () => {
    // JSON.parse('{"__proto__":{...}}') sets __proto__ as own data prop,
    // not Object.prototype. We just need to make sure the guard doesn't
    // accidentally trust the polluted shape.
    const malicious = JSON.parse('{"photoId":"pm-x","filename":"a.jpg","flag":"pick","__proto__":{"flag":"reject"}}')
    expect(isMapPickEntry(malicious)).toBe(true)
    // And the real flag is untouched (JSON.parse semantics):
    expect(({} as { flag?: string }).flag).toBeUndefined()
  })
})

describe('isMapPicksFile', () => {
  it('accepts a well-formed envelope (does NOT require every entry to be valid)', () => {
    expect(isMapPicksFile({ version: 1, updatedAt: 'now', picks: [] })).toBe(true)
  })

  it('rejects version != 1', () => {
    expect(isMapPicksFile({ version: 2, updatedAt: 'now', picks: [] })).toBe(false)
  })

  it('rejects picks: not-an-array', () => {
    expect(isMapPicksFile({ version: 1, updatedAt: 'now', picks: 'oops' })).toBe(false)
  })

  it('rejects missing updatedAt', () => {
    expect(isMapPicksFile({ version: 1, picks: [] })).toBe(false)
  })

  it('rejects null', () => {
    expect(isMapPicksFile(null)).toBe(false)
  })
})

describe('isEditorPickEntry', () => {
  const valid = {
    photoId: 'pm-abc',
    label: 'A',
    labelUpdatedAt: '2026-01-01T00:00:00Z',
  }

  it('accepts the minimal valid entry', () => {
    expect(isEditorPickEntry(valid)).toBe(true)
  })

  it('accepts empty-string label (explicit clear)', () => {
    expect(isEditorPickEntry({ ...valid, label: '' })).toBe(true)
  })

  it('rejects empty photoId', () => {
    expect(isEditorPickEntry({ ...valid, photoId: '' })).toBe(false)
  })

  it('rejects non-string label', () => {
    expect(isEditorPickEntry({ ...valid, label: null })).toBe(false)
  })

  it('rejects empty labelUpdatedAt (the editor-side absence sentinel)', () => {
    expect(isEditorPickEntry({ ...valid, labelUpdatedAt: '' })).toBe(false)
  })

  it('rejects missing labelUpdatedAt entirely — the reader uses it for newer-wins', () => {
    const { labelUpdatedAt: _drop, ...rest } = valid
    void _drop
    expect(isEditorPickEntry(rest)).toBe(false)
  })
})

describe('isEditorPicksFile', () => {
  it('accepts well-formed envelope', () => {
    expect(isEditorPicksFile({ version: 1, updatedAt: 'now', picks: [] })).toBe(true)
  })

  it('rejects version 2', () => {
    expect(isEditorPicksFile({ version: 2, updatedAt: 'now', picks: [] })).toBe(false)
  })

  it('rejects picks not-an-array', () => {
    expect(isEditorPicksFile({ version: 1, updatedAt: 'now', picks: { 0: {} } })).toBe(false)
  })
})
