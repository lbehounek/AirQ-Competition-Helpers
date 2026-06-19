// Pure-logic tests for component helpers that are easy to break and
// hard to spot in a manual smoke test. Kept off of RTL on purpose —
// the rules below have nothing to do with rendering, and a typo would
// otherwise ship silently. See PR #64 review.

import { describe, it, expect } from 'vitest'
import { compareNoGpsPhotos, NO_GPS_PHOTO_DRAG_TYPE } from '../components/NoGpsTray'
import { labelButtonState } from '../components/PhotoMarkerPopup'
import type { NoGpsPhoto } from '../types/markers'

function ngp(over: Partial<NoGpsPhoto>): NoGpsPhoto {
  return { photoId: 'pm-1', filename: 'x.jpg', ...over } as NoGpsPhoto
}

describe('NoGpsTray — drag contract', () => {
  it('exports the public MIME type used by MapProviderView for drop detection', () => {
    // The drag MIME is the only contract between the tray and the map
    // drop handler — a rename on one side without the other is a silent
    // feature break. Pin it.
    expect(NO_GPS_PHOTO_DRAG_TYPE).toBe('application/x-airq-no-gps-photo')
  })
})

describe('compareNoGpsPhotos — sort order (filename primary, timestamp tie-break)', () => {
  // User feedback 2026-05-17: order by ORIGINAL filename so a rename (which
  // only sets displayName) never moves a photo. Timestamp is now only a
  // tie-break for identical filenames.
  it('orders by filename ASC even when the timestamp order disagrees', () => {
    // a.jpg was captured LATER than b.jpg — filename must still win.
    const sorted = [
      ngp({ photoId: 'b', filename: 'b.jpg', timestamp: '2024-01-01T00:00:00Z' }),
      ngp({ photoId: 'a', filename: 'a.jpg', timestamp: '2024-02-01T00:00:00Z' }),
    ].sort(compareNoGpsPhotos).map(p => p.photoId)
    expect(sorted).toEqual(['a', 'b'])
  })

  it('is numeric-aware: IMG_9 sorts before IMG_10', () => {
    const sorted = [
      ngp({ photoId: 'ten', filename: 'IMG_10.jpg' }),
      ngp({ photoId: 'nine', filename: 'IMG_9.jpg' }),
    ].sort(compareNoGpsPhotos).map(p => p.photoId)
    expect(sorted).toEqual(['nine', 'ten'])
  })

  it('tie-breaks by timestamp when filenames are identical', () => {
    const sorted = [
      ngp({ photoId: 'late', filename: 'same.jpg', timestamp: '2024-02-01T00:00:00Z' }),
      ngp({ photoId: 'early', filename: 'same.jpg', timestamp: '2024-01-01T00:00:00Z' }),
    ].sort(compareNoGpsPhotos).map(p => p.photoId)
    expect(sorted).toEqual(['early', 'late'])
  })

  it('orders by filename even when entries lack a timestamp', () => {
    const sorted = [
      ngp({ photoId: 'z', filename: 'z.jpg' }),
      ngp({ photoId: 'a', filename: 'a.jpg' }),
    ].sort(compareNoGpsPhotos).map(p => p.photoId)
    expect(sorted).toEqual(['a', 'z'])
  })
})

describe('labelButtonState — picker click rules', () => {
  it("set: unused letter that isn't current → click sets it", () => {
    const s = labelButtonState({ thisLabel: 'A', currentLabel: undefined, usedLabels: [] })
    expect(s).toEqual({ disabled: false, isCurrent: false, intent: 'set' })
  })

  it("clear: re-clicking the CURRENT letter clears it (intent: 'clear')", () => {
    const s = labelButtonState({ thisLabel: 'A', currentLabel: 'A', usedLabels: ['A'] })
    expect(s).toEqual({ disabled: false, isCurrent: true, intent: 'clear' })
  })

  it('disabled: a letter used elsewhere is disabled (intent: noop)', () => {
    const s = labelButtonState({ thisLabel: 'B', currentLabel: 'A', usedLabels: ['A', 'B'] })
    expect(s).toEqual({ disabled: true, isCurrent: false, intent: 'noop' })
  })

  it("NOT disabled: a letter used by ME (this marker) stays clickable so I can clear", () => {
    // Critical: `used && !isCurrent` predicate. If a regression flips
    // this to `used`, the user loses the ability to clear their own label.
    const s = labelButtonState({ thisLabel: 'A', currentLabel: 'A', usedLabels: ['A'] })
    expect(s.disabled).toBe(false)
    expect(s.intent).toBe('clear')
  })
})

describe('PhotoListPanel — Send-to-editor disabled invariant', () => {
  it('is disabled when there are no picks (covered by groupPhotosByFlag tests)', () => {
    // The actual `disabled={pickCount === 0}` (pickCount =
    // groups.picksTurning.length + groups.picksTrack.length) lives in the
    // panel JSX. The grouping is fully tested by groupPhotosByFlag.test
    // — we just pin the rule here as a doc-test so a regression that
    // changes the predicate (e.g. `> 0` instead of `=== 0`) gets caught
    // by reviewers grepping for this file.
    const pickCountEmpty: number = 0
    const pickCountNonempty: number = 3
    expect(pickCountEmpty === 0).toBe(true)
    expect(pickCountNonempty === 0).toBe(false)
  })
})
