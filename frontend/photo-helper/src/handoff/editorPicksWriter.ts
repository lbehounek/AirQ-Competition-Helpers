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
  inFlight = inFlight.then(() =>
    storage.writeJSON(dir, FILENAME, file).catch(err => {
      console.error('[editorPicks] writeJSON failed:', err);
    }),
  );
  return inFlight;
}

/**
 * Schedule a debounced write. Latest call wins; rapid label edits
 * (e.g., the user tabs through letters) coalesce into one disk write.
 */
export function scheduleWriteEditorPicks(
  storage: StorageInterface,
  dir: DirectoryHandle,
  picks: EditorPickEntry[],
): void {
  if (pending) clearTimeout(pending.timer);
  const timer = setTimeout(() => {
    const p = pending;
    pending = null;
    if (!p) return;
    void executeWrite(p.storage, p.dir, p.picks);
  }, DEBOUNCE_MS);
  pending = { timer, storage, dir, picks };
}

/**
 * Cancel the debounce and execute the pending write immediately. Used
 * by pagehide listeners and any "switching to map" pre-nav handler so a
 * just-edited label is durable before the focus changes.
 */
export function flushPendingEditorPicks(): Promise<void> {
  if (!pending) return inFlight;
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
