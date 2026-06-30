/**
 * Pure session-level transitions for the candidate pool.
 *
 * These helpers compute the next session state for promote / demote / swap /
 * flag operations without touching React, OPFS, or blob URLs. The hooks call
 * them and then run the result through their normal persistence path, so the
 * branching logic is unit-testable and stays consistent across the two hook
 * implementations (`useCompetitionSystem`, `usePhotoSessionOPFS`).
 *
 * Contract — see docs/CANDIDATE_PHOTOS.md "Drag/drop interactions":
 *   - promote: tray → empty slot. Clears flag.
 *   - swap:    tray → occupied slot. Displaced slot photo enters tray as 'pick'.
 *   - demote:  slot → tray. Photo enters tray as 'pick' (was good enough to slot).
 *   - setFlag: tray photo flag transition.
 */

import type { ApiPhoto, ApiPhotoSession, ApiPhotoSet, CandidateFlag } from '../types/api';
import { getGridCapacity } from './getGridCapacity';

type SetKey = 'set1' | 'set2';

const emptyModeSets = (): { set1: ApiPhotoSet; set2: ApiPhotoSet } => ({
  set1: { title: '', photos: [] },
  set2: { title: '', photos: [] },
});

const bumpVersion = (s: ApiPhotoSession): ApiPhotoSession => ({
  ...s,
  version: s.version + 1,
  updatedAt: new Date().toISOString(),
});

const getCandidatePhotos = (s: ApiPhotoSession): ApiPhoto[] =>
  s.candidates?.photos ?? [];

/**
 * Promote a candidate photo into a slot. If the slot index is currently
 * occupied, the existing slot photo is swapped back to the candidate pool as
 * a 'pick' (it was committed once, so likely a strong fallback).
 *
 * If `slotIndex` is past the end of the current array, the photo is appended.
 * The caller is responsible for ensuring the resulting slot count does not
 * exceed `getGridCapacity` — typically the slot-renderer prevents drops past
 * `capacity` and this helper trusts that gate.
 */
export function promoteCandidateToSlot(
  session: ApiPhotoSession,
  candidateId: string,
  setKey: SetKey,
  slotIndex: number,
): ApiPhotoSession {
  const candidates = getCandidatePhotos(session);
  const candidate = candidates.find((p) => p.id === candidateId);
  if (!candidate) return session;

  const remainingCandidates = candidates.filter((p) => p.id !== candidateId);
  // Clear flag on entering a slot — flag is a tray-only concept.
  const { flag: _flag, ...rest } = candidate;
  const promoted: ApiPhoto = { ...rest };

  const set = session.sets[setKey];
  const photos = [...set.photos];

  if (slotIndex >= 0 && slotIndex < photos.length) {
    // Swap: displaced slot photo returns to the tray as 'pick'.
    const displaced = photos[slotIndex];
    photos[slotIndex] = promoted;
    const demoted: ApiPhoto = { ...displaced, flag: 'pick' };
    return bumpVersion({
      ...session,
      sets: { ...session.sets, [setKey]: { ...set, photos } },
      candidates: { photos: [...remainingCandidates, demoted] },
    });
  }

  // Empty slot at the end (or past the end — clamp to append).
  photos.splice(Math.min(slotIndex, photos.length), 0, promoted);
  return bumpVersion({
    ...session,
    sets: { ...session.sets, [setKey]: { ...set, photos } },
    candidates: { photos: remainingCandidates },
  });
}

/**
 * Insert a "no photo" placeholder into a set at `slotIndex`, pushing later
 * photos down so a missing turning-point photo can hold its position and keep
 * the SP/TP/FP numbering correct. Index is clamped to [0, length]. Mirrors the
 * new `sets` into the active mode bucket (`setsTrack`/`setsTurning`) like the
 * other slot mutations, so a mode-switch round-trip preserves it. Pure — the
 * caller persists the result. The placeholder is built by `createPlaceholderPhoto`.
 */
export function insertPlaceholderIntoSet(
  session: ApiPhotoSession,
  setKey: SetKey,
  slotIndex: number,
  placeholder: ApiPhoto,
): ApiPhotoSession {
  const set = session.sets[setKey];
  const photos = [...set.photos];
  photos.splice(Math.max(0, Math.min(slotIndex, photos.length)), 0, placeholder);
  const nextSets = { ...session.sets, [setKey]: { ...set, photos } };
  const next = bumpVersion({ ...session, sets: nextSets });
  const modeKey = session.mode === 'track' ? 'setsTrack' : 'setsTurning';
  (next as unknown as Record<string, unknown>)[modeKey] = nextSets;
  return next;
}

