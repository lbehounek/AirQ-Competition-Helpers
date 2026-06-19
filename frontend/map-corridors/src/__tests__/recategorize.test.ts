import { describe, it, expect } from 'vitest'
import { flagForGroup, canRecategorize } from '../recategorize/recategorize'

// Phase 14 (drag-to-recategorize). Dropping a row onto a group must map to the
// right flag, and invalid drops (same group, or the no-GPS tray) must be
// rejected so the drop handler can no-op cleanly. The two pick groups
// (turning-point vs track) each set their own flag, so dragging a row between
// them re-flags the photo (pick-turning ↔ pick-track) with no popup round-trip.

describe('flagForGroup', () => {
  it('picksTurning → pick-turning', () => expect(flagForGroup('picksTurning')).toBe('pick-turning'))
  it('picksTrack → pick-track', () => expect(flagForGroup('picksTrack')).toBe('pick-track'))
  it('rejects → reject', () => expect(flagForGroup('rejects')).toBe('reject'))
  it('neutral → null (flag cleared)', () => expect(flagForGroup('neutral')).toBeNull())
  it('noGps → undefined (not a recategorize target)', () => expect(flagForGroup('noGps')).toBeUndefined())
})

describe('canRecategorize', () => {
  it('allows track-pick → reject', () => expect(canRecategorize('picksTrack', 'rejects')).toBe(true))
  it('allows neutral → track-pick', () => expect(canRecategorize('neutral', 'picksTrack')).toBe(true))
  it('allows turning-pick ↔ track-pick re-flag (drag between the two pick groups)', () => {
    expect(canRecategorize('picksTurning', 'picksTrack')).toBe(true)
    expect(canRecategorize('picksTrack', 'picksTurning')).toBe(true)
  })
  it('rejects same-group drop (no-op)', () => expect(canRecategorize('picksTrack', 'picksTrack')).toBe(false))
  it('rejects dropping onto the no-GPS tray', () => expect(canRecategorize('picksTrack', 'noGps')).toBe(false))
  it('rejects dragging a no-GPS photo (no flag to change)', () => expect(canRecategorize('noGps', 'picksTrack')).toBe(false))
})
