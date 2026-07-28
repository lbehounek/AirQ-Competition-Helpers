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
import type { ApiPhotoSession, ApiPhotoSet } from '../types/api';

export function isPhotoReferencedInSession(
  session: ApiPhotoSession,
  photoId: string,
): boolean {
  // Every access below stays optional-chained even where the declared type
  // says it can't be nullish (`sets`, `photos`). The session this runs against
  // was read back from disk and may predate a bucket or have been written by
  // an older build; and `some?.()` additionally survives a `photos` that
  // deserialized as something other than an array. Losing that tolerance here
  // means an exception on the delete path, which would strand OPFS files.
  const inSet = (set: ApiPhotoSet | undefined): boolean =>
    set?.photos?.some?.((p) => p.id === photoId) === true;

  if (inSet(session.sets?.set1)) return true;
  if (inSet(session.sets?.set2)) return true;
  if (inSet(session.setsTrack?.set1)) return true;
  if (inSet(session.setsTrack?.set2)) return true;
  if (inSet(session.setsTurning?.set1)) return true;
  if (inSet(session.setsTurning?.set2)) return true;
  if (session.candidates?.photos?.some?.((p) => p.id === photoId) === true) return true;
  return false;
}