/**
 * Demote a slot photo back to the tray. Default flag is 'pick' — the photo
 * was committed to a slot once, so it's likely a strong candidate the user
 * is reconsidering rather than a fresh neutral upload.
 */
export function demoteSlotToCandidate(
  session: ApiPhotoSession,
  setKey: SetKey,
  photoId: string,
  flag: CandidateFlag = 'pick',
): ApiPhotoSession {
  const set = session.sets[setKey];
  const photo = set.photos.find((p) => p.id === photoId);
  if (!photo) return session;
  // Placeholders never enter the candidate tray — they have no image bytes and
  // exist only to hold a turning-point slot position. Demoting one would create
  // a tray entry with a dead url. Ignore the request.
  if (photo.isPlaceholder) return session;

  const remainingSlotPhotos = set.photos.filter((p) => p.id !== photoId);
  const demoted: ApiPhoto = { ...photo, flag };

  return bumpVersion({
    ...session,
    sets: { ...session.sets, [setKey]: { ...set, photos: remainingSlotPhotos } },
    candidates: { photos: [...getCandidatePhotos(session), demoted] },
  });
}

export function setCandidateFlag(
  session: ApiPhotoSession,
  photoId: string,
  flag: CandidateFlag,
): ApiPhotoSession {
  const photos = getCandidatePhotos(session);
  const idx = photos.findIndex((p) => p.id === photoId);
  if (idx === -1) return session;
  const next = [...photos];
  next[idx] = { ...next[idx], flag };
  return bumpVersion({ ...session, candidates: { photos: next } });
}

export function removeCandidate(
  session: ApiPhotoSession,
  photoId: string,
): ApiPhotoSession {
  const photos = getCandidatePhotos(session);
  if (!photos.some((p) => p.id === photoId)) return session;
  return bumpVersion({
    ...session,
    candidates: { photos: photos.filter((p) => p.id !== photoId) },
  });
}

export function clearAllCandidates(session: ApiPhotoSession): ApiPhotoSession {
  if (!session.candidates || session.candidates.photos.length === 0) return session;
  return bumpVersion({ ...session, candidates: { photos: [] } });
}

export function updateCandidateCanvasState(
  session: ApiPhotoSession,
  photoId: string,
  canvasState: Partial<ApiPhoto['canvasState']>,
): ApiPhotoSession {
  const photos = getCandidatePhotos(session);
  const idx = photos.findIndex((p) => p.id === photoId);
  if (idx === -1) return session;
  const next = [...photos];
  next[idx] = {
    ...next[idx],
    canvasState: { ...next[idx].canvasState, ...canvasState },
  };
  return bumpVersion({ ...session, candidates: { photos: next } });
}

export interface RouteImportedPickResult {
  session: ApiPhotoSession;
  /** Where the imported photo landed. 'tray' = both sets full (or set2 unavailable). */
  placement: SetKey | 'tray';
  /**
   * A live `blob:` URL the caller should revoke. Set in two cases:
   *   1. The photo landed in an INACTIVE mode bucket — those buckets store
   *      photos with `url: ''` (regenerated from OPFS on mode-load, mirroring
   *      the sanitisation `updateSessionMode` already applies to the outgoing
   *      bucket), so the URL created at import time is now orphaned.
   *   2. The idempotency guard short-circuited (the id is already placed) —
   *      the URL minted for this duplicate attempt is redundant.
   * A fresh active-set / tray placement keeps the live URL and returns
   * `undefined`.
   */
  revokeUrl?: string;
}

/**
 * Auto-route a freshly-imported map-corridors pick into the sets of its
 * discipline, instead of dropping it into the candidate tray. Counterpart to
 * the manual `promoteCandidateToSlot` flow, but driven by the `pick-track` /
 * `pick-turning` flag carried across the handoff (see useMapPicksSync).
 *
 * Fill policy: when the map designates a target sheet via `desiredSet`
 * (the user's set-break turning point, carried on `MapPickEntry.set`), the
 * photo goes into THAT sheet; if it's at capacity the photo overflows to the
 * candidate tray — never cross-spilled into the other sheet (that would
 * corrupt the before/after-break ordering). When `desiredSet` is absent (no
 * break chosen), the default `set1 → set2 → tray` spillover applies: set1
 * fills first, overflow into set2, both-full → tray. Precision discipline is
 * single-set, so `desiredSet` is ignored and set2 is skipped.
 *
 * Mode policy (decided with the user): never switch the user's active mode.
 * A pick for the discipline NOT currently shown is written into that mode's
 * bucket (`setsTrack` / `setsTurning`) silently — it surfaces when the user
 * switches to that discipline. A pick for the active discipline is written to
 * `session.sets` (visible immediately) and mirrored into the active bucket,
 * exactly like `promoteCandidateToSlot`.
 *
 * Pure: no blob-URL revocation or persistence here. The caller revokes
 * `revokeUrl` and runs the result through its normal persist path.
 */
