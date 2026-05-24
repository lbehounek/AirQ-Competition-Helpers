import { describe, it, expect } from 'vitest'
import { isProvisionalValid, type ProvisionalPlacement } from '../provisionalPlacement/provisionalPlacement'
import type { NoGpsPhoto } from '../types/markers'

// Phase 14 — the provisional no-GPS placement must be cancelled when its photo
// leaves the "Bez GPS" list (placed via the tray, or deleted) while the pin is
// still up. Otherwise the orphan pin commits against a missing entry and shows
// a false "placement failed" error.

const prov: ProvisionalPlacement = { photoId: 'p1', filename: 'a.jpg', lng: 14, lat: 50 }
const noGps = (...ids: string[]): NoGpsPhoto[] => ids.map(id => ({ photoId: id, filename: `${id}.jpg` } as NoGpsPhoto))

describe('isProvisionalValid', () => {
  it('valid while the photo is still awaiting placement', () => {
    expect(isProvisionalValid(prov, noGps('p1', 'p2'))).toBe(true)
  })

  it('invalid once the photo has left noGpsPhotos (placed or deleted)', () => {
    expect(isProvisionalValid(prov, noGps('p2'))).toBe(false)
    expect(isProvisionalValid(prov, noGps())).toBe(false)
  })

  it('null provisional is trivially invalid', () => {
    expect(isProvisionalValid(null, noGps('p1'))).toBe(false)
  })
})
