// Phase 8b of photo-map-culling — cross-app handoff reader.
// Counterpart to map-corridors' mapPicksWriter. Reads
// `competitions/{compId}/map-picks.json` on competition load and on
// `visibilitychange === 'visible'`, then upserts/deletes the map-
// originated entries (photoId prefixed `pm-`) in the candidate pool.
//
// ADR-005 (one-way file), ADR-017 (flag in map-picks.json only),
// ADR-019 (upsert + delete semantics), ADR-020 (re-import dedup
// via contentHash — not consumed here, just round-tripped).

import { useEffect, useRef } from 'react';
import {
  getStorage,
  type DirectoryHandle,
  type StorageInterface,
} from '@airq/shared-storage';
import {
  MAP_PICKS_FILENAME,
  PM_PHOTO_ID_PREFIX,
  isMapPickEntry,
  isMapPicksFile,
  type MapPickEntry,
} from '@airq/shared-handoff';
import type { ApiPhoto, CandidateFlag } from '../types/api';
import { createDefaultCanvasState } from './usePhotoSessionOPFS';

// Re-export so existing call sites that imported MapPickEntry from
// this module keep compiling. Single source of truth is shared-handoff.
export type { MapPickEntry };

/**
 * Minimal session contract this hook needs to mutate the candidate
 * pool. AppApi provides an adapter wrapping the active session hook;
 * the indirection keeps useMapPicksSync agnostic to which photo-helper
 * session impl (useCompetitionSystem vs usePhotoSessionOPFS) is wired.
 */
export interface MapPicksSyncSessionApi {
  candidates: readonly ApiPhoto[];
  /** Insert a pre-built ApiPhoto. Called for `pm-` entries not yet in the pool. */
  addCandidate: (photo: ApiPhoto) => Promise<void> | void;
  /** Remove a candidate by id. Called when a `pm-` entry disappears from map-picks.json. */
  removeCandidate: (photoId: string) => Promise<void> | void;
  /** Update flag in place; preserves canvasState + photo-helper-owned fields. */
  setCandidateFlag: (photoId: string, flag: CandidateFlag) => Promise<void> | void;
  /**
   * Update label in place (bidirectional label sync, Phase A).
   * Called when remote `entry.labelUpdatedAt` is newer than the local
   * `labelUpdatedAt`. Empty string = explicit clear.
   */
  setCandidateLabel: (photoId: string, label: string) => Promise<void> | void;
  /**
   * Update the display filename in place. User feedback 2026-05-17
   * (Martin Hrivna): map-corridors now lets the user rename imported
   * photos to workflow-friendly names (`TP1` etc.). For freshly-handed-
   * off photos that lands automatically via the insert path
   * (`entry.filename` → `ApiPhoto.filename`), but a rename of a photo
   * ALREADY in the editor's pool would otherwise be ignored — the prior
   * update branch only diffed `flag` and `label`. Map-corridors is the
   * authority for `filename` on `pm-` entries; one-way sync, no
   * timestamp / newer-wins (no editor-side filename edit exists).
   */
  setCandidateFilename: (photoId: string, filename: string) => Promise<void> | void;
}

const PM_PREFIX = PM_PHOTO_ID_PREFIX;

/**
 * Reusable side-effect: read map-picks.json, project entries into the
 * candidate pool. Exported (not just the hook) so tests + a future
 * one-shot integration can call it without React. Returns the number
 * of writes performed (inserts + updates + deletes) — useful for
 * progress/debug logging.
 */
