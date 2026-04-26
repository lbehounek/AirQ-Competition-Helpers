/**
 * Compute the set of `blob:` URLs that must be revoked when the user
 * switches between track and turning-point modes.
 *
 * Background — feedback 2026-04-26 #4 ("first TP page: photos flicker
 * and disappear"):
 *
 * `competitionService.loadSessionPhotos` (lines 596-610) calls
 * `URL.createObjectURL` *independently* for each of the three buckets
 * (`session.sets`, `session.setsTrack`, `session.setsTurning`) — even
 * when they reference the same underlying photo file. So each bucket
 * carries its own *distinct* `blob:` URL string. Three buckets × N
 * photos = up to 3N independent URL registrations per session load.
 *
 * The original code revoked URLs across ALL THREE buckets before the
 * mode swap. That broke the *incoming* mode's photos: the renderer
 * still held string references to the now-invalidated `blob:` URLs
 * until the OPFS reload regenerated them, producing a one-frame
 * "photos flash and disappear" symptom on the first page after
 * entering the new mode.
 *
 * The first fix attempt (PR #54) over-corrected: it revoked ONLY
 * `session.sets`, leaving the *outgoing* mode-bucket's distinct URL
 * strings (`session.setsTrack` or `session.setsTurning`, whichever the
 * user is leaving) leaking on every mode switch.
 *
 * Correct rule: revoke the OUTGOING mode-bucket's URLs (and the
 * `session.sets` view of them), but NEVER pre-revoke the INCOMING
 * mode-bucket's URLs. The incoming bucket's URLs are about to become
 * `session.sets` after the post-swap OPFS reload; pre-revoking them
 * causes the flicker. They get fresh URLs on reload, and the OLD
 * incoming URLs are dropped from React state at that point — those
 * are an accepted leak (revoking them inline would re-introduce a
 * one-frame flicker; deferring the revoke to a microtask is brittle).
 */

interface PhotoLike {
  url?: string;
}

interface SetsBucketLike {
  set1?: { photos?: ReadonlyArray<PhotoLike> };
  set2?: { photos?: ReadonlyArray<PhotoLike> };
}

interface SessionLike {
  mode: 'track' | 'turningpoint';
  sets?: SetsBucketLike;
  setsTrack?: SetsBucketLike;
  setsTurning?: SetsBucketLike;
}

function collectBlobUrls(bucket: SetsBucketLike | undefined): string[] {
  if (!bucket) return [];
  const urls: string[] = [];
  for (const setKey of ['set1', 'set2'] as const) {
    const photos = bucket[setKey]?.photos;
    if (!photos) continue;
    for (const photo of photos) {
      const url = photo?.url;
      if (typeof url === 'string' && url.startsWith('blob:')) urls.push(url);
    }
  }
  return urls;
}

/**
 * Returns the de-duplicated list of `blob:` URLs that should be
 * revoked when switching from `session.mode` to `nextMode`.
 *
 * Includes:
 *   - `session.sets` URLs (the outgoing view)
 *   - the outgoing-mode bucket's URLs (`setsTrack` or `setsTurning`,
 *     whichever matches `session.mode`)
 *
 * Excludes:
 *   - the incoming-mode bucket's URLs (about to become `session.sets`
 *     after the OPFS reload — pre-revoking causes flicker)
 */
export function collectModeSwitchRevokeUrls(
  session: SessionLike,
  nextMode: 'track' | 'turningpoint',
): string[] {
  if (session.mode === nextMode) {
    // No-op switch (rare — the caller usually guards against this, but
    // the contract should hold even if it doesn't): nothing to revoke.
    return [];
  }
  const outgoingKey = session.mode === 'track' ? 'setsTrack' : 'setsTurning';
  const outgoingBucket = session[outgoingKey];

  // De-dupe in case `session.sets` and the outgoing bucket share photo
  // references (which happens on first hook render before any mode
  // switch — both initialised from the same `loadPhotoUrls` call).
  // Still safe to call `URL.revokeObjectURL` twice on the same URL
  // (it's spec-defined as no-op on unknown/already-revoked URLs), but
  // returning a Set-like result keeps the contract clean for tests.
  const urls = new Set<string>([
    ...collectBlobUrls(session.sets),
    ...collectBlobUrls(outgoingBucket),
  ]);
  return [...urls];
}
