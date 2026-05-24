// Pure-logic tests for the rename transform behind the `renamePhoto` action.
// Mirrors the `normalizeRename` tests (PhotoListPanel): pin the find / no-op /
// branch-selection rules without rendering the hook or mocking OPFS.
// User feedback 2026-05-17 (Martin Hrivna): rename camera filenames to
// workflow names (TP1, …) for identification, BUT preserve the original
// filename so the list can stay ordered by it. The rename therefore writes
// `displayName` and never touches `name` / `filename`.

import { describe, it, expect } from 'vitest'
import { computeRenamedPhoto } from '../hooks/useCorridorSessionOPFS'
import type { NoGpsPhoto, PhotoMarker } from '../types/markers'

const marker = (photoId: string, name: string, displayName?: string): PhotoMarker => ({
  id: `m-${photoId}`,
  lng: 14.4,
  lat: 50.1,
  name,
  ...(displayName !== undefined ? { displayName } : {}),
  photoId,
})

const noGps = (photoId: string, filename: string, displayName?: string): NoGpsPhoto => ({
  photoId,
  filename,
  ...(displayName !== undefined ? { displayName } : {}),
})

describe('computeRenamedPhoto', () => {
  it('sets displayName on a GPS marker, leaving the original filename intact', () => {
    const session = {
      markers: [marker('p1', 'DSC_0001.JPG'), marker('p2', 'DSC_0002.JPG')],
      noGpsPhotos: [] as readonly NoGpsPhoto[],
    }
    const next = computeRenamedPhoto(session, 'p1', 'TP1')
    expect(next).not.toBeNull()
    expect(next!.markers[0].displayName).toBe('TP1')
    expect(next!.markers[0].name).toBe('DSC_0001.JPG') // original preserved (sort key)
    // Sibling untouched; noGps array passed through by reference.
    expect(next!.markers[1].displayName).toBeUndefined()
    expect(next!.noGpsPhotos).toBe(session.noGpsPhotos)
  })

  it('sets displayName on a no-GPS tray entry, preserving its filename', () => {
    const session = {
      markers: [] as readonly PhotoMarker[],
      noGpsPhotos: [noGps('p3', 'DSC_0003.JPG'), noGps('p4', 'DSC_0004.JPG')],
    }
    const next = computeRenamedPhoto(session, 'p4', 'TP2')
    expect(next).not.toBeNull()
    expect(next!.noGpsPhotos[1].displayName).toBe('TP2')
    expect(next!.noGpsPhotos[1].filename).toBe('DSC_0004.JPG')
    expect(next!.noGpsPhotos[0].displayName).toBeUndefined()
    expect(next!.markers).toBe(session.markers)
  })

  it('trims surrounding whitespace before writing', () => {
    const session = { markers: [marker('p1', 'old')], noGpsPhotos: [] as readonly NoGpsPhoto[] }
    expect(computeRenamedPhoto(session, 'p1', '  TP1  ')!.markers[0].displayName).toBe('TP1')
  })

  it('changes an existing custom name (TP1 → TP2)', () => {
    const session = { markers: [marker('p1', 'DSC_0001.JPG', 'TP1')], noGpsPhotos: [] as readonly NoGpsPhoto[] }
    const next = computeRenamedPhoto(session, 'p1', 'TP2')
    expect(next!.markers[0].displayName).toBe('TP2')
    expect(next!.markers[0].name).toBe('DSC_0001.JPG')
  })

  it('returns null when the trimmed name equals the current custom name (no-op)', () => {
    const session = { markers: [marker('p1', 'DSC_0001.JPG', 'TP1')], noGpsPhotos: [] as readonly NoGpsPhoto[] }
    expect(computeRenamedPhoto(session, 'p1', ' TP1 ')).toBeNull()
  })

  it('clears displayName when renamed back to the original filename', () => {
    const session = { markers: [marker('p1', 'DSC_0001.JPG', 'TP1')], noGpsPhotos: [] as readonly NoGpsPhoto[] }
    const next = computeRenamedPhoto(session, 'p1', 'DSC_0001.JPG')
    expect(next).not.toBeNull()
    expect(next!.markers[0].displayName).toBeUndefined()
    expect(next!.markers[0].name).toBe('DSC_0001.JPG')
  })

  it('returns null when typing the original filename and no custom name exists (no-op)', () => {
    const session = { markers: [marker('p1', 'DSC_0001.JPG')], noGpsPhotos: [] as readonly NoGpsPhoto[] }
    // nextDisplayName would be undefined (revert), which already equals current → no write.
    expect(computeRenamedPhoto(session, 'p1', 'DSC_0001.JPG')).toBeNull()
  })

  it('returns null for an empty / whitespace-only name (never clears via empty)', () => {
    const session = { markers: [marker('p1', 'DSC_0001.JPG', 'TP1')], noGpsPhotos: [] as readonly NoGpsPhoto[] }
    expect(computeRenamedPhoto(session, 'p1', '')).toBeNull()
    expect(computeRenamedPhoto(session, 'p1', '   ')).toBeNull()
  })

  it('returns null when the photoId is in neither collection', () => {
    const session = {
      markers: [marker('p1', 'old')],
      noGpsPhotos: [noGps('p3', 'old')],
    }
    expect(computeRenamedPhoto(session, 'missing', 'TP1')).toBeNull()
  })

  it('does not mutate the input arrays (returns fresh copies)', () => {
    const markers = [marker('p1', 'DSC_0001.JPG')]
    const session = { markers, noGpsPhotos: [] as readonly NoGpsPhoto[] }
    const next = computeRenamedPhoto(session, 'p1', 'TP1')
    expect(markers[0].displayName).toBeUndefined() // original unchanged
    expect(next!.markers).not.toBe(markers) // new array reference
  })

  it('tolerates a missing noGpsPhotos field (legacy session)', () => {
    // A pre-ADR-012 session has no `noGpsPhotos` array; the helper's
    // `|| []` guard must keep it from throwing.
    const session = { markers: [marker('p1', 'DSC_0001.JPG')] } as unknown as Parameters<
      typeof computeRenamedPhoto
    >[0]
    const next = computeRenamedPhoto(session, 'p1', 'TP1')
    expect(next!.markers[0].displayName).toBe('TP1')
    expect(next!.noGpsPhotos).toEqual([])
  })
})