export async function syncMapPicksOnce(
  storage: StorageInterface,
  competitionDir: DirectoryHandle,
  photosDir: DirectoryHandle,
  session: MapPicksSyncSessionApi,
): Promise<{ inserts: number; updates: number; deletes: number }> {
  let inserts = 0;
  let updates = 0;
  let deletes = 0;

  const raw = await storage.readJSON<unknown>(competitionDir, MAP_PICKS_FILENAME);
  if (!isMapPicksFile(raw)) {
    // Absent or malformed file → nothing to sync. Don't delete pool
    // entries either; an absent file is "no info", not "no picks".
    return { inserts, updates, deletes };
  }
  const file = raw;

  const remoteIds = new Set<string>();
  // Local index of pm-prefixed candidates. Mutated as we insert so a
  // second pass (or a duplicate entry in the file) sees the just-inserted
  // photo and doesn't allocate a fresh blob URL for the same id.
  const localById = new Map<string, ApiPhoto>();
  for (const p of session.candidates) localById.set(p.id, p);

  for (const entry of file.picks) {
    // Per-row validation — drop malformed entries individually so a
    // single bad row doesn't sink the whole sync. Log on drop so
    // "why did my pick disappear" is debuggable without source diving.
    if (!isMapPickEntry(entry)) {
      const id =
        entry && typeof entry === 'object' && 'photoId' in entry
          ? (entry as { photoId: unknown }).photoId
          : '<unknown>';
      console.warn('[useMapPicksSync] dropped malformed map-picks entry:', { photoId: id, entry });
      continue;
    }
    if (!entry.photoId.startsWith(PM_PREFIX)) continue;
    remoteIds.add(entry.photoId);
    const existing = localById.get(entry.photoId);
    if (!existing) {
      // Narrow the swallow to NotFoundError — other storage errors
      // (permission revoked, InvalidStateError) shouldn't silently
      // collapse into "photo missing".
      let blob: Blob | null;
      try {
        blob = await storage.getPhotoBlob(photosDir, entry.photoId);
      } catch (err) {
        if (isNotFoundError(err)) {
          blob = null;
        } else {
          console.warn('[useMapPicksSync] getPhotoBlob failed:', err);
          continue;
        }
      }
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      const photo: ApiPhoto = {
        id: entry.photoId,
        sessionId: '', // populated lazily by session hook on next persist
        url,
        filename: entry.filename,
        canvasState: createDefaultCanvasState(),
        label: entry.label ?? '',
        flag: entry.flag,
        ...(entry.labelUpdatedAt ? { labelUpdatedAt: entry.labelUpdatedAt } : {}),
      };
      await session.addCandidate(photo);
      localById.set(entry.photoId, photo);
      inserts++;
    } else {
      let touched = false;
      if (existing.flag !== entry.flag) {
        await session.setCandidateFlag(entry.photoId, entry.flag);
        touched = true;
      }
      // Bidirectional label sync — newer wins. Equal timestamps → local
      // wins (deterministic tie-break for in-flight edits).
      const remoteLabel = entry.label ?? '';
      const remoteAt = entry.labelUpdatedAt;
      const localAt = existing.labelUpdatedAt;
      const remoteIsNewer = remoteAt && (!localAt || remoteAt > localAt);
      if (remoteIsNewer && existing.label !== remoteLabel) {
        await session.setCandidateLabel(entry.photoId, remoteLabel);
        touched = true;
      }
      // One-way filename sync (map-corridors → editor). No timestamp
      // because the editor doesn't have a rename UI — every divergence
      // is the map's authoritative value. Without this branch, a rename
      // in map-corridors AFTER first Send is silently lost: the insert
      // branch picks it up on the first sync, but subsequent renames hit
      // the update branch which used to ignore `filename`.
      if (existing.filename !== entry.filename) {
        await session.setCandidateFilename(entry.photoId, entry.filename);
        touched = true;
      }
      if (touched) updates++;
    }
  }

  // Cleanup pass: pool entries with `pm-` prefix that are no longer
  // in the file have been deleted in map-corridors. Photo-helper-
  // originated entries (no prefix) are NEVER touched here — the user
  // owns those independently. Iterate the local index (which we've
  // kept current with inserts) rather than the snapshot we were given,
  // so a freshly-inserted photo isn't immediately deleted on the same
  // pass.
  for (const local of localById.values()) {
    if (!local.id.startsWith(PM_PREFIX)) continue;
    if (remoteIds.has(local.id)) continue;
    await session.removeCandidate(local.id);
    deletes++;
  }

  return { inserts, updates, deletes };
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  return name === 'NotFoundError';
}

/**
 * React hook wrapper. Runs `syncMapPicksOnce` when the
 * `(competitionDir, photosDir)` pair becomes available and every time
 * the page becomes visible again — covers the "user switched to
 * photo-helper after picking in map-corridors" path without any IPC.
 */
export function useMapPicksSync(
  competitionDir: DirectoryHandle | null,
  photosDir: DirectoryHandle | null,
  session: MapPicksSyncSessionApi,
): void {
  // Mirror `session` into a ref so the visibilitychange-triggered runs
  // see the LIVE candidates + callbacks. Capturing `session` in the
  // effect closure would freeze candidates at mount-time, making every
  // re-sync misidentify already-inserted photos as new (one fresh blob
  // URL per re-sync, leaking forever) and potentially deleting them in
  // the cleanup pass.
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  useEffect(() => {
    if (!competitionDir || !photosDir) return;
    let cancelled = false;
    const run = async () => {
      try {
        const storage = getStorage();
        if (cancelled) return;
        await syncMapPicksOnce(storage, competitionDir, photosDir, sessionRef.current);
      } catch (err) {
        if (!cancelled) console.warn('[useMapPicksSync] sync failed:', err);
      }
    };
    void run();
    const onVis = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [competitionDir, photosDir]);
}