export function routeImportedPickIntoSets(
  session: ApiPhotoSession,
  photo: ApiPhoto,
  targetMode: 'track' | 'turningpoint',
  isPrecision: boolean,
  desiredSet?: 'set1' | 'set2',
): RouteImportedPickResult {
  const active = session.mode === targetMode;
  const bucketKey = targetMode === 'track' ? 'setsTrack' : 'setsTurning';

  // Source of truth for the target discipline's sets: the live `sets` when
  // it's the active mode, otherwise the persisted mode bucket.
  const working = active
    ? session.sets
    : (session[bucketKey] ?? emptyModeSets());

  // Idempotency by id — counterpart to the filter-then-readd dedup in
  // `addExistingCandidate`. This helper APPENDS, so a rapid re-sync whose
  // `placedIds` / candidates snapshot predates a still-uncommitted placement
  // (mount run + a `visibilitychange` run, before React recomputes the memo)
  // could call us twice for the same `pm-` id and duplicate the photo in a
  // set or the tray. The live session we receive (published synchronously to
  // the ref before persist, see useCompetitionSystem.updateCurrentCompetition)
  // already reflects the prior placement, so short-circuit and let the caller
  // revoke the redundant blob URL minted for this duplicate attempt.
  const inSet1 = working.set1.photos.some((p) => p.id === photo.id);
  const inSet2 = working.set2.photos.some((p) => p.id === photo.id);
  if (inSet1 || inSet2) {
    return { session, placement: inSet1 ? 'set1' : 'set2', revokeUrl: photo.url };
  }
  if (getCandidatePhotos(session).some((p) => p.id === photo.id)) {
    return { session, placement: 'tray', revokeUrl: photo.url };
  }

  const capacity = getGridCapacity({
    mode: targetMode,
    layoutMode: (session as unknown as { layoutMode?: string }).layoutMode,
  });
  const allowSet2 = !isPrecision;
  // Precision is single-sheet, so the map's `desiredSet` is meaningless there —
  // ignore it and fall back to the default fill (which skips set2 anyway).
  const effectiveDesired = !isPrecision && (desiredSet === 'set1' || desiredSet === 'set2')
    ? desiredSet
    : undefined;

  let target: RouteImportedPickResult['placement'];
  if (effectiveDesired) {
    // Map-designated sheet: place there if there's room, else overflow to the
    // tray — never cross-spill into the other sheet.
    target = working[effectiveDesired].photos.length < capacity ? effectiveDesired : 'tray';
  } else if ((working.set1.photos.length) < capacity) {
    target = 'set1';
  } else if (allowSet2 && working.set2.photos.length < capacity) {
    target = 'set2';
  } else {
    target = 'tray';
  }

  if (target === 'tray') {
    // Both sets full (or single-set precision overflow). Keep it in the
    // global candidate pool — flag preserved so the tray colours it and the
    // user can place it by hand. Live URL kept (the tray renders it).
    const trayPhoto: ApiPhoto = { ...photo, sessionId: session.id };
    return {
      session: bumpVersion({
        ...session,
        candidates: { photos: [...getCandidatePhotos(session), trayPhoto] },
      }),
      placement: 'tray',
    };
  }

  // Slot placement: flag is a tray-only concept — drop it on entering a set.
  const { flag: _flag, ...rest } = photo;
  const slotPhoto: ApiPhoto = active
    ? { ...rest, sessionId: session.id }
    // Inactive bucket: store with empty URL like every other inactive-bucket
    // photo; OPFS bytes already exist (map-corridors wrote them) and the URL
    // is regenerated on the next mode switch.
    : { ...rest, sessionId: session.id, url: '' };

  const nextWorking = {
    ...working,
    [target]: {
      ...working[target],
      photos: [...working[target].photos, slotPhoto],
    },
  };

  if (active) {
    // Visible immediately; mirror into the active bucket so a later mode
    // switch doesn't resurrect the pre-import state (same pattern as
    // promoteCandidateToSlot).
    const next: ApiPhotoSession = {
      ...session,
      sets: nextWorking,
    };
    (next as unknown as Record<string, unknown>)[bucketKey] = nextWorking;
    return { session: bumpVersion(next), placement: target };
  }

  // Inactive discipline: write only the bucket; leave the active view alone.
  const next: ApiPhotoSession = { ...session };
  (next as unknown as Record<string, unknown>)[bucketKey] = nextWorking;
  return {
    session: bumpVersion(next),
    placement: target,
    revokeUrl: photo.url,
  };
}

