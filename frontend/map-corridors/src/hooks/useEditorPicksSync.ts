// Phase C of bidirectional label sync — map-corridors' reader for
// the editor-side mirror file `photo-helper-picks.json`. Counterpart to
// photo-helper's useMapPicksSync (which reads map-picks.json).
//
// On competition load + every `visibilitychange === 'visible'`, reads
// the editor's outgoing labels and applies them to local PhotoMarker
// state when the remote `labelUpdatedAt` is strictly newer than local.
// Equal timestamps → local wins (deterministic tie-break that protects
// in-flight edits on the map side).
//
// NEVER inserts markers — the editor file isn't a source of new photos.
// Map-corridors is the authority for which photos exist; the editor
// only annotates their labels.

import { useEffect } from 'react'
import type { StorageInterface, DirectoryHandle } from '@airq/shared-storage'
import {
  EDITOR_PICKS_FILENAME,
  PM_PHOTO_ID_PREFIX,
  isEditorPickEntry,
  isEditorPicksFile,
  type EditorPicksFile,
} from '@airq/shared-handoff'
import type { PhotoLabel, PhotoMarker } from '../types/markers'

const FILENAME = EDITOR_PICKS_FILENAME
const PM_PREFIX = PM_PHOTO_ID_PREFIX

/**
 * Pure side-effect: read photo-helper-picks.json, apply newer-wins
 * label updates to local markers. Exported for unit testing — the
 * React hook below just runs it on the relevant trigger events.
 *
 * Returns the count of markers whose label was actually changed.
 */
export async function syncEditorPicksOnce(
  storage: StorageInterface,
  competitionDir: DirectoryHandle,
  setMarkers: (updater: (prev: readonly PhotoMarker[]) => readonly PhotoMarker[]) => Promise<void> | void,
): Promise<{ updates: number }> {
  const raw = await storage.readJSON<unknown>(competitionDir, FILENAME)
  if (!isEditorPicksFile(raw)) return { updates: 0 }
  const file: EditorPicksFile = raw

  const newer = new Map<string, { photoId: string; label: string; labelUpdatedAt: string }>()
  for (const entry of file.picks) {
    // Per-row validation — drop malformed entries individually so one
    // corrupt row doesn't sink the whole sync. Log on drop so the
    // user can debug "why did my label not propagate" without source diving.
    if (!isEditorPickEntry(entry)) {
      const id =
        entry && typeof entry === 'object' && 'photoId' in entry
          ? (entry as { photoId: unknown }).photoId
          : '<unknown>'
      console.warn('[useEditorPicksSync] dropped malformed editor-picks entry:', { photoId: id, entry })
      continue
    }
    if (!entry.photoId.startsWith(PM_PREFIX)) continue
    newer.set(entry.photoId, entry)
  }
  if (newer.size === 0) return { updates: 0 }

  let updates = 0
  await setMarkers(prev => prev.map(m => {
    if (!m.photoId) return m
    const entry = newer.get(m.photoId)
    if (!entry) return m
    const remoteIsNewer = !m.labelUpdatedAt || entry.labelUpdatedAt > m.labelUpdatedAt
    if (!remoteIsNewer) return m
    // Empty-string remote label means explicit clear.
    const nextLabel = entry.label === '' ? undefined : entry.label as PhotoLabel
    if (m.label === nextLabel && m.labelUpdatedAt === entry.labelUpdatedAt) return m
    updates++
    return { ...m, label: nextLabel, labelUpdatedAt: entry.labelUpdatedAt }
  }))
  return { updates }
}

/**
 * React hook wrapper. Runs syncEditorPicksOnce when `competitionDir`
 * becomes available and on every `visibilitychange === 'visible'`.
 *
 * `setMarkers` MUST be stable across renders — the session hook hands
 * out stable setters (see `useCorridorSessionOPFS.setMarkers`, which
 * reads `session` via a ref). Putting it in the dep array is now safe,
 * which closes the prior stale-closure window where a visibility-change
 * could overwrite the live session with a mount-time snapshot.
 *
 * `onError` is optional — surface sync failures (file read, JSON parse,
 * setMarkers reject) to a UI toast instead of swallowing them. Called
 * with the original error.
 */
export function useEditorPicksSync(
  storage: StorageInterface | null,
  competitionDir: DirectoryHandle | null,
  setMarkers: (updater: (prev: readonly PhotoMarker[]) => readonly PhotoMarker[]) => Promise<void> | void,
  onError?: (err: unknown) => void,
): void {
  useEffect(() => {
    if (!storage || !competitionDir) return
    let cancelled = false
    const run = async () => {
      try {
        if (cancelled) return
        await syncEditorPicksOnce(storage, competitionDir, setMarkers)
      } catch (err) {
        if (cancelled) return
        console.warn('[useEditorPicksSync] failed:', err)
        if (onError) onError(err)
      }
    }
    void run()
    const onVis = () => {
      if (document.visibilityState === 'visible') void run()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [storage, competitionDir, setMarkers, onError])
}
