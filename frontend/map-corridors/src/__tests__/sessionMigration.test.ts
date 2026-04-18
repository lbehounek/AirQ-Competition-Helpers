import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveMapStyleIdFromPersisted } from '../hooks/useCorridorSessionOPFS'

/**
 * Session migration is the one piece of code in PR #42 that can permanently
 * corrupt every existing user's persisted state on upgrade. These tests pin
 * the precedence rules: new-schema `mapStyleId` > legacy `baseStyle` > default.
 */
describe('resolveMapStyleIdFromPersisted', () => {
  const DEFAULT_ID = 'mapbox-streets'
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('uses stored mapStyleId when present (new schema takes precedence)', () => {
    expect(resolveMapStyleIdFromPersisted({ mapStyleId: 'mapy-basic' }, DEFAULT_ID)).toBe('mapy-basic')
    expect(resolveMapStyleIdFromPersisted({ mapStyleId: 'osm-classic' }, DEFAULT_ID)).toBe('osm-classic')
  })

  it('new-schema mapStyleId wins over legacy baseStyle', () => {
    const rec = { mapStyleId: 'mapy-aerial', baseStyle: 'streets' }
    expect(resolveMapStyleIdFromPersisted(rec, DEFAULT_ID)).toBe('mapy-aerial')
  })

  it('migrates legacy baseStyle="streets" to mapbox-streets', () => {
    expect(resolveMapStyleIdFromPersisted({ baseStyle: 'streets' }, DEFAULT_ID)).toBe('mapbox-streets')
  })

  it('migrates legacy baseStyle="satellite" to mapbox-satellite', () => {
    expect(resolveMapStyleIdFromPersisted({ baseStyle: 'satellite' }, DEFAULT_ID)).toBe('mapbox-satellite')
  })

  it('returns default when session has neither field', () => {
    expect(resolveMapStyleIdFromPersisted({}, DEFAULT_ID)).toBe(DEFAULT_ID)
  })

  it('returns default for malformed records (null, undefined, non-object)', () => {
    expect(resolveMapStyleIdFromPersisted(null, DEFAULT_ID)).toBe(DEFAULT_ID)
    expect(resolveMapStyleIdFromPersisted(undefined, DEFAULT_ID)).toBe(DEFAULT_ID)
    expect(resolveMapStyleIdFromPersisted('not an object', DEFAULT_ID)).toBe(DEFAULT_ID)
    expect(resolveMapStyleIdFromPersisted(42, DEFAULT_ID)).toBe(DEFAULT_ID)
  })

  it('ignores empty-string mapStyleId and falls through to legacy/default', () => {
    // Empty string was previously allowed through (typeof 'string' passed)
    // and would silently reach getStyleForId's fallback. Now it falls through.
    expect(resolveMapStyleIdFromPersisted({ mapStyleId: '', baseStyle: 'satellite' }, DEFAULT_ID)).toBe('mapbox-satellite')
    expect(resolveMapStyleIdFromPersisted({ mapStyleId: '' }, DEFAULT_ID)).toBe(DEFAULT_ID)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('warns and falls through on non-string mapStyleId (corrupted session)', () => {
    expect(resolveMapStyleIdFromPersisted({ mapStyleId: 42 }, DEFAULT_ID)).toBe(DEFAULT_ID)
    expect(resolveMapStyleIdFromPersisted({ mapStyleId: {} }, DEFAULT_ID)).toBe(DEFAULT_ID)
    expect(resolveMapStyleIdFromPersisted({ mapStyleId: null }, DEFAULT_ID)).toBe(DEFAULT_ID)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('warns and falls through on unknown legacy baseStyle (future/corrupted value)', () => {
    expect(resolveMapStyleIdFromPersisted({ baseStyle: 'hybrid' }, DEFAULT_ID)).toBe(DEFAULT_ID)
    expect(resolveMapStyleIdFromPersisted({ baseStyle: 42 }, DEFAULT_ID)).toBe(DEFAULT_ID)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('passes through unknown mapStyleId strings (getStyleForId will fallback + warn)', () => {
    // Unknown but string values are kept so `useMapStyle` can heal them
    // via onChange — validating strings here would lose user preference.
    expect(resolveMapStyleIdFromPersisted({ mapStyleId: 'some-future-style' }, DEFAULT_ID))
      .toBe('some-future-style')
  })
})