export interface ReconcilePlacedResult {
  session: ApiPhotoSession;
  /** True if the photo was moved (caller persists + counts it); false = no-op. */
  moved: boolean;
}

/**
 * Re-flow a single ALREADY-PLACED map pick to the sheet the map now says it
 * belongs to, because the user moved their TP set-break in map-corridors
 * (`MapPickEntry.set`). Implements the "map owns set membership" half of the
 * reconcile: cross-sheet membership is the corridors break's call, so if the
 * photo's current sheet differs from `desiredSet` we move it; within-sheet
 * order and crops stay the user's (the existing photo object is moved intact,
 * never recreated — so `canvasState` + `label` survive).
 *
 * ACTIVE discipline only — the photo must live in `session.sets` (live blob
 * URLs). Inactive-bucket photos carry `url: ''` and would render blank if
 * overflowed into the always-visible candidate tray; they reconcile when their
 * discipline becomes active (useMapPicksSync re-runs on mode change). The
 * caller guarantees this by only invoking for the active discipline.
 *
 * If the target sheet is at capacity the photo overflows to the candidate tray
 * (re-flagged with its category so the tray colours it), never cross-spilled
 * into the other sheet. No-op (same session ref, `moved: false`) when the photo
 * isn't in the active sets, is already in the right sheet, or under precision
 * (single-set). Pure — no blob-URL churn (a move reuses the live URL).
 */
export function reconcilePlacedToDesiredSet(
  session: ApiPhotoSession,
  photoId: string,
  desiredSet: SetKey,
  isPrecision: boolean,
): ReconcilePlacedResult {
  if (isPrecision) return { session, moved: false };

  const set1 = session.sets.set1.photos;
  const set2 = session.sets.set2.photos;
  const inSet1 = set1.some((p) => p.id === photoId);
  const inSet2 = set2.some((p) => p.id === photoId);
  const currentSet: SetKey | null = inSet1 ? 'set1' : inSet2 ? 'set2' : null;
  if (!currentSet) return { session, moved: false }; // not in the active sets
  if (currentSet === desiredSet) return { session, moved: false }; // already right

  const photo = (currentSet === 'set1' ? set1 : set2).find((p) => p.id === photoId)!;

  // Remove from the current sheet, preserving the other photos' order.
  let newSet1 = currentSet === 'set1' ? set1.filter((p) => p.id !== photoId) : [...set1];
  let newSet2 = currentSet === 'set2' ? set2.filter((p) => p.id !== photoId) : [...set2];

  const capacity = getGridCapacity({
    mode: session.mode,
    layoutMode: (session as unknown as { layoutMode?: string }).layoutMode,
  });
  // The destination sheet is the OTHER one (currentSet !== desiredSet), so the
  // removal above didn't touch it — its current length is the capacity gate.
  // A "no photo" placeholder occupies a real grid slot, so it IS counted here
  // (PR #103 review, GAP 3 — decided): a placeholder is a deliberate reservation
  // for a missing turning point, it cannot itself go to the tray
  // (`demoteSlotToCandidate` blocks placeholders), and the reflow cannot know an
  // incoming photo corresponds to that specific missing TP. So when a placeholder
  // fills the last slot, the displaced real pick overflows to the tray (surfaced
  // for manual resolution) rather than evicting the placeholder or busting the
  // printable grid. `routeImportedPickIntoSets`' first-import gate counts them
  // the same way, so the two paths stay consistent.
  const targetLen = desiredSet === 'set1' ? newSet1.length : newSet2.length;

  let candidates = getCandidatePhotos(session);
  if (targetLen >= capacity) {
    // Target sheet full → overflow to the tray, re-flagged with its category.
    const categoryFlag: CandidateFlag = session.mode === 'track' ? 'pick-track' : 'pick-turning';
    candidates = [...candidates, { ...photo, flag: categoryFlag }];
  } else if (desiredSet === 'set1') {
    newSet1 = [...newSet1, { ...photo }];
  } else {
    newSet2 = [...newSet2, { ...photo }];
  }

  const nextSets = {
    set1: { ...session.sets.set1, photos: newSet1 },
    set2: { ...session.sets.set2, photos: newSet2 },
  };
  const next: ApiPhotoSession = { ...session, sets: nextSets, candidates: { photos: candidates } };
  // Mirror into the active mode bucket so a later mode switch doesn't resurrect
  // the pre-move state (same pattern as promoteCandidateToSlot).
  const modeKey = session.mode === 'track' ? 'setsTrack' : 'setsTurning';
  (next as unknown as Record<string, unknown>)[modeKey] = nextSets;
  return { session: bumpVersion(next), moved: true };
}
