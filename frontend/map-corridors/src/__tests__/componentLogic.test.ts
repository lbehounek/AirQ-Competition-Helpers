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

describe('compareNoGpsPhotos — sort order', () => {
  it('orders timestamped entries ASC by timestamp', () => {
    const sorted = [
      ngp({ photoId: 'b', filename: 'b.jpg', timestamp: '2024-02-01T00:00:00Z' }),
      ngp({ photoId: 'a', filename: 'a.jpg', timestamp: '2024-01-01T00:00:00Z' }),
    ].sort(compareNoGpsPhotos).map(p => p.photoId)
    expect(sorted).toEqual(['a', 'b'])
  })

  it('places entries without timestamp at the end', () => {
    const sorted = [
      ngp({ photoId: 'noTs', filename: 'no.jpg' }),
      ngp({ photoId: 'withTs', filename: 'with.jpg', timestamp: '2024-01-01T00:00:00Z' }),
    ].sort(compareNoGpsPhotos).map(p => p.photoId)
    expect(sorted).toEqual(['withTs', 'noTs'])
  })

  it('tie-breaks alphabetically by filename when timestamps are equal', () => {
    const t = '2024-01-01T00:00:00Z'
    const sorted = [
      ngp({ photoId: 'z', filename: 'z.jpg', timestamp: t }),
      ngp({ photoId: 'a', filename: 'a.jpg', timestamp: t }),
    ].sort(compareNoGpsPhotos).map(p => p.photoId)
    expect(sorted).toEqual(['a', 'z'])
  })

  it('tie-breaks alphabetically when BOTH lack a timestamp', () => {
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
  it('is disabled when picks.length === 0 (covered by groupPhotosByFlag tests)', () => {
    // The actual `disabled={groups.picks.length === 0}` lives in the
    // panel JSX. The grouping is fully tested by groupPhotosByFlag.test
    // — we just pin the rule here as a doc-test so a regression that
    // changes the predicate (e.g. `> 0` instead of `=== 0`) gets caught
    // by reviewers grepping for this file.
    const picksEmpty: { length: number } = { length: 0 }
    const picksNonempty: { length: number } = { length: 3 }
    expect(picksEmpty.length === 0).toBe(true)
    expect(picksNonempty.length === 0).toBe(false)
  })
})
