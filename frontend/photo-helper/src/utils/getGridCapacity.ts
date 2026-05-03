/**
 * Per-set grid capacity for a photo session. Centralised to keep the four
 * call sites in `usePhotoSessionOPFS` (`addPhotosToSet`, `reorderPhotos`,
 * `getSessionStats`, `addPhotosToTurningPoint`) and the one in
 * `useCompetitionSystem.getSessionStats` in lockstep — round-5 follow-up
 * to feedback 2026-05-03: the duplicated branches were a known drift
 * hazard (a future cap bump would have to be applied identically in five
 * places, and the diff history shows we already missed sites once).
 *
 * Rules:
 *   • Turning-point mode (rally + precision-hidden-set2): always 10 per set
 *     in BOTH orientations. Landscape grid auto-expands from 3×3 to 5×2 at
 *     10 photos; portrait stays 2×5 = 10.
 *   • Track mode: layout-driven (10 portrait, 9 landscape). The grid is
 *     hard-pinned in track mode so the cap follows orientation.
 *
 * Accepts `unknown` so callers don't have to import the photo-session type
 * just to thread it through. Defensive: missing `mode` defaults to track
 * (the legacy default) and missing `layoutMode` defaults to landscape.
 */
export type SessionShape = {
  mode?: 'track' | 'turningpoint';
  layoutMode?: 'portrait' | 'landscape' | string;
};

export const TURNING_POINT_PER_SET = 10;
export const TRACK_LANDSCAPE_PER_SET = 9;
export const TRACK_PORTRAIT_PER_SET = 10;

export function getGridCapacity(session: SessionShape | null | undefined): number {
  if (!session) return TRACK_LANDSCAPE_PER_SET;
  if (session.mode === 'turningpoint') return TURNING_POINT_PER_SET;
  return session.layoutMode === 'portrait' ? TRACK_PORTRAIT_PER_SET : TRACK_LANDSCAPE_PER_SET;
}
