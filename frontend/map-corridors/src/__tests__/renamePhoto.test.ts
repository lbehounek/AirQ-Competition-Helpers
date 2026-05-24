// Pure-logic tests for the rename transform behind the `renamePhoto` action.
// Mirrors the `normalizeRename` tests (PhotoListPanel): pin the find / no-op /
// branch-selection rules without rendering the hook or mocking OPFS.
// User feedback 2026-05-17 (Martin Hrivna): rename camera filenames to
// workflow names (TP1, …). Two storage origins must both work — GPS markers
// (`marker.name`) and the off-map tray (`noGpsPhoto.filename`).

import { describe, it, expect } from 'vitest'
import { computeRenamedPhoto } from '../hooks/useCorridorSessionOPFS'
import type { NoGpsPhoto, PhotoMarker } from '../types/markers'

const marker = (photoId: string, name: string): PhotoMarker => ({
  id: `m-${photoId}`,
  lng: 14.4,
  lat: 50.1,
  name,
  photoId,
})

const noGps = (photoId: string, filename: string): NoGpsPhoto => ({
  photoId,
  filename,
})

describe('computeRenamedPhoto', () => {
  it('renames a GPS marker by photoId, leaving siblings untouched', () => {
    const session = {
      markers: [marker('p1', 'DSC_0001.JPG'), marker('p2', 'DSC_0002.JPG')],
      noGpsPhotos: [] as readonly NoGpsPhoto[],
    }
    const next = computeRenamedPhoto(session, 'p1', 'TP1')
    expect(next).not.toBeNull()
    expect(next!.markers[0].name).toBe('TP1')
    // Sibling untouched, and same object reference is fine (only the renamed
    // marker is replaced via map).
    expect(next!.markers[1].name).toBe('DSC_0002.JPG')
    expect(next!.noGpsPhotos).toBe(session.noGpsPhotos)
  })

  it('renames a no-GPS tray entry by photoId (filename field)', () => {
    const session = {
      markers: [] as readonly PhotoMarker[],
      noGpsPhotos: [noGps('p3', 'DSC_0003.JPG'), noGps('p4', 'DSC_0004.JPG')],
    }
    const next = computeRenamedPhoto(session, 'p4', 'TP2')
    expect(next).not.toBeNull()
    expect(next!.noGpsPhotos[1].filename).toBe('TP2')
    expect(next!.noGpsPhotos[0].filename).toBe('DSC_0003.JPG')
    expect(next!.markers).toBe(session.markers)
  })

  it('trims surrounding whitespace before writing', () => {
    const session = { markers: [marker('p1', 'old')], noGpsPhotos: [] as readonly NoGpsPhoto[] }
    expect(computeRenamedPhoto(session, 'p1', '  TP1  ')!.markers[0].name).toBe('TP1')
  })

  it('returns null when the trimmed name equals the current marker name (no-op)', () => {
    const session = { markers: [marker('p1', 'TP1')], noGpsPhotos: [] as readonly NoGpsPhoto[] }
    expect(computeRenamedPhoto(session, 'p1', ' TP1 ')).toBeNull()
  })

  it('returns null when the trimmed name equals the current tray filename (no-op)', () => {
    const session = { markers: [] as readonly PhotoMarker[], noGpsPhotos: [noGps('p3', 'TP3')] }
    expect(computeRenamedPhoto(session, 'p3', 'TP3')).toBeNull()
  })

  it('returns null for an empty / whitespace-only name', () => {
    const session = { markers: [marker('p1', 'old')], noGpsPhotos: [] as readonly NoGpsPhoto[] }
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
    const markers = [marker('p1', 'old')]
    const session = { markers, noGpsPhotos: [] as readonly NoGpsPhoto[] }
    const next = computeRenamedPhoto(session, 'p1', 'TP1')
    expect(markers[0].name).toBe('old') // original unchanged
    expect(next!.markers).not.toBe(markers) // new array reference
  })

  it('tolerates a missing noGpsPhotos field (legacy session)', () => {
    // A pre-ADR-012 session has no `noGpsPhotos` array; the helper's
    // `|| []` guard must keep it from throwing.
    const session = { markers: [marker('p1', 'old')] } as unknown as Parameters<
      typeof computeRenamedPhoto
    >[0]
    const next = computeRenamedPhoto(session, 'p1', 'TP1')
    expect(next!.markers[0].name).toBe('TP1')
    expect(next!.noGpsPhotos).toEqual([])
  })
})
