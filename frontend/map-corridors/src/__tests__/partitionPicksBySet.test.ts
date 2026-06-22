import { describe, it, expect } from 'vitest'
import { partitionPicksBySet, setBreakDividerIndex, resolveSetBreakId, type SetKey } from '../setSplit/partitionPicksBySet'
import type { PhotoMarker } from '../types/markers'

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: 'pm', lng: 14, lat: 50, name: 'x.jpg', ...over } as PhotoMarker
}

// Route order is by filename; `b.jpg` (pid-b) is the designated break.
const markers = (): PhotoMarker[] => [
  pm({ id: 'a', photoId: 'pid-a', name: 'a.jpg', flag: 'pick-track' }),
  pm({ id: 'b', photoId: 'pid-b', name: 'b.jpg', flag: 'pick-turning' }), // break
  pm({ id: 'c', photoId: 'pid-c', name: 'c.jpg', flag: 'pick-track' }),
  pm({ id: 'd', photoId: 'pid-d', name: 'd.jpg', flag: 'pick-turning' }),
]

describe('partitionPicksBySet', () => {
  it('returns an empty map when no break is designated', () => {
    expect(partitionPicksBySet(markers(), null).size).toBe(0)
    expect(partitionPicksBySet(markers(), undefined).size).toBe(0)
    expect(partitionPicksBySet(markers(), '').size).toBe(0)
  })

  it('splits in route order — before-or-at the break → set1, after → set2', () => {
    const m = partitionPicksBySet(markers(), 'pid-b')
    expect(Object.fromEntries(m)).toEqual({
      'pid-a': 'set1',
      'pid-b': 'set1', // break TP closes leg 1 (inclusive)
      'pid-c': 'set2',
      'pid-d': 'set2',
    })
  })

  it('ignores non-pick markers (neutral / reject / KML) and unknown break', () => {
    const m = partitionPicksBySet(
      [
        pm({ id: 'k', photoId: undefined, name: 'k.jpg' }), // KML
        pm({ id: 'n', photoId: 'pid-n', name: 'n.jpg' }), // neutral
        pm({ id: 'r', photoId: 'pid-r', name: 'r.jpg', flag: 'reject' }),
        pm({ id: 'a', photoId: 'pid-a', name: 'a.jpg', flag: 'pick-track' }),
      ],
      'pid-a',
    )
    expect([...m.keys()]).toEqual(['pid-a'])
    expect(m.get('pid-a')).toBe('set1')
  })

  it('returns an empty map for a stale break (id not among current picks)', () => {
    expect(partitionPicksBySet(markers(), 'pid-gone').size).toBe(0)
  })

  it('break at the first pick → only it is set1', () => {
    const m = partitionPicksBySet(markers(), 'pid-a')
    expect([...m.values()]).toEqual<SetKey[]>(['set1', 'set2', 'set2', 'set2'])
  })

  it('is independent of input order (sorts by route order internally)', () => {
    const shuffled = [markers()[2], markers()[0], markers()[3], markers()[1]]
    expect(Object.fromEntries(partitionPicksBySet(shuffled, 'pid-b'))).toEqual(
      Object.fromEntries(partitionPicksBySet(markers(), 'pid-b')),
    )
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
    const m = setMap({ a: 'set1', b: 'set1' })
    expect(setBreakDividerIndex(['a', 'b'], m)).toBe(-1)
  })

  it('returns -1 when the group is wholly set2 (boundary lives in the other group)', () => {
    const m = setMap({ c: 'set2', d: 'set2' })
    expect(setBreakDividerIndex(['c', 'd'], m)).toBe(-1)
  })

  it('divider lands before the very first set2 even if only one set1 precedes it', () => {
    const m = setMap({ a: 'set1', b: 'set2', c: 'set2' })
    expect(setBreakDividerIndex(['a', 'b', 'c'], m)).toBe(1)
  })

  it('ignores ids missing from the set map (e.g. photos with no break info)', () => {
    const m = setMap({ a: 'set1', c: 'set2' })
    // 'b' has no membership; the divider still lands at the first qualifying set2.
    expect(setBreakDividerIndex(['a', 'b', 'c'], m)).toBe(2)
  })

  // GAP 1 (PR #103 review): the panel sorts pick rows by filename only
  // (groupPhotosByFlag), while membership is by route order (filename + EXIF).
  // They diverge ONLY when two picks share a filename. In that tie the set2 row
  // can appear before the set1 row in panel order, so no "set2 after a set1"
  // boundary exists → divider is suppressed (returns -1). Documented, cosmetic:
  // the editor still splits correctly by entry.set; the panel just omits the
  // line rather than drawing it in the wrong place. This test pins that.
  it('suppresses the divider on an identical-filename tie where panel order ≠ route order', () => {
    // Route order put dupB in set1 and dupA in set2, but the panel (filename
    // sort, stable) renders them [dupA, dupB] → set2 row first.
    const m = setMap({ dupA: 'set2', dupB: 'set1' })
    expect(setBreakDividerIndex(['dupA', 'dupB'], m)).toBe(-1)
  })
})

describe('resolveSetBreakId', () => {
  it('returns null for precision regardless of the chosen break (single-set)', () => {
    expect(resolveSetBreakId('precision', 'pid-b')).toBeNull()
  })

  it('passes the break id through for rally (and any non-precision discipline)', () => {
    expect(resolveSetBreakId('rally', 'pid-b')).toBe('pid-b')
    expect(resolveSetBreakId('web', 'pid-b')).toBe('pid-b')
  })

  it('normalizes an absent break to null (no break chosen)', () => {
    expect(resolveSetBreakId('rally', null)).toBeNull()
    expect(resolveSetBreakId('rally', undefined)).toBeNull()
    expect(resolveSetBreakId(null, undefined)).toBeNull()
  })
})
