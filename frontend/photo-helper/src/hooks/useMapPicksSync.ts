// Phase 8b of photo-map-culling — cross-app handoff reader.
// Counterpart to map-corridors' mapPicksWriter. Reads
// `competitions/{compId}/map-picks.json` on competition load and on
// `visibilitychange === 'visible'`, then upserts/deletes the map-
// originated entries (photoId prefixed `pm-`) in the candidate pool.
//
// ADR-005 (one-way file), ADR-017 (flag in map-picks.json only),
// ADR-019 (upsert + delete semantics), ADR-020 (re-import dedup
// via contentHash — not consumed here, just round-tripped).

import { useEffect } from 'react';
import {
  getStorage,
  type DirectoryHandle,
  type StorageInterface,
} from '@airq/shared-storage';
import type { ApiPhoto, CandidateFlag } from '../types/api';
import { createDefaultCanvasState } from './usePhotoSessionOPFS';

const MAP_PICKS_FILENAME = 'map-picks.json';

/** Shape map-corridors writes; mirrored here so we don't depend on map-corridors symbols. */
export interface MapPickEntry {
  photoId: string;
  filename: string;
  flag: 'pick' | 'neutral' | 'reject';
  gps?: {
    capturedAt?: { lng: number; lat: number; altitude?: number; timestamp?: string };
    subjectAt?: { lng: number; lat: number };
  };
  label?: string;
}

interface MapPicksFile {
  version: 1;
  updatedAt: string;
  picks: MapPickEntry[];
}

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
}

const PM_PREFIX = 'pm-';

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

  const file = await storage.readJSON<MapPicksFile>(competitionDir, MAP_PICKS_FILENAME);
  if (!file || !Array.isArray(file.picks)) {
    // Absent or malformed file → nothing to sync. Don't delete pool
    // entries either; an absent file is "no info", not "no picks".
    return { inserts, updates, deletes };
  }

  const remoteIds = new Set<string>();
  const localById = new Map<string, ApiPhoto>();
  for (const p of session.candidates) localById.set(p.id, p);

  for (const entry of file.picks) {
    if (!entry.photoId || !entry.photoId.startsWith(PM_PREFIX)) continue;
    remoteIds.add(entry.photoId);
    const existing = localById.get(entry.photoId);
    if (!existing) {
      const blob = await storage.getPhotoBlob(photosDir, entry.photoId).catch(() => null);
      if (!blob) continue; // photo bytes missing; skip silently — re-import in map-corridors would have already failed
      const url = URL.createObjectURL(blob);
      const photo: ApiPhoto = {
        id: entry.photoId,
        sessionId: '', // populated lazily by session hook on next persist
        url,
        filename: entry.filename,
        canvasState: createDefaultCanvasState(),
        label: '',
        flag: entry.flag,
      };
      await session.addCandidate(photo);
      inserts++;
    } else if (existing.flag !== entry.flag) {
      await session.setCandidateFlag(entry.photoId, entry.flag);
      updates++;
    }
  }

  // Cleanup pass: pool entries with `pm-` prefix that are no longer
  // in the file have been deleted in map-corridors. Photo-helper-
  // originated entries (no prefix) are NEVER touched here — the user
  // owns those independently.
  for (const local of session.candidates) {
    if (!local.id.startsWith(PM_PREFIX)) continue;
    if (remoteIds.has(local.id)) continue;
    await session.removeCandidate(local.id);
    deletes++;
  }

  return { inserts, updates, deletes };
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
  useEffect(() => {
    if (!competitionDir || !photosDir) return;
    let cancelled = false;
    const run = async () => {
      try {
        const storage = getStorage();
        if (cancelled) return;
        await syncMapPicksOnce(storage, competitionDir, photosDir, session);
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
    // `session` is intentionally NOT in the dep list — its members
    // (candidates array, callbacks) churn every render, which would
    // re-trigger the effect on every parent state change. The
    // visibilitychange listener catches catching up on stale data; the
    // initial run captures the load-time state. ADR-019 acknowledges
    // last-write-wins reads are safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionDir, photosDir]);
}
