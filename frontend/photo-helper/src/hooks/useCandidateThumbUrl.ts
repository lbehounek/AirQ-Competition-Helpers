/**
 * React binding for the candidate-tray thumbnail tier
 * (`utils/candidateThumbs.ts`). Owns exactly two things the resolver must not
 * know about: the `blob:` URL lifetime, and when it is safe to do I/O at all.
 *
 * Mirrors map-corridors' already-reviewed `usePhotoThumbUrl` two-effect split
 * (loader effect never revokes; a separate `[url]`-keyed effect does), with a
 * flicker guard layered on — see `peekCandidateThumb` below.
 */
import { useEffect, useRef, useState } from 'react';
import { getStorage, type DirectoryHandle } from '@airq/shared-storage';
import {
  peekCandidateThumb,
  resolveCandidateThumb,
  type CandidateThumbDeps,
} from '../utils/candidateThumbs';
import type { ApiPhoto } from '../types/api';

/**
 * - `loading`  — nothing to show yet (first paint, or waiting on the dir)
 * - `ready`    — `url` is a thumbnail object URL owned by this hook
 * - `fallback` — no thumb could be made; `url` is the photo's own source URL
 * - `missing`  — there are no bytes at all (placeholder / lost file)
 */
export type CandidateThumbState = 'loading' | 'ready' | 'fallback' | 'missing';

export interface CandidateThumbView {
  url: string | null;
  state: CandidateThumbState;
}

/** Frozen view for a synthetic "no photo" slot — module-scope so its identity is stable. */
const PLACEHOLDER_VIEW: CandidateThumbView = { url: null, state: 'missing' };

/**
 * Get the storage singleton, or null if it is not initialised yet.
 *
 * Returns null instead of throwing: `getStorage()` throws until `initStorage()`
 * has run, and a tray rendering during that window should generate thumbs in
 * memory rather than blow up. Nothing is persisted while it returns null; the
 * first later resolve with a real storage writes the thumb out.
 */
function tryGetStorage(): CandidateThumbDeps['storage'] {
  try {
    return getStorage();
  } catch {
    return null;
  }
}

/**
 * Resolve a candidate photo's tray thumbnail.
 *
 * Returns `{ url, state }` — see `CandidateThumbState`. The returned `url` is
 * always safe to hand to an `<img>`: a thumbnail object URL is revoked only
 * after React has moved on from it, and a `fallback` url is the session's own
 * source URL, which this hook never revokes (the session owns it).
 *
 * `photosDir` is TRI-STATE:
 *   - `undefined` — AppApi is still resolving `competitions/{id}/photos` (also
 *     the case immediately after a competition switch). The hook does NO I/O
 *     and keeps whatever is already on screen. Reading or generating now would
 *     run against no dir, or worse against the PREVIOUS competition's dir, and
 *     persist a thumb into the wrong competition.
 *   - `null` — resolution failed / storage unavailable: thumbs are generated in
 *     memory and never persisted.
 *   - a handle — normal operation.
 */
export function useCandidateThumbUrl(
  photo: Pick<ApiPhoto, 'id' | 'url' | 'isPlaceholder'>,
  photosDir: DirectoryHandle | null | undefined,
): CandidateThumbView {
  const [view, setView] = useState<CandidateThumbView>({ url: null, state: 'loading' });

  // The Blob currently on screen, paired with the object URL minted for it.
  // Comparing Blob IDENTITY is what makes a re-run (a new source `blob:` URL
  // after a competition reload, the photos dir finally arriving) a no-op
  // instead of a fresh URL + a skeleton flash.
  const shownRef = useRef<{ blob: Blob; url: string } | null>(null);

  const { id, url: sourceUrl, isPlaceholder } = photo;

  // Loader effect. Deliberately does NOT revoke anything on cleanup — see the
  // revocation effect below; keeping the two apart means React state and the
  // live object URL can never disagree, StrictMode double-invocation included.
  useEffect(() => {
    /** Show `blob`, minting an object URL only when it is not already shown. */
    const showBlob = (blob: Blob) => {
      if (shownRef.current?.blob === blob) return;
      const objectUrl = URL.createObjectURL(blob);
      shownRef.current = { blob, url: objectUrl };
      setView({ url: objectUrl, state: 'ready' });
    };

    // Placeholders have no bytes anywhere — never touch storage for them. The
    // 'missing' view they get is DERIVED at the bottom of the hook, not pushed
    // through setState from here: a synchronous state write in an effect body
    // is a cascading render (and an eslint react-hooks/set-state-in-effect
    // error), and there is nothing asynchronous to wait for in this branch.
    if (isPlaceholder) return;

    // Tri-state: still resolving. Hold the current view (initially the skeleton).
    if (photosDir === undefined) return;

    const target = { id, url: sourceUrl };
    const deps: CandidateThumbDeps = { storage: tryGetStorage(), photosDir };

    // Synchronous cache hit: paint immediately, never via 'loading'. Still call
    // the resolver — it is a cheap cache hit for it too, and it is the moment
    // an entry generated before the dir existed gets written to disk.
    const cached = peekCandidateThumb(id);
    if (cached) {
      showBlob(cached);
      void resolveCandidateThumb(target, deps);
      return;
    }

    let cancelled = false;
    // NOTE: no `setView({ state: 'loading' })` here. The initial state is
    // already 'loading', and every OTHER state means something is on screen —
    // a thumb, the full-resolution fallback, or the missing-image caption.
    // Dropping back to a skeleton while re-resolving (a new source blob: URL
    // after a competition reload, the photos dir arriving) would be the exact
    // flicker this tier exists to remove. Keep what is painted until the new
    // result lands. (It is also the state write eslint's
    // react-hooks/set-state-in-effect rightly objects to.)
    void resolveCandidateThumb(target, deps).then((blob) => {
      if (cancelled) return;
      if (blob) {
        showBlob(blob);
        return;
      }
      shownRef.current = null;
      // No thumb: show the full-resolution source if we have one (browser
      // downsamples it), otherwise report the photo as unviewable.
      if (sourceUrl.startsWith('blob:')) setView({ url: sourceUrl, state: 'fallback' });
      else setView({ url: null, state: 'missing' });
    });

    return () => { cancelled = true; };
  }, [id, sourceUrl, isPlaceholder, photosDir]);

  // Revocation effect. Only a 'ready' url is ours to revoke — a 'fallback' url
  // is the session's own photo URL and revoking it would break the editor
  // modal, the PDF export and every other consumer of that photo.
  useEffect(() => {
    if (!view.url || view.state !== 'ready') return;
    const owned = view.url;
    return () => { URL.revokeObjectURL(owned); };
  }, [view.url, view.state]);

  // A placeholder's view is a constant — see the effect's early return.
  return isPlaceholder ? PLACEHOLDER_VIEW : view;
}
