import { describe, it, expect } from 'vitest'
import { isSetBreakValid } from '../hooks/useCorridorSessionOPFS'
import type { PhotoMarker } from '../types/markers'

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: 'm', lng: 14, lat: 50, name: 'x.jpg', ...over } as PhotoMarker
}

describe('isSetBreakValid', () => {
  it('is valid when no break is set (nothing to invalidate)', () => {
    expect(isSetBreakValid(null, [])).toBe(true)
    expect(isSetBreakValid(undefined, [pm({ photoId: 'p1', flag: 'pick-turning' })])).toBe(true)
  })

  it('is valid when the break photo is still a turning-point pick', () => {
    const markers = [pm({ photoId: 'p1', flag: 'pick-turning' })]
    expect(isSetBreakValid('p1', markers)).toBe(true)
  })

  it('is STALE when the break photo was re-categorised to track', () => {
    const markers = [pm({ photoId: 'p1', flag: 'pick-track' })]
    expect(isSetBreakValid('p1', markers)).toBe(false)
  })

  it('is STALE when the break photo was rejected', () => {
    expect(isSetBreakValid('p1', [pm({ photoId: 'p1', flag: 'reject' })])).toBe(false)
  })

  it('is STALE when the break photo was removed from the markers', () => {
    expect(isSetBreakValid('p1', [pm({ photoId: 'p2', flag: 'pick-turning' })])).toBe(false)
  })
})
