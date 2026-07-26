// Unit tests for the shared display/order primitives added for the
// rename-preserves-filename feature (user feedback 2026-05-17). These back
// the list row, marker popup, tray, KML export and map-picks projection — one
// place to pin "custom name shows, original filename orders".

import { describe, it, expect } from 'vitest'
import {
  buildPhotoMarkerKmlName,
  buildPhotoMarkerPrintLabel,
  compareFilenames,
  dropNoGpsPhotosWithMarkers,
  comparePhotoMarkers,
  noGpsPhotoDisplayName,
  normalizeDisplayName,
  photoMarkerDisplayName,
} from '../types/markers'
import type { PhotoMarker } from '../types/markers'

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: 'm-1', lng: 0, lat: 0, name: 'x.jpg', ...over } as PhotoMarker
}

describe('photoMarkerDisplayName', () => {
  it('returns the custom displayName when set', () => {
    expect(photoMarkerDisplayName({ name: 'DSC_0001.JPG', displayName: 'TP1' })).toBe('TP1')
  })
  it('falls back to the original filename when no custom name', () => {
    expect(photoMarkerDisplayName({ name: 'DSC_0001.JPG' })).toBe('DSC_0001.JPG')
    expect(photoMarkerDisplayName({ name: 'DSC_0001.JPG', displayName: undefined })).toBe('DSC_0001.JPG')
  })
})

describe('noGpsPhotoDisplayName', () => {
  it('returns the custom displayName when set, else the filename', () => {
    expect(noGpsPhotoDisplayName({ filename: 'DSC_0003.JPG', displayName: 'TP3' })).toBe('TP3')
    expect(noGpsPhotoDisplayName({ filename: 'DSC_0003.JPG' })).toBe('DSC_0003.JPG')
  })
})

describe('compareFilenames', () => {
  it('is numeric-aware: 9 sorts before 10 (not lexical)', () => {
    expect(compareFilenames('DSC_0009.JPG', 'DSC_0010.JPG')).toBeLessThan(0)
    expect(['DSC_0010.JPG', 'DSC_0009.JPG', 'DSC_0100.JPG'].sort(compareFilenames))
      .toEqual(['DSC_0009.JPG', 'DSC_0010.JPG', 'DSC_0100.JPG'])
  })

  it('is case-insensitive (sensitivity: base)', () => {
    expect(compareFilenames('img_1.jpg', 'IMG_1.JPG')).toBe(0)
  })

  it('returns 0 for identical strings', () => {
    expect(compareFilenames('same.jpg', 'same.jpg')).toBe(0)
  })
})

describe('comparePhotoMarkers — compare-modal order (filename primary, EXIF timestamp tie-break)', () => {
  // The side-by-side compare modal receives markers in click/cluster order; this
  // comparator re-orders them into shooting sequence so tile badges + 1/2/3 keys
  // follow the filenames regardless of how the user selected them.
  it('orders by filename ASC even when capture time disagrees', () => {
    const sorted = [
      pm({ id: 'b', name: 'b.jpg', capturedAt: { lng: 0, lat: 0, timestamp: '2024-01-01T00:00:00Z' } }),
      pm({ id: 'a', name: 'a.jpg', capturedAt: { lng: 0, lat: 0, timestamp: '2024-02-01T00:00:00Z' } }),
    ].sort(comparePhotoMarkers).map(m => m.id)
    expect(sorted).toEqual(['a', 'b'])
  })

  it('is numeric-aware: IMG_9 sorts before IMG_10', () => {
    const sorted = [
      pm({ id: 'ten', name: 'IMG_10.jpg' }),
      pm({ id: 'nine', name: 'IMG_9.jpg' }),
    ].sort(comparePhotoMarkers).map(m => m.id)
    expect(sorted).toEqual(['nine', 'ten'])
  })

  it('tie-breaks by EXIF timestamp when filenames are identical', () => {
    const sorted = [
      pm({ id: 'late', name: 'same.jpg', capturedAt: { lng: 0, lat: 0, timestamp: '2024-02-01T00:00:00Z' } }),
      pm({ id: 'early', name: 'same.jpg', capturedAt: { lng: 0, lat: 0, timestamp: '2024-01-01T00:00:00Z' } }),
    ].sort(comparePhotoMarkers).map(m => m.id)
    expect(sorted).toEqual(['early', 'late'])
  })

  it('sorts a marker without capturedAt last among identical filenames', () => {
    const sorted = [
      pm({ id: 'none', name: 'same.jpg' }),
      pm({ id: 'early', name: 'same.jpg', capturedAt: { lng: 0, lat: 0, timestamp: '2024-01-01T00:00:00Z' } }),
    ].sort(comparePhotoMarkers).map(m => m.id)
    expect(sorted).toEqual(['early', 'none'])
  })

  it('orders by filename even when entries lack a timestamp', () => {
    const sorted = [
      pm({ id: 'z', name: 'z.jpg' }),
      pm({ id: 'a', name: 'a.jpg' }),
    ].sort(comparePhotoMarkers).map(m => m.id)
    expect(sorted).toEqual(['a', 'z'])
  })
})

