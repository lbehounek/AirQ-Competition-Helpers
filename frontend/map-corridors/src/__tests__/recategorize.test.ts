import { describe, it, expect } from 'vitest'
import { flagForGroup, canRecategorize } from '../recategorize/recategorize'

// Phase 14 (drag-to-recategorize). Dropping a row onto a group must map to the
// right flag, and invalid drops (same group, or the no-GPS tray) must be
// rejected so the drop handler can no-op cleanly.

describe('flagForGroup', () => {
  it('picks → pick', () => expect(flagForGroup('picks')).toBe('pick'))
  it('rejects → reject', () => expect(flagForGroup('rejects')).toBe('reject'))
  it('neutral → null (flag cleared)', () => expect(flagForGroup('neutral')).toBeNull())
  it('noGps → undefined (not a recategorize target)', () => expect(flagForGroup('noGps')).toBeUndefined())
})

describe('canRecategorize', () => {
  it('allows pick → reject', () => expect(canRecategorize('picks', 'rejects')).toBe(true))
  it('allows neutral → picks', () => expect(canRecategorize('neutral', 'picks')).toBe(true))
  it('rejects same-group drop (no-op)', () => expect(canRecategorize('picks', 'picks')).toBe(false))
  it('rejects dropping onto the no-GPS tray', () => expect(canRecategorize('picks', 'noGps')).toBe(false))
  it('rejects dragging a no-GPS photo (no flag to change)', () => expect(canRecategorize('noGps', 'picks')).toBe(false))
})
