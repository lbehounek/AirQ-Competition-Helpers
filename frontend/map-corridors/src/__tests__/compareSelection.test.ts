import { describe, it, expect } from 'vitest'
import { decideCompareOrSelect } from '../map/compareSelection'
import type { PhotoMarker } from '../types/markers'

// The ≤cap / >cap / too-few branching behind the cluster pill and the floating
// Compare bar. These boundaries (especially "exactly the cap opens the modal,
// one over drops into selection") are the easy-to-flip cases — `<=` vs `<` —
// that decide whether the headline "2–3 open immediately" behaviour holds.

// decideCompareOrSelect only reads markers.length and (for the over-cap branch)
// each marker's id.
const pm = (id: string): PhotoMarker => ({ id } as unknown as PhotoMarker)

const MAX = 3 // mirrors MAX_COMPARE_VARIANTS

describe('decideCompareOrSelect', () => {
  it('ignores an empty set', () => {
    expect(decideCompareOrSelect([], MAX)).toEqual({ kind: 'ignore' })
  })

  it('ignores a single marker (nothing to compare)', () => {
    expect(decideCompareOrSelect([pm('a')], MAX)).toEqual({ kind: 'ignore' })
  })

  it('opens the modal at the lower bound of 2', () => {
    const markers = [pm('a'), pm('b')]
    expect(decideCompareOrSelect(markers, MAX)).toEqual({ kind: 'compare', markers })
  })

  it('opens the modal at exactly the cap (3) — the headline 2–3 case', () => {
    const markers = [pm('a'), pm('b'), pm('c')]
    const d = decideCompareOrSelect(markers, MAX)
    expect(d.kind).toBe('compare')
    // Passes the markers through untouched for the side-by-side modal.
    expect(d).toEqual({ kind: 'compare', markers })
  })

  it('drops into selection one over the cap (4)', () => {
    const markers = [pm('a'), pm('b'), pm('c'), pm('d')]
    expect(decideCompareOrSelect(markers, MAX)).toEqual({
      kind: 'select',
      ids: ['a', 'b', 'c', 'd'],
    })
  })

  it('preserves order when dropping into selection', () => {
    const markers = [pm('c'), pm('a'), pm('b'), pm('d')]
    const d = decideCompareOrSelect(markers, MAX)
    expect(d).toEqual({ kind: 'select', ids: ['c', 'a', 'b', 'd'] })
  })

  it('respects a different cap', () => {
    const markers = [pm('a'), pm('b'), pm('c')]
    // With a cap of 2, three markers now exceed it → selection, not modal.
    expect(decideCompareOrSelect(markers, 2)).toEqual({
      kind: 'select',
      ids: ['a', 'b', 'c'],
    })
  })
})
