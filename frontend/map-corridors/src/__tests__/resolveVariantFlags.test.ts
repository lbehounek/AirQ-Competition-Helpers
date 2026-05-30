import { describe, it, expect } from 'vitest'
import { resolveVariantFlags } from '../photoVariants/resolveVariantFlags'
import type { PhotoMarker } from '../types/markers'

// Phase 12 (photo variants) — the compare modal's "pick a winner" reducer.
// This is the feature's headline correctness property: exactly the winner
// becomes 'pick', exactly the losers become 'reject', everyone else is left
// alone — and, critically, it is a FLAG-ONLY mutation that must never touch
// `labelUpdatedAt` (which would let it masquerade as a newer label edit and
// clobber labels in the map↔editor sync).

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: 'pm', lng: 14, lat: 50, name: 'x.jpg', ...over } as PhotoMarker
}

describe('resolveVariantFlags', () => {
  it('promotes a previously-uncategorized winner to pick-track and demotes losers to reject', () => {
    const markers = [
      pm({ id: 'a', photoId: 'a' }),
      pm({ id: 'b', photoId: 'b' }),
      pm({ id: 'c', photoId: 'c' }),
    ]
    const out = resolveVariantFlags(markers, 'b', ['a', 'c'])
    expect(out.find(m => m.id === 'b')!.flag).toBe('pick-track')
    expect(out.find(m => m.id === 'a')!.flag).toBe('reject')
    expect(out.find(m => m.id === 'c')!.flag).toBe('reject')
  })

  it('preserves the winner\'s existing pick-turning category instead of forcing track', () => {
    const markers = [
      pm({ id: 'a', photoId: 'a', flag: 'pick-turning' }),
      pm({ id: 'b', photoId: 'b' }),
    ]
    const out = resolveVariantFlags(markers, 'a', ['b'])
    expect(out.find(m => m.id === 'a')!.flag).toBe('pick-turning')
    expect(out.find(m => m.id === 'b')!.flag).toBe('reject')
  })

  it('leaves markers outside the variant set untouched (same reference)', () => {
    const bystander = pm({ id: 'z', photoId: 'z', flag: 'pick-track', label: 'A' as never })
    const markers = [pm({ id: 'a', photoId: 'a' }), pm({ id: 'b', photoId: 'b' }), bystander]
    const out = resolveVariantFlags(markers, 'a', ['b'])
    // Identity-preserved: a bystander marker is returned by reference, not cloned.
    expect(out.find(m => m.id === 'z')).toBe(bystander)
  })

  it('does NOT touch labelUpdatedAt — flag-only mutation (regression guard for #74)', () => {
    // Bumping labelUpdatedAt on a flag change makes the winner/loser look like
    // a newer LABEL edit to useEditorPicksSync/useMapPicksSync, which can wipe
    // or freeze labels across the app boundary. Pin that it stays put.
    const winner = pm({ id: 'a', photoId: 'a', label: 'A' as never, labelUpdatedAt: '2025-01-01T00:00:00Z' })
    const loser = pm({ id: 'b', photoId: 'b', label: 'B' as never, labelUpdatedAt: '2025-01-02T00:00:00Z' })
    const out = resolveVariantFlags([winner, loser], 'a', ['b'])
    expect(out.find(m => m.id === 'a')!.labelUpdatedAt).toBe('2025-01-01T00:00:00Z')
    expect(out.find(m => m.id === 'b')!.labelUpdatedAt).toBe('2025-01-02T00:00:00Z')
    // The label itself is also preserved — only the flag changes.
    expect(out.find(m => m.id === 'a')!.label).toBe('A')
    expect(out.find(m => m.id === 'b')!.label).toBe('B')
  })

  it('handles the 2-variant case (one winner, one loser)', () => {
    const out = resolveVariantFlags([pm({ id: 'a', photoId: 'a' }), pm({ id: 'b', photoId: 'b' })], 'a', ['b'])
    expect(out.map(m => m.flag)).toEqual(['pick-track', 'reject'])
  })
})
