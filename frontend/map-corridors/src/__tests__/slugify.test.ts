import { describe, expect, it } from 'vitest'
import { slugifyForFilename } from '@airq/shared-storage'

describe('slugifyForFilename', () => {
  it('lowercases ASCII names', () => {
    expect(slugifyForFilename('PLZEN 2026')).toBe('plzen-2026')
  })

  it('strips Czech diacritics', () => {
    expect(slugifyForFilename('Plzeň')).toBe('plzen')
    expect(slugifyForFilename('Letecká rally Šumava')).toBe('letecka-rally-sumava')
    expect(slugifyForFilename('Žďár nad Sázavou')).toBe('zdar-nad-sazavou')
  })

  it('replaces whitespace with single dash', () => {
    expect(slugifyForFilename('Brno   jaro')).toBe('brno-jaro')
    expect(slugifyForFilename('Brno\tjaro')).toBe('brno-jaro')
  })

  it('collapses runs of punctuation/separators to single dash', () => {
    expect(slugifyForFilename('Brno -- jaro / 2026')).toBe('brno-jaro-2026')
    expect(slugifyForFilename('Brno – jaro')).toBe('brno-jaro') // en-dash
    expect(slugifyForFilename('Foo___Bar')).toBe('foo-bar')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugifyForFilename('  Plzeň  ')).toBe('plzen')
    expect(slugifyForFilename('---Plzeň---')).toBe('plzen')
  })

  it('returns empty string when nothing slug-worthy remains', () => {
    expect(slugifyForFilename('   ')).toBe('')
    expect(slugifyForFilename('!!!')).toBe('')
    expect(slugifyForFilename('')).toBe('')
  })
})
