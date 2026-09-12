/**
 * Guards a competition-integrity property: a turning-point photograph must
 * never be measured against the corridors.
 *
 * TP photographs are a correct/incorrect task — some deliberately show a
 * feature NOT within 1.0 NM of the turn point, and identifying them is the
 * crew's job (FAI GAC Rally Flying Rules 2025, A 3.4.3a / A 3.4.4). A printed
 * distance would hand the crew the answer, because the false photographs are
 * precisely the ones that land far from any leg.
 *
 * This was reasoned about incorrectly once already: a comment claimed the
 * exclusion existed when `matchPointsToCorridors` was in fact running over the
 * unfiltered marker list. Hence a test rather than a comment.
 */
import { describe, it, expect } from 'vitest'
import { isMeasurablePhoto, measurableMarkers } from '../corridors/measurableMarkers'
import { matchPointsToCorridors } from '../corridors/matchPoints'
import type { PhotoFlag } from '../types/markers'

type M = { id: string; lng: number; lat: number; flag?: PhotoFlag | null }

const marker = (id: string, flag: PhotoFlag | null | undefined, lng = 14, lat = 50): M =>
  ({ id, lng, lat, flag })

describe('isMeasurablePhoto', () => {
  it.each<[PhotoFlag | null | undefined, boolean]>([
    ['pick-turning', false],
    ['pick-track', true],
    ['reject', true],
    [null, true],
    [undefined, true],
  ])('flag %s → measurable %s', (flag, expected) => {
    expect(isMeasurablePhoto(flag)).toBe(expected)
  })

  it('excludes ONLY pick-turning — reject means discarded, not a different kind of photo', () => {
    const all: Array<PhotoFlag | null> = ['pick-track', 'pick-turning', 'reject', null]
    expect(all.filter(isMeasurablePhoto)).toEqual(['pick-track', 'reject', null])
  })
})

describe('measurableMarkers', () => {
  it('drops every turning-point photo and keeps the rest, in order', () => {
    const input = [
      marker('a', 'pick-track'),
      marker('b', 'pick-turning'),
      marker('c', null),
      marker('d', 'pick-turning'),
      marker('e', 'reject'),
    ]
    expect(measurableMarkers(input).map(m => m.id)).toEqual(['a', 'c', 'e'])
  })

  it('returns the SAME array when nothing is excluded', () => {
    // Saves an allocation on the common path and makes `result === markers`
    // hold for a debugger. It is NOT what keeps downstream memos stable —
    // App's own useMemo does that — so do not cite it as such.
    const input = [marker('a', 'pick-track'), marker('b', null)]
    expect(measurableMarkers(input)).toBe(input)
  })

  it('handles an empty list and an all-excluded list', () => {
    expect(measurableMarkers([])).toEqual([])
    expect(measurableMarkers([marker('a', 'pick-turning')])).toEqual([])
  })
})

describe('the invariant, end to end', () => {
  /** Same square-corridor shape the matcher's own suite builds. */
  const squareCorridor = (lng: number, lat: number, halfWidth: number, startName: string) => ({
    name: `5NM-after-${startName}→TP 1`,
    ring: [
      [lng - halfWidth, lat - halfWidth],
      [lng + halfWidth, lat - halfWidth],
      [lng + halfWidth, lat + halfWidth],
      [lng - halfWidth, lat + halfWidth],
      [lng - halfWidth, lat - halfWidth],
    ] as Array<[number, number]>,
    bbox: [lng - halfWidth, lat - halfWidth, lng + halfWidth, lat + halfWidth] as [number, number, number, number],
    startName,
    startCoord: [lng, lat] as [number, number],
  })

  const corridors = [squareCorridor(14.0, 50.1, 0.05, 'SP')]

  it('a turning-point photo never reaches the matcher, even sitting inside a corridor', () => {
    const tp = marker('tp', 'pick-turning', 14.0, 50.1)      // squarely inside
    const track = marker('track', 'pick-track', 14.0, 50.1)  // identical position

    const matched = matchPointsToCorridors(measurableMarkers([tp, track]), corridors)

    // The en-route photo is matched; the turning-point photo is absent
    // entirely — not "matched to null", which a caller might still render.
    expect(matched.track?.startName).toBe('SP')
    expect(matched.tp).toBeUndefined()
  })

  it('without the filter the same photo IS matched — proving the filter is what excludes it', () => {
    // Pins the pre-fix behaviour, so this suite cannot pass by coincidence if
    // the filter is ever dropped from App.
    const tp = marker('tp', 'pick-turning', 14.0, 50.1)
    expect(matchPointsToCorridors([tp], corridors).tp?.startName).toBe('SP')
  })
})