describe('normalizeDisplayName', () => {
  it('keeps a meaningful custom name', () => {
    expect(normalizeDisplayName('TP1', 'DSC_0001.JPG')).toBe('TP1')
  })
  it('passes undefined through', () => {
    expect(normalizeDisplayName(undefined, 'DSC_0001.JPG')).toBeUndefined()
  })
  it('strips an empty / whitespace-only displayName', () => {
    expect(normalizeDisplayName('', 'DSC_0001.JPG')).toBeUndefined()
    expect(normalizeDisplayName('   ', 'DSC_0001.JPG')).toBeUndefined()
  })
  it('strips a redundant displayName equal to the original filename', () => {
    expect(normalizeDisplayName('DSC_0001.JPG', 'DSC_0001.JPG')).toBeUndefined()
  })
  it('keeps a case-only difference (matches clear-on-original being case-sensitive)', () => {
    expect(normalizeDisplayName('dsc_0001.jpg', 'DSC_0001.JPG')).toBe('dsc_0001.jpg')
  })
  it('trims a padded-but-meaningful value (stored form matches the write path)', () => {
    expect(normalizeDisplayName('  TP1  ', 'DSC_0001.JPG')).toBe('TP1')
  })
  it('strips a padded copy of the filename (trimmed value equals the original)', () => {
    expect(normalizeDisplayName('  DSC_0001.JPG  ', 'DSC_0001.JPG')).toBeUndefined()
  })
})

describe('buildPhotoMarkerKmlName', () => {
  it('no label, no custom name → just the filename', () => {
    expect(buildPhotoMarkerKmlName({ name: 'DSC_0123.JPG' })).toBe('DSC_0123.JPG')
  })
  it('custom name → "TP1 (DSC_0123.JPG)"', () => {
    expect(buildPhotoMarkerKmlName({ name: 'DSC_0123.JPG', displayName: 'TP1' }))
      .toBe('TP1 (DSC_0123.JPG)')
  })
  it('label only → "A - DSC_0123.JPG"', () => {
    expect(buildPhotoMarkerKmlName({ name: 'DSC_0123.JPG', label: 'A' }))
      .toBe('A - DSC_0123.JPG')
  })
  it('label + custom name → "A - TP1 (DSC_0123.JPG)"', () => {
    expect(buildPhotoMarkerKmlName({ name: 'DSC_0123.JPG', displayName: 'TP1', label: 'A' }))
      .toBe('A - TP1 (DSC_0123.JPG)')
  })
  it('never doubles a redundant displayName equal to the filename', () => {
    // Would otherwise emit "DSC_0123.JPG (DSC_0123.JPG)".
    expect(buildPhotoMarkerKmlName({ name: 'DSC_0123.JPG', displayName: 'DSC_0123.JPG' }))
      .toBe('DSC_0123.JPG')
  })
  it('treats a blank displayName as absent (matches photoMarkerDisplayName)', () => {
    expect(buildPhotoMarkerKmlName({ name: 'DSC_0123.JPG', displayName: '  ' }))
      .toBe('DSC_0123.JPG')
  })
  it('label + blank displayName → label prefix on the bare filename', () => {
    expect(buildPhotoMarkerKmlName({ name: 'DSC_0123.JPG', displayName: '  ', label: 'A' }))
      .toBe('A - DSC_0123.JPG')
  })
  it('empty name (click-placed marker) with a label → just the label, no trailing " - "', () => {
    // handleMarkerAdd creates markers with name: '' — namePart is falsy, so the
    // fallback returns the label alone (behaviour preserved from the old inline code).
    expect(buildPhotoMarkerKmlName({ name: '', label: 'A' })).toBe('A')
  })
  it('empty name and no label → empty string', () => {
    expect(buildPhotoMarkerKmlName({ name: '' })).toBe('')
  })
  it('returns raw text — XML special chars are NOT escaped here (serializer does that)', () => {
    // The builder is the composition layer; escaping happens downstream at the
    // KML serializer (textContent). A raw "<" must survive verbatim so the
    // serializer can escape it exactly once.
    expect(buildPhotoMarkerKmlName({ name: 'a.jpg', displayName: 'T<P>1' }))
      .toBe('T<P>1 (a.jpg)')
  })
})

