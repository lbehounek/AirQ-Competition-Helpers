/**
 * Cross-bucket reference check for a photo id within a session.
 *
 * A photo's OPFS file is shared across the active `sets` and the per-mode
 * buckets (`setsTrack`, `setsTurning`) plus the candidate pool. Deleting the
 * file from disk while ANY container still references it would break the
 * inactive mode (or the slot) on next load (PR #62 review IMP-2/3/C3).
 *
 * Call this AFTER the source container has been mutated (the photo already
 * removed from where it's leaving). Returns true if any OTHER container
 * still references the id and the file must NOT be deleted.
 *
 * Slot deletions should mirror the removal into the active mode bucket
 * (`setsTrack` or `setsTurning`) before calling, otherwise the bucket's
 * stale reference will keep the check truthy forever and the file orphans
 * after a mode-switch round-trip.
 */
import type { ApiPhotoSession } from '../types/api';

export function isPhotoReferencedInSession(
  session: ApiPhotoSession,
  photoId: string,
): boolean {
  const s = session as any;
  const inSet = (set: any) => set?.photos?.some?.((p: any) => p.id === photoId) === true;
  if (inSet(s.sets?.set1)) return true;
  if (inSet(s.sets?.set2)) return true;
  if (inSet(s.setsTrack?.set1)) return true;
  if (inSet(s.setsTrack?.set2)) return true;
  if (inSet(s.setsTurning?.set1)) return true;
  if (inSet(s.setsTurning?.set2)) return true;
  if (s.candidates?.photos?.some?.((p: any) => p.id === photoId) === true) return true;
  return false;
}
