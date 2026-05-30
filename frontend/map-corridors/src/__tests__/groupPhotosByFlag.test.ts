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

  it('puts photos in their flag groups — BOTH pick categories land in picks', () => {
    const markers: PhotoMarker[] = [
      pm({ id: 'a', photoId: 'pid-a' }),                        // neutral
      pm({ id: 'b', photoId: 'pid-b', flag: 'pick-track' }),    // pick (track)
      pm({ id: 'd', photoId: 'pid-d', flag: 'pick-turning' }),  // pick (turning)
      pm({ id: 'c', photoId: 'pid-c', flag: 'reject' }),        // reject
    ]
    const g = groupPhotosByFlag(markers, [])
    // Track + turning-point picks both count as "picks"; the category only
    // matters for the editor handoff, not the 4-group panel.
    expect(g.picks.map(m => m.id)).toEqual(['b', 'd'])
    expect(g.neutral.map(m => m.id)).toEqual(['a'])
    expect(g.rejects.map(m => m.id)).toEqual(['c'])
  })

  it('excludes KML/click-placed markers (no photoId) from all groups', () => {
    const markers: PhotoMarker[] = [
      pm({ id: 'kml', photoId: undefined }),
      pm({ id: 'photo', photoId: 'pid-1', flag: 'pick-track' }),
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

  it('sorts noGpsPhotos by filename (numeric-aware) without mutating the input', () => {
    const list = [ng('pid-y', 'IMG_10.jpg'), ng('pid-x', 'IMG_9.jpg')]
    const g = groupPhotosByFlag([], list)
    expect(g.noGps.map(p => p.filename)).toEqual(['IMG_9.jpg', 'IMG_10.jpg']) // 9 < 10 numerically
    expect(list.map(p => p.filename)).toEqual(['IMG_10.jpg', 'IMG_9.jpg']) // input untouched
    expect(g.total).toBe(2)
  })

  it('orders each flag group by original filename, numeric-aware', () => {
    const markers: PhotoMarker[] = [
      pm({ id: 'p10', photoId: 'a', flag: 'pick-track', name: 'DSC_0010.JPG' }),
      pm({ id: 'p9', photoId: 'b', flag: 'pick-track', name: 'DSC_0009.JPG' }),
      pm({ id: 'p100', photoId: 'c', flag: 'pick-track', name: 'DSC_0100.JPG' }),
    ]
    const g = groupPhotosByFlag(markers, [])
    expect(g.picks.map(m => m.name)).toEqual(['DSC_0009.JPG', 'DSC_0010.JPG', 'DSC_0100.JPG'])
  })

  it('orders by original filename, NOT by a custom displayName', () => {
    const markers: PhotoMarker[] = [
      pm({ id: 'z', photoId: 'a', flag: 'pick-track', name: 'DSC_0002.JPG', displayName: 'AAA' }),
      pm({ id: 'a', photoId: 'b', flag: 'pick-turning', name: 'DSC_0001.JPG', displayName: 'ZZZ' }),
    ]
    const g = groupPhotosByFlag(markers, [])
    // 0001 before 0002 (filename order) — a rename to ZZZ/AAA must not reorder.
    expect(g.picks.map(m => m.name)).toEqual(['DSC_0001.JPG', 'DSC_0002.JPG'])
  })

  it('total is the sum across all four groups', () => {
    const g = groupPhotosByFlag(
      [
        pm({ id: 'p', photoId: 'pid-p', flag: 'pick-track' }),
        pm({ id: 'n1', photoId: 'pid-n1' }),
        pm({ id: 'n2', photoId: 'pid-n2' }),
        pm({ id: 'r', photoId: 'pid-r', flag: 'reject' }),
      ],
      [ng('pid-ngps')],
    )
    expect(g.total).toBe(5)
  })
})
