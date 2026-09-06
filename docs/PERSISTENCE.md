# Persistence — how an edit reaches disk

Scope: `frontend/photo-helper`. Everything below sits **above**
`StorageInterface.writeJSON`, so OPFS (web) and the Electron native backend
behave identically.

---

## The path of one edit

```
slider move ─► PhotoControls.onPreview ─► PhotoEditorModalBody preview overlay   (no I/O)
slider release ─► PhotoControls.onCommit ─► useDebouncedCommit.schedule          (150 ms)
             └─► AppApi.handlePhotoUpdate ─► useCompetitionSystem.updatePhotoState
                 └─► competitionService.updateCompetition ─► write queue ─► session.json
```

1. **Preview (`PhotoEditorModalBody`)** — the live value of an in-progress
   interaction lives in the modal body's local `preview` state, keyed by photo
   id. Nothing is persisted and nothing outside the modal subtree re-renders.
   The old code put this value in `AppApi`, so every pointer-move redrew every
   mounted grid and candidate-tray canvas.
2. **Debounce (`useDebouncedCommit`, 150 ms trailing)** — successive deltas
   MERGE into one pending payload, so a commit never carries a field the user
   did not touch. `commitNow` (reset, label corner, circle colour, AWB) folds
   the pending delta in rather than dropping it. One debounce per modal, shared
   by both `PhotoControls` panels.
3. **Coalescing write queue (`competitionService`)** — see below.

---

## Service-level rules

- **One FIFO queue** (`@airq/shared-storage`'s `createSerialQueue`) orders
  every writer of `session.json` and `competitions-index.json` in this
  renderer. `writeJSON` promises no ordering across overlapping calls, and both
  files are whole-file snapshots.
- **Latest snapshot per competition.** `updateCompetition` publishes its
  payload into `pendingSessionWrites` *before* enqueuing, then the first task
  of the burst writes whatever is owed and the rest find nothing and no-op.
  Every caller still resolves only after the write that superseded it settled,
  so `await updateCompetition(...)` still means "it is on disk".
- **`updatePhotos` is OR-accumulated** across a coalesced burst — the single
  surviving write never skips photo bytes an earlier call asked for.
- **The index leaves the hot path.** `competitions-index.json` carries only
  `name` / `photoCount` / `lastModified`. It is rewritten immediately when
  name or photoCount changed, otherwise at most every `INDEX_REFRESH_MS`
  (10 s); a skipped `lastModified` is recorded in `indexDirty` and applied by
  the next flush. Canvas edits change none of those fields.
- **`flushPendingWrites()`** retries session payloads left by failed writes,
  then applies the owed index patches. Per-entry isolation: one failure never
  blocks the others, a `NotFoundError` (directory gone) drops that payload for
  good, and the first error is rethrown at the end.

### Invariants a change must not break

| Invariant | Why |
| --- | --- |
| Public mutators enqueue **exactly once** | Two enqueues per call double the writes and reorder bursts. |
| Private helpers (`writeSessionNow`, `writeIndexEntryNow`, `refreshIndexEntryIfNeeded`, `getCompetitionsIndex`, `saveCompetitionsIndex`) **never** enqueue | Re-entering the queue from inside a task deadlocks silently. |
| Publish **before** the first `await` | A `pagehide` caller must have its payload owed even if the write never lands. |
| The delete tombstone runs **inside** delete's queued task | FIFO then guarantees no earlier task is still holding a snapshot that would re-create the directory. |
| The hook's rollback is **conditional** on not having been superseded | A later call in the same burst may already have written our payload; an unconditional rollback would discard persisted state and raise a false error banner. |

---

## Flush points

`useCompetitionSystem.flushPersistence()` (best-effort; logs and swallows) is
called at every point where the renderer is about to stop running or the data
underneath it is about to change:

- `pagehide` and `visibilitychange → hidden` (AppApi)
- desktop **Back to menu** / **Switch to placement** (AppApi)
- competition **create / switch / delete** and **mode switch** (the hook) —
  always *before* any `revokeSessionBlobUrls` or URL stripping, so a queued
  `updatePhotos: true` payload is written while its `blob:` URLs are alive
- apply-to-all / sync-label-to-all flush the *editor* debounce (not the
  service queue) so the fan-out reads the value the user just set

---

## Known, accepted costs

- The index's `lastModified` for the active competition may lag by up to 10 s.
  `CompetitionSelector` sorts by it, but its list is only refreshed on
  create / switch / delete / rename — all of which flush first.
- Grid canvases behind the modal update on commit (≤150 ms after release)
  rather than per pointer-move.
- A delta carrying a nested object (`whiteBalance`, `circle`) captures that
  sub-object at schedule time, so a conflicting change to a *sibling* field of
  the same sub-object inside the 150 ms window is overwritten. Documented in
  `useDebouncedCommit`; it takes two different inputs within 150 ms.
- Writes started from `pagehide` are best-effort on OPFS. The debounce bounds
  the loss to the last interaction, and visibility-hidden usually fires first.
- **Candidate thumbnails bypass all of the above.** `photos/thumbs/{id}.jpg` is
  written by `utils/candidateThumbs.ts` through
  `StorageInterface.savePhotoThumb` — not through `writeJSON`, so it is not in
  the serial queue and never blocks a session write. It is deliberately
  fire-and-forget: a failed write only costs one regeneration next session, and
  the cache entry is flagged unpersisted so the next resolve retries. Thumb
  bytes are derived data — nothing in `session.json` references them — and they
  are deleted with the photo by `deletePhotosByIds`.

---

## Tests that pin this

- `src/__tests__/serialQueue.test.ts` — the ordering primitive.
- `src/__tests__/competitionServiceWriteQueue.test.ts` — coalescing, index
  throttle, flush isolation, delete tombstone, write ordering.
- `src/__tests__/useCompetitionSystem.persistence.test.tsx` — conditional
  rollback, `samePhotoIds` gating, `flushPersistence`.
- `src/__tests__/useDebouncedCommit.test.tsx`,
  `src/__tests__/PhotoEditorModalBody.test.tsx`,
  `src/__tests__/PhotoControls.test.tsx` — the preview/commit split.
