import { describe, it, expect } from 'vitest'
import { groupKeyForPhotoId } from '../components/PhotoListPanel'
import { groupPhotosByFlag } from '../components/groupPhotosByFlag'
import type { NoGpsPhoto, PhotoMarker } from '../types/markers'

// Phase 13 (active-photo highlight). `groupKeyForPhotoId` drives the
// auto-expand of the active photo's group when its marker is clicked on the
// map — so it must map a photoId to picks/neutral/rejects, and return null for
// anything that has no GPS marker (unknown id, or a no-GPS tray photo).

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: 'pm', lng: 14, lat: 50, name: 'x.jpg', photoId: 'pm', ...over } as PhotoMarker
}

const markers: PhotoMarker[] = [
  pm({ id: 'a', photoId: 'a', name: 'a.jpg', flag: 'pick-track' }),
  pm({ id: 'b', photoId: 'b', name: 'b.jpg' }), // neutral (no flag)
  pm({ id: 'c', photoId: 'c', name: 'c.jpg', flag: 'reject' }),
]
const noGps: NoGpsPhoto[] = [{ photoId: 'n', filename: 'n.jpg' } as NoGpsPhoto]
const groups = groupPhotosByFlag(markers, noGps)

describe('groupKeyForPhotoId', () => {
  it('returns "picks" for a pick marker', () => {
    expect(groupKeyForPhotoId(groups, 'a')).toBe('picks')
  })

  it('returns "neutral" for an unflagged marker', () => {
    expect(groupKeyForPhotoId(groups, 'b')).toBe('neutral')
  })

  it('returns "rejects" for a rejected marker', () => {
    expect(groupKeyForPhotoId(groups, 'c')).toBe('rejects')
  })

  it('returns null for an unknown photoId', () => {
    expect(groupKeyForPhotoId(groups, 'ghost')).toBeNull()
  })

  it('returns null for a no-GPS tray photo (no marker, never active)', () => {
    expect(groupKeyForPhotoId(groups, 'n')).toBeNull()
  })
})
