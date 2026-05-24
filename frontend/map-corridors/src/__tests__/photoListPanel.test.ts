// Pure-logic tests for the rename normaliser used by PhotoListPanel.
// User feedback 2026-05-17 (Martin Hrivna): camera-assigned filenames
// like `DSC_0123.JPG` are noise during competition workflow — pin the
// validation rules so a future UI rework of the inline-edit affordance
// doesn't quietly drift the behaviour.

import { describe, it, expect } from 'vitest'
import { normalizeRename } from '../components/PhotoListPanel'

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
