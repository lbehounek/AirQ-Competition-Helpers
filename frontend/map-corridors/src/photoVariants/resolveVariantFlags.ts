// Phase 12 (photo variants) — pure reducer for the side-by-side compare
// "pick a winner" action. Promotes the winner to flag='pick' and demotes
// every loser to flag='reject', leaving all other markers untouched.
//
// Extracted from App.tsx so the invariant the feature relies on — winner
// picked, losers rejected, everyone else identity-preserved — can be pinned
// by a unit test without dragging in OPFS/persistMarkers.
//
// NOTE (regression guard): this is a *flag-only* mutation. It must NOT touch
// `labelUpdatedAt`. That field is the authority for label "newer wins"
// conflict resolution in `useEditorPicksSync` / `useMapPicksSync`; bumping it
// on a flag change makes a flag edit masquerade as a newer label edit and can
// clobber or freeze labels across the map↔editor handoff. Mirrors the
// flag-only `setPhotoFlag` handler, which likewise leaves `labelUpdatedAt`
// alone.

import type { PhotoFlag, PhotoMarker } from '../types/markers'

export function resolveVariantFlags(
  markers: readonly PhotoMarker[],
  winnerId: string,
  loserIds: readonly string[],
): readonly PhotoMarker[] {
  const loserSet = new Set(loserIds)
  return markers.map(m => {
    if (m.id === winnerId) {
      // Preserve the winner's existing pick category if it already had one;
      // otherwise default to track (the user re-categorizes via the popup).
      const winnerFlag: PhotoFlag = m.flag === 'pick-turning' ? 'pick-turning' : 'pick-track'
      return { ...m, flag: winnerFlag }
    }
    if (loserSet.has(m.id)) return { ...m, flag: 'reject' as const }
    return m
  })
}
