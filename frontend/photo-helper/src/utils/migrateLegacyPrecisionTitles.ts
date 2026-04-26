import type { ApiPhotoSession, ApiPhotoSet } from '../types/api';
import {
  DEFAULT_TRACK_SET1_TITLE_PRECISION,
  DEFAULT_TRACK_SET1_TITLE_RALLY,
  DEFAULT_TRACK_SET2_TITLE_RALLY,
} from './defaultTrackSetTitles';

/**
 * One-shot migration for sessions persisted before feedback 2026-04-26 #1.
 *
 * Background: prior to that fix, the precision discipline incorrectly
 * defaulted track-set titles to the rally pair `SP - TPX` / `TPX - FP`.
 * The fix updates the defaults at session-CREATION sites — but precision
 * users who already created a competition under the previous build have
 * those literal strings persisted in OPFS, and the in-hook fallback only
 * applies defaults when the title is *empty*. So existing precision
 * sessions keep showing the misleading rally header forever.
 *
 * This migration rewrites ONLY the exact prior defaults:
 *   set1.title === 'SP - TPX' && set2.title === 'TPX - FP'
 *     → set1.title := 'SP - FP', set2.title := ''
 *
 * Matching the exact prior defaults is critical: a precision user might
 * have manually customised set1 to (say) `SP - FP custom note`. We must
 * NOT clobber user-customised titles. The exact-match guard means the
 * migration is a no-op for any session a user has touched.
 *
 * Migration is gated on `isPrecision` so rally sessions never have their
 * (legitimate) `SP - TPX` / `TPX - FP` defaults rewritten.
 *
 * Both `session.sets` and `session.setsTrack` are migrated — they're
 * separate persistence buckets (per `competitionService.loadSessionPhotos`
 * lines 596-610) and an existing precision session typically has the
 * legacy defaults in BOTH because they were initialised together at
 * session creation. `setsTurning` is left alone (it always defaults to
 * empty titles, never the rally pair).
 */

interface MigrationResult {
  session: ApiPhotoSession;
  migrated: boolean;
}

function migrateBucket(
  bucket: { set1: ApiPhotoSet; set2: ApiPhotoSet } | undefined,
): { bucket: { set1: ApiPhotoSet; set2: ApiPhotoSet } | undefined; changed: boolean } {
  if (!bucket) return { bucket, changed: false };
  if (
    bucket.set1?.title === DEFAULT_TRACK_SET1_TITLE_RALLY &&
    bucket.set2?.title === DEFAULT_TRACK_SET2_TITLE_RALLY
  ) {
    return {
      bucket: {
        set1: { ...bucket.set1, title: DEFAULT_TRACK_SET1_TITLE_PRECISION },
        set2: { ...bucket.set2, title: '' },
      },
      changed: true,
    };
  }
  return { bucket, changed: false };
}

/**
 * Returns a (possibly migrated) session and a `migrated` flag indicating
 * whether any change was made. The original session reference is returned
 * unchanged when no migration applies, so callers can cheap-compare to
 * decide whether to persist back to OPFS.
 */
export function migrateLegacyPrecisionTitles(
  session: ApiPhotoSession | null | undefined,
  isPrecision: boolean,
): MigrationResult {
  if (!session) return { session: session as ApiPhotoSession, migrated: false };
  if (!isPrecision) return { session, migrated: false };

  const setsResult = migrateBucket(session.sets);
  const setsTrackResult = migrateBucket(session.setsTrack);

  if (!setsResult.changed && !setsTrackResult.changed) {
    return { session, migrated: false };
  }

  return {
    session: {
      ...session,
      sets: (setsResult.bucket ?? session.sets) as ApiPhotoSession['sets'],
      setsTrack: setsTrackResult.bucket ?? session.setsTrack,
    },
    migrated: true,
  };
}
