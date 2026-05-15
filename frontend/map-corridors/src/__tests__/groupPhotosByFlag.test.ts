import { describe, it, expect } from 'vitest'
import { groupPhotosByFlag } from '../components/groupPhotosByFlag'
import type { NoGpsPhoto, PhotoMarker } from '../types/markers'

function pm(over: Partial<PhotoMarker>): PhotoMarker {
  return { id: 'pm', lng: 14, lat: 50, name: 'x.jpg', ...over } as PhotoMarker
}

function ng(photoId: string, filename = `${photoId}.jpg`): NoGpsPhoto {
  return { photoId, filename }
}

describe('groupPhotosByFlag', () => {
  it('returns four empty arrays + total=0 for no input', () => {
    const g = groupPhotosByFlag([], [])
    expect(g.picks).toEqual([])
    expect(g.neutral).toEqual([])
    expect(g.rejects).toEqual([])
    expect(g.noGps).toEqual([])
    expect(g.total).toBe(0)
  })

  it('puts photos in their flag groups', () => {
    const markers: PhotoMarker[] = [
      pm({ id: 'a', photoId: 'pid-a' }),                // neutral
      pm({ id: 'b', photoId: 'pid-b', flag: 'pick' }),  // pick
      pm({ id: 'c', photoId: 'pid-c', flag: 'reject' }),// reject
    ]
    const g = groupPhotosByFlag(markers, [])
    expect(g.picks.map(m => m.id)).toEqual(['b'])
    expect(g.neutral.map(m => m.id)).toEqual(['a'])
    expect(g.rejects.map(m => m.id)).toEqual(['c'])
  })

  it('excludes KML/click-placed markers (no photoId) from all groups', () => {
    const markers: PhotoMarker[] = [
      pm({ id: 'kml', photoId: undefined }),
      pm({ id: 'photo', photoId: 'pid-1', flag: 'pick' }),
    ]
    const g = groupPhotosByFlag(markers, [])
    expect(g.picks.map(m => m.id)).toEqual(['photo'])
    expect(g.neutral).toEqual([])
    expect(g.total).toBe(1)
  })

  it('treats labelled-but-no-flag as neutral (label is independent of flag)', () => {
    // A photo can have a label without flag='pick' (e.g., legacy data
    // from before the flag field existed). Grouping is by flag only.
    const markers = [pm({ id: 'a', photoId: 'pid-a', label: 'A' })]
    const g = groupPhotosByFlag(markers, [])
    expect(g.neutral.map(m => m.id)).toEqual(['a'])
    expect(g.picks).toEqual([])
  })

  it('passes noGpsPhotos through verbatim', () => {
    const list = [ng('pid-x'), ng('pid-y')]
    const g = groupPhotosByFlag([], list)
    expect(g.noGps).toBe(list) // identity-preserving — safe for memo
    expect(g.total).toBe(2)
  })

  it('total is the sum across all four groups', () => {
    const g = groupPhotosByFlag(
      [
        pm({ id: 'p', photoId: 'pid-p', flag: 'pick' }),
        pm({ id: 'n1', photoId: 'pid-n1' }),
        pm({ id: 'n2', photoId: 'pid-n2' }),
        pm({ id: 'r', photoId: 'pid-r', flag: 'reject' }),
      ],
      [ng('pid-ngps')],
    )
    expect(g.total).toBe(5)
  })
})
