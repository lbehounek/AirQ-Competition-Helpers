import { describe, it, expect } from 'vitest'
import {
  partitionPicksByRouteTP,
  setBreakDividerIndex,
  resolveSetBreakName,
  listRouteTpOptions,
  type SetKey,
} from '../setSplit/partitionPicksBySet'
import type { PhotoMarker } from '../types/markers'
import type { RouteWaypoint } from '../corridors/matchPoints'

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: 'pm', lng: 0, lat: 0, name: 'x.jpg', ...over } as PhotoMarker
}

// A straight west→east route on the equator: SP, TP1, TP2, TP3, FP at lng 0..4.
// A photo's longitude is its distance along the route, so set membership is easy
// to reason about: "Set 2 starts at TP2" → picks at lng >= 2 are set2.
const route = (): RouteWaypoint[] => [
  { name: 'SP', coord: [0, 0] },
  { name: 'TP1', coord: [1, 0] },
  { name: 'TP2', coord: [2, 0] },
  { name: 'TP3', coord: [3, 0] },
  { name: 'FP', coord: [4, 0] },
]

// Track picks spread along the route, plus a turning-point pick.
const picks = (): PhotoMarker[] => [
  pm({ id: 'a', photoId: 'pid-a', name: 'a.jpg', flag: 'pick-track', lng: 0.5, lat: 0 }),
  pm({ id: 'b', photoId: 'pid-b', name: 'b.jpg', flag: 'pick-turning', lng: 1.5, lat: 0 }),
  pm({ id: 'c', photoId: 'pid-c', name: 'c.jpg', flag: 'pick-track', lng: 2.5, lat: 0 }),
  pm({ id: 'd', photoId: 'pid-d', name: 'd.jpg', flag: 'pick-track', lng: 3.5, lat: 0 }),
]

describe('partitionPicksByRouteTP', () => {
  it('returns an empty map when there is no break', () => {
    expect(partitionPicksByRouteTP(picks(), route(), null).size).toBe(0)
    expect(partitionPicksByRouteTP(picks(), route(), undefined).size).toBe(0)
    expect(partitionPicksByRouteTP(picks(), route(), '').size).toBe(0)
  })

  it('splits by route position — picks at/after the break TP → set2, before → set1', () => {
    const m = partitionPicksByRouteTP(picks(), route(), 'TP2')
    expect(Object.fromEntries(m)).toEqual({
      'pid-a': 'set1', // lng 0.5 — before TP2
      'pid-b': 'set1', // lng 1.5 — before TP2
      'pid-c': 'set2', // lng 2.5 — after TP2
      'pid-d': 'set2', // lng 3.5 — after TP2
    })
  })

  it('moving the break to TP3 shifts the cut (a pick before TP3 falls to set1)', () => {
    const m = partitionPicksByRouteTP(picks(), route(), 'TP3')
    expect(m.get('pid-c')).toBe('set1') // lng 2.5 — now before TP3
    expect(m.get('pid-d')).toBe('set2') // lng 3.5 — still after
  })

  it('break at TP1 puts everything from the first leg onward in set2', () => {
    const m = partitionPicksByRouteTP(picks(), route(), 'TP1')
    expect(m.get('pid-a')).toBe('set1') // lng 0.5 — before TP1
    expect([...m.values()].filter(s => s === 'set2')).toHaveLength(3) // b, c, d
  })

  it('returns an empty map for a stale break name (not a current waypoint)', () => {
    expect(partitionPicksByRouteTP(picks(), route(), 'TP9').size).toBe(0)
  })

  it('returns an empty map when the break names SP (would be all-set2 = no split)', () => {
    expect(partitionPicksByRouteTP(picks(), route(), 'SP').size).toBe(0)
  })

  it('returns an empty map when the route has fewer than two waypoints', () => {
    expect(partitionPicksByRouteTP(picks(), [{ name: 'SP', coord: [0, 0] }], 'TP2').size).toBe(0)
  })

  it('ignores non-pick markers (neutral / reject / KML)', () => {
    const m = partitionPicksByRouteTP(
      [
        pm({ id: 'k', photoId: undefined, name: 'k.jpg', lng: 0.5, lat: 0 }), // KML
        pm({ id: 'n', photoId: 'pid-n', name: 'n.jpg', lng: 0.5, lat: 0 }), // neutral
        pm({ id: 'r', photoId: 'pid-r', name: 'r.jpg', flag: 'reject', lng: 0.5, lat: 0 }),
        pm({ id: 'a', photoId: 'pid-a', name: 'a.jpg', flag: 'pick-track', lng: 2.5, lat: 0 }),
      ],
      route(),
      'TP2',
    )
    expect([...m.keys()]).toEqual(['pid-a'])
    expect(m.get('pid-a')).toBe('set2')
  })

  it('omits an unprojectable pick (non-finite coords) → editor default fill', () => {
    const m = partitionPicksByRouteTP(
      [pm({ id: 'x', photoId: 'pid-x', flag: 'pick-track', lng: NaN, lat: NaN })],
      route(),
      'TP2',
    )
    expect(m.has('pid-x')).toBe(false)
  })

  it('a pick exactly at the break TP vertex is set2 (at/after is inclusive)', () => {
    const m = partitionPicksByRouteTP(
      [pm({ id: 'v', photoId: 'pid-v', flag: 'pick-track', lng: 2, lat: 0 })], // == TP2 coord
      route(),
      'TP2',
    )
    expect(m.get('pid-v')).toBe('set2')
  })
})

