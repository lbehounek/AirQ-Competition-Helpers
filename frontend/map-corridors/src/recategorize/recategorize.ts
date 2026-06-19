// Phase 14 — drag-to-recategorize helpers. Dropping a photo row onto a group
// section changes the photo's flag to that group's flag. Pure + unit-tested so
// the rules (which group maps to which flag, and which drops are valid) can't
// drift from the drop handler.

import type { PhotoFlag } from '../types/markers'

export type PanelGroupKey = 'picksTurning' | 'picksTrack' | 'neutral' | 'rejects' | 'noGps'

/**
 * The flag a photo takes when dropped into a group. `null` = neutral (flag
 * cleared). `undefined` = not a valid recategorize target (the no-GPS tray —
 * you can't strip a photo's GPS by dropping it there).
 */
export function flagForGroup(key: PanelGroupKey): PhotoFlag | null | undefined {
  switch (key) {
    // The two pick sections set their category directly — dropping a photo onto
    // "turning-point picks" sets pick-turning, onto "track picks" sets
    // pick-track. So the user can re-flag turning↔track just by dragging the row
    // between the two groups (no marker-popup round-trip needed).
    case 'picksTurning': return 'pick-turning'
    case 'picksTrack': return 'pick-track'
    case 'neutral': return null
    case 'rejects': return 'reject'
    default: return undefined // noGps — not a recategorize target
  }
}

/**
 * Whether a drag from `fromKey` onto `toKey` is a meaningful recategorize:
 * same group is a no-op, and no-GPS is never a valid source or target (no-GPS
 * photos have no marker/flag — they are placed via Feature A instead).
 */
export function canRecategorize(fromKey: PanelGroupKey, toKey: PanelGroupKey): boolean {
  if (fromKey === toKey) return false
  if (fromKey === 'noGps' || toKey === 'noGps') return false
  return true
}
