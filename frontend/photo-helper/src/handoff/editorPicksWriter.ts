// Phase B of bidirectional label sync — photo-helper's writer for
// the `photo-helper-picks.json` mirror file. Symmetric to map-corridors'
// mapPicksWriter.ts. Map-corridors reads this file on visibilitychange
// via useEditorPicksSync.
//
// Single writer, 300 ms debounce, serialized I/O. Tracks label per
// `pm-`-prefixed candidate so map-corridors' conflict resolution can
// decide newer-wins.

import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage';
import type { ApiPhoto } from '../types/api';

const FILENAME = 'photo-helper-picks.json';
const DEBOUNCE_MS = 300;
const PM_PREFIX = 'pm-';

export interface EditorPickEntry {
  photoId: string;
  /** Empty string = explicit clear. Same idiom as ApiPhoto.label. */
  label: string;
  /** ISO 8601 — present when label has ever been set in either app. */
  labelUpdatedAt: string;
}

export interface EditorPicksFile {
  version: 1;
  updatedAt: string;
  picks: EditorPickEntry[];
}

/**
 * Project the candidate pool into the cross-app file. Only `pm-`-prefixed
 * photos appear — photo-helper-originated photos stay in the editor and
 * never propagate to map-corridors. Photos without `labelUpdatedAt` are
 * skipped — without the timestamp the map side can't resolve conflicts.
 */
export function buildEditorPicks(candidates: readonly ApiPhoto[]): EditorPickEntry[] {
  const out: EditorPickEntry[] = [];
  for (const p of candidates) {
    if (!p.id.startsWith(PM_PREFIX)) continue;
    if (!p.labelUpdatedAt) continue;
    out.push({
      photoId: p.id,
      label: p.label ?? '',
      labelUpdatedAt: p.labelUpdatedAt,
    });
  }
  return out;
}

type Pending = {
  timer: ReturnType<typeof setTimeout>;
  storage: StorageInterface;
  dir: DirectoryHandle;
  picks: EditorPickEntry[];
};
let pending: Pending | null = null;
// See mapPicksWriter for the rationale on per-call promises + dir-change
// flush; the two writers are symmetric.
let inFlight: Promise<void> = Promise.resolve();

function executeWrite(
  storage: StorageInterface,
  dir: DirectoryHandle,
  picks: EditorPickEntry[],
): Promise<void> {
  const file: EditorPicksFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    picks,
  };
  const currentPromise = inFlight
    .catch(() => undefined)
    .then(() => storage.writeJSON(dir, FILENAME, file));
  inFlight = currentPromise;
  return currentPromise;
}

/**
 * Schedule a debounced write. Latest call wins; rapid label edits
 * (e.g., the user tabs through letters) coalesce into one disk write.
 * On (storage, dir) change the pending write is flushed first so it
 * lands in the correct competition dir.
 */
export function scheduleWriteEditorPicks(
  storage: StorageInterface,
  dir: DirectoryHandle,
  picks: EditorPickEntry[],
): void {
  if (pending) {
    const dirChanged = pending.storage !== storage || pending.dir !== dir;
    clearTimeout(pending.timer);
    if (dirChanged) {
      const stale = pending;
      pending = null;
      void executeWrite(stale.storage, stale.dir, stale.picks).catch(err => {
        console.error('[editorPicks] flush-on-dir-change failed:', err);
      });
    }
  }
  const timer = setTimeout(() => {
    const p = pending;
    pending = null;
    if (!p) return;
    void executeWrite(p.storage, p.dir, p.picks).catch(err => {
      console.error('[editorPicks] debounced writeJSON failed:', err);
    });
  }, DEBOUNCE_MS);
  pending = { timer, storage, dir, picks };
}

/**
 * Cancel the debounce and execute the pending write immediately. Returns
 * a Promise resolving/rejecting for THIS write so callers (the symmetric
 * pre-nav handler in AppApi) can surface a snackbar on failure instead
 * of navigating away from a never-written file.
 */
export function flushPendingEditorPicks(): Promise<void> {
  if (!pending) return Promise.resolve();
  const { timer, storage, dir, picks } = pending;
  clearTimeout(timer);
  pending = null;
  return executeWrite(storage, dir, picks);
}

/** Test-only — drains the module-level state between tests. */
export function _resetEditorPicksWriterForTests(): void {
  if (pending) {
    clearTimeout(pending.timer);
    pending = null;
  }
  inFlight = Promise.resolve();
}
