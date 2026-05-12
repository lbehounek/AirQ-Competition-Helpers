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

import type { ApiPhoto, ApiPhotoSession, CandidateFlag } from '../types/api';

type SetKey = 'set1' | 'set2';

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