// ---------------------------------------------------------------------------
// buildPhotoMarkerPrintLabel — the printed/exported A4 pill text.
// Client feedback 2026-07-23: photo names were missing from the map export.
// Terser than the KML form on purpose (no parenthesised original).
// ---------------------------------------------------------------------------
describe('buildPhotoMarkerPrintLabel', () => {
  it('no label, no custom name → the filename (every dot gets text)', () => {
    expect(buildPhotoMarkerPrintLabel({ name: 'DSC_0123.JPG' })).toBe('DSC_0123.JPG')
  })
  it('custom name only → the custom name', () => {
    expect(buildPhotoMarkerPrintLabel({ name: 'DSC_0123.JPG', displayName: 'TP1' })).toBe('TP1')
  })
  it('label only → "A - DSC_0123.JPG"', () => {
    expect(buildPhotoMarkerPrintLabel({ name: 'DSC_0123.JPG', label: 'A' }))
      .toBe('A - DSC_0123.JPG')
  })
  it('label + custom name → "A - TP1"', () => {
    expect(buildPhotoMarkerPrintLabel({ name: 'DSC_0123.JPG', displayName: 'TP1', label: 'A' }))
      .toBe('A - TP1')
  })
  it('drops the parenthesised original the KML keeps (paper has no room for it)', () => {
    expect(buildPhotoMarkerPrintLabel({ name: 'DSC_0123.JPG', displayName: 'TP1' }))
      .not.toContain('DSC_0123.JPG')
  })
  it('treats blank / redundant displayNames as absent, like every other surface', () => {
    expect(buildPhotoMarkerPrintLabel({ name: 'DSC_0123.JPG', displayName: '  ' }))
      .toBe('DSC_0123.JPG')
    expect(buildPhotoMarkerPrintLabel({ name: 'DSC_0123.JPG', displayName: 'DSC_0123.JPG' }))
      .toBe('DSC_0123.JPG')
  })
  it('empty name (click-placed marker) → label alone, never a dangling " - "', () => {
    expect(buildPhotoMarkerPrintLabel({ name: '', label: 'A' })).toBe('A')
    expect(buildPhotoMarkerPrintLabel({ name: '' })).toBe('')
  })
  it('numeric precision labels compose the same as letter ones', () => {
    // Precision competitions label 1..20 rather than A..T.
    expect(buildPhotoMarkerPrintLabel({ name: 'a.jpg', displayName: 'TP1', label: '3' }))
      .toBe('3 - TP1')
  })
})

// ---------------------------------------------------------------------------
// dropNoGpsPhotosWithMarkers — a photo is on the map OR in the no-GPS tray,
// never both. Client feedback 2026-07-23: a photo that was placed on the map
// also showed a permanent ghost row under "Bez GPS".
// ---------------------------------------------------------------------------
describe('dropNoGpsPhotosWithMarkers', () => {
  const tray = (photoId: string, filename = `${photoId}.jpg`) => ({ photoId, filename })

  it('drops a tray entry whose photo is already placed as a marker', () => {
    const result = dropNoGpsPhotosWithMarkers(
      [tray('p-1'), tray('p-2')],
      [pm({ photoId: 'p-1' })],
    )
    expect(result.map(p => p.photoId)).toEqual(['p-2'])
  })

  it('leaves the tray untouched when nothing is placed', () => {
    const entries = [tray('p-1'), tray('p-2')]
    expect(dropNoGpsPhotosWithMarkers(entries, [])).toEqual(entries)
  })

  it('keeps photos that only exist in the tray', () => {
    const result = dropNoGpsPhotosWithMarkers([tray('p-9')], [pm({ photoId: 'p-1' })])
    expect(result.map(p => p.photoId)).toEqual(['p-9'])
  })

  it('ignores click-placed markers, which carry no photoId', () => {
    // A marker with no photoId is a hand-placed pin, not an imported photo —
    // it must never evict a tray entry (and must not match `undefined`).
    const entries = [tray('p-1')]
    expect(dropNoGpsPhotosWithMarkers(entries, [pm({ photoId: undefined })])).toEqual(entries)
    expect(dropNoGpsPhotosWithMarkers(entries, [pm({ photoId: '' })])).toEqual(entries)
  })

  it('does not mutate its input', () => {
    const entries = [tray('p-1'), tray('p-2')]
    dropNoGpsPhotosWithMarkers(entries, [pm({ photoId: 'p-1' })])
    expect(entries).toHaveLength(2)
  })

  it('handles an empty tray', () => {
    expect(dropNoGpsPhotosWithMarkers([], [pm({ photoId: 'p-1' })])).toEqual([])
  })

  it('drops every duplicate when several tray entries are placed', () => {
    const result = dropNoGpsPhotosWithMarkers(
      [tray('p-1'), tray('p-2'), tray('p-3')],
      [pm({ photoId: 'p-1' }), pm({ photoId: 'p-3' })],
    )
    expect(result.map(p => p.photoId)).toEqual(['p-2'])
  })
})
