import { describe, it, expect } from 'vitest'
import { migrateLegacyPhotoFlag, isPhotoMarker, sanitizePhotoMarkers } from '../types/markers'

// A3 (2026-05-30) split the single `pick` flag into `pick-track` / `pick-turning`.
// A v1 session persisted `flag: 'pick'`; that value is no longer in the guard's
// accepted set, so the migration MUST run before isPhotoMarker or a previously-
// picked photo is silently dropped on load. These pin both halves of that trap.

describe('migrateLegacyPhotoFlag', () => {
  it('rewrites a legacy bare `pick` to `pick-track`', () => {
    const out = migrateLegacyPhotoFlag({ id: 'pm-1', flag: 'pick' }) as { flag: string }
    expect(out.flag).toBe('pick-track')
  })

  it('does not mutate the input object (returns a fresh copy)', () => {
    const input = { id: 'pm-1', flag: 'pick' as const }
    const out = migrateLegacyPhotoFlag(input)
    expect(out).not.toBe(input)
    expect(input.flag).toBe('pick') // original untouched
  })

  it.each(['pick-track', 'pick-turning', 'reject'])('leaves a current flag (%s) untouched', (flag) => {
    const input = { id: 'pm-1', flag }
    expect(migrateLegacyPhotoFlag(input)).toBe(input) // same reference — no copy
  })

  it('leaves a marker with no flag (neutral) untouched', () => {
    const input = { id: 'pm-1' }
    expect(migrateLegacyPhotoFlag(input)).toBe(input)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'pick'],
    ['number', 42],
  ])('passes non-objects (%s) straight through', (_label, value) => {
    expect(migrateLegacyPhotoFlag(value)).toBe(value)
  })

  it('migrated marker passes the isPhotoMarker guard (no data loss on load)', () => {
    const legacy = { id: 'pm-1', lng: 14, lat: 50, name: 'DSC_0001.JPG', flag: 'pick' }
    // Pre-migration the legacy value fails the guard…
    expect(isPhotoMarker(legacy)).toBe(false)
    // …and migrating first rescues it.
    const migrated = migrateLegacyPhotoFlag(legacy)
    expect(isPhotoMarker(migrated)).toBe(true)
  })

  it('sanitizePhotoMarkers migrates-then-keeps a legacy pick (end-to-end load path)', () => {
    const out = sanitizePhotoMarkers([
      { id: 'pm-1', lng: 14, lat: 50, name: 'DSC_0001.JPG', flag: 'pick' },
    ])
    expect(out).toHaveLength(1) // not dropped
    expect(out[0].flag).toBe('pick-track')
  })
})
