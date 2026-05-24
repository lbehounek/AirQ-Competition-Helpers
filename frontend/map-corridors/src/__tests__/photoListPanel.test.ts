// Pure-logic tests for the rename normaliser used by PhotoListPanel.
// User feedback 2026-05-17 (Martin Hrivna): camera-assigned filenames
// like `DSC_0123.JPG` are noise during competition workflow — pin the
// validation rules so a future UI rework of the inline-edit affordance
// doesn't quietly drift the behaviour.

import { describe, it, expect } from 'vitest'
import { computeRangeSelection, normalizeRename, toggleSelection } from '../components/PhotoListPanel'

describe('normalizeRename', () => {
  it('returns the trimmed draft when it differs from current', () => {
    expect(normalizeRename('TP1', 'DSC_0123.JPG')).toBe('TP1')
  })

  it('trims surrounding whitespace before comparing', () => {
    expect(normalizeRename('  TP1  ', 'DSC_0123.JPG')).toBe('TP1')
  })

  it('returns null when the trimmed draft equals current (no-op write)', () => {
    expect(normalizeRename(' DSC_0123.JPG ', 'DSC_0123.JPG')).toBeNull()
  })

  it('returns null for empty after trim (cancel-like behaviour)', () => {
    expect(normalizeRename('   ', 'DSC_0123.JPG')).toBeNull()
    expect(normalizeRename('', 'DSC_0123.JPG')).toBeNull()
  })

  it('respects the max-length cap by truncation, not rejection', () => {
    // Guard against the user pasting a 100 KB blob — we cap rather than
    // throw so the rename still succeeds with a sane prefix.
    const oneHundred = 'X'.repeat(100)
    expect(normalizeRename(oneHundred + oneHundred + oneHundred, 'old', 50))
      .toBe('X'.repeat(50))
  })

  it('compares post-truncation against current (so a cap-induced no-op returns null)', () => {
    // If the draft after truncation matches `current`, that's also a no-op.
    expect(normalizeRename('X'.repeat(300), 'X'.repeat(10), 10)).toBeNull()
  })
})

// Phase 12 (photo variants). The selection helpers feed PhotoCompareModal:
// click order must be preserved (the modal renders left-to-right in that
// order) and Shift-range must extend rather than replace so the user can
// fold a stray fourth click into an earlier selection without restarting.

describe('toggleSelection', () => {
  it('appends a new id at the end (preserves click order)', () => {
    expect(toggleSelection(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
  })

  it('removes an already-selected id without reordering siblings', () => {
    expect(toggleSelection(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('empty selection + first toggle yields a single-element selection', () => {
    expect(toggleSelection([], 'a')).toEqual(['a'])
  })

  it('toggling the lone selected id clears the selection', () => {
    expect(toggleSelection(['a'], 'a')).toEqual([])
  })
})

describe('computeRangeSelection', () => {
  const order = ['a', 'b', 'c', 'd', 'e']

  it('extends from anchor to target inclusive, preserving prior selection', () => {
    expect(computeRangeSelection(order, 'b', 'd', ['a'])).toEqual(['a', 'b', 'c', 'd'])
  })

  it('works backwards (target before anchor) — order normalised to visible order', () => {
    expect(computeRangeSelection(order, 'd', 'b', [])).toEqual(['b', 'c', 'd'])
  })

  it('range of length 1 (anchor == target) selects just that id', () => {
    expect(computeRangeSelection(order, 'c', 'c', [])).toEqual(['c'])
  })

  it("does not duplicate ids already present in prev", () => {
    // 'b' is in prev; the range b..d must not produce ['b', 'b', 'c', 'd'].
    expect(computeRangeSelection(order, 'b', 'd', ['b'])).toEqual(['b', 'c', 'd'])
  })

  it('returns prev unchanged when the anchor is unknown (e.g. just-deleted photo)', () => {
    expect(computeRangeSelection(order, 'ghost', 'c', ['a'])).toEqual(['a'])
  })

  it('returns prev unchanged when the target is unknown', () => {
    expect(computeRangeSelection(order, 'a', 'ghost', ['b'])).toEqual(['b'])
  })
})