describe('listRouteTpOptions', () => {
  it('lists the turning points in route order, excluding SP and FP', () => {
    expect(listRouteTpOptions(route()).map(o => o.name)).toEqual(['TP1', 'TP2', 'TP3'])
  })

  it('returns [] for a route with only SP and FP (no turning points)', () => {
    expect(listRouteTpOptions([{ name: 'SP', coord: [0, 0] }, { name: 'FP', coord: [4, 0] }])).toEqual([])
  })

  it('returns [] for an empty waypoint list', () => {
    expect(listRouteTpOptions([])).toEqual([])
  })
})

describe('setBreakDividerIndex', () => {
  const setMap = (entries: Record<string, SetKey>): Map<string, SetKey> =>
    new Map(Object.entries(entries))

  it('returns -1 for an empty set map (no break)', () => {
    expect(setBreakDividerIndex(['a', 'b'], new Map())).toBe(-1)
  })

  it('points at the first set2 row that follows a set1 row', () => {
    const m = setMap({ a: 'set1', b: 'set1', c: 'set2', d: 'set2' })
    expect(setBreakDividerIndex(['a', 'b', 'c', 'd'], m)).toBe(2)
  })

  it('returns -1 when the group is wholly set1 (no within-group boundary)', () => {
    expect(setBreakDividerIndex(['a', 'b'], setMap({ a: 'set1', b: 'set1' }))).toBe(-1)
  })

  it('returns -1 when the group is wholly set2 (boundary lives in the other group)', () => {
    expect(setBreakDividerIndex(['c', 'd'], setMap({ c: 'set2', d: 'set2' }))).toBe(-1)
  })

  it('ignores ids missing from the set map', () => {
    const m = setMap({ a: 'set1', c: 'set2' })
    expect(setBreakDividerIndex(['a', 'b', 'c'], m)).toBe(2)
  })
})

describe('resolveSetBreakName', () => {
  it('returns null for precision regardless of the chosen break (single-set)', () => {
    expect(resolveSetBreakName('precision', 'TP2')).toBeNull()
  })

  it('passes the break name through for rally (and any non-precision discipline)', () => {
    expect(resolveSetBreakName('rally', 'TP2')).toBe('TP2')
    expect(resolveSetBreakName('web', 'TP2')).toBe('TP2')
  })

  it('normalizes an absent break to null (no break chosen)', () => {
    expect(resolveSetBreakName('rally', null)).toBeNull()
    expect(resolveSetBreakName('rally', undefined)).toBeNull()
    expect(resolveSetBreakName(null, undefined)).toBeNull()
  })
})
