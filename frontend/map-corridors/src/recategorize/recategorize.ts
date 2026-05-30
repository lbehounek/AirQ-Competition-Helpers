// Phase 14 — drag-to-recategorize helpers. Dropping a photo row onto a group
// section changes the photo's flag to that group's flag. Pure + unit-tested so
// the rules (which group maps to which flag, and which drops are valid) can't
// drift from the drop handler.

import type { PhotoFlag } from '../types/markers'

export type PanelGroupKey = 'picks' | 'neutral' | 'rejects' | 'noGps'

/**
 * The flag a photo takes when dropped into a group. `null` = neutral (flag
 * cleared). `undefined` = not a valid recategorize target (the no-GPS tray —
 * you can't strip a photo's GPS by dropping it there).
 */
export function flagForGroup(key: PanelGroupKey): PhotoFlag | null | undefined {
  switch (key) {
    // Dropping into the picks section defaults to track; the user re-categorizes
    // to turning-point via the marker popup. (A neutral pick category isn't a thing.)
    case 'picks': return 'pick-track'
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
