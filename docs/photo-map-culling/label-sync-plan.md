# Label sync plan — bidirectional map ↔ editor

Implementation plan for synchronizing photo labels (A–T / 1–20) between
map-corridors and photo-helper. Approved batch: all five phases land
in one PR on `feat/photo-map-culling`.

## Why

User requirement: "the letter/number can be assigned also in the photo
editor app." Currently labels flow neither direction reliably — even
the one-way map → editor path is broken (`useMapPicksSync` ignores
`entry.label` on insert, never propagates label changes on update).

## Architecture — two mirror files, per-photo `labelUpdatedAt`

```
map-corridors  ──writes──►  competitions/{compId}/map-picks.json
                  ◄─reads───
                            competitions/{compId}/photo-helper-picks.json
                  ──reads─►
photo-helper   ──writes──┘
```

Each file has exactly one writer; both apps read both files.
Conflict resolution: `labelUpdatedAt` per photo, newer wins. Equal
timestamps → local wins (deterministic tie-break; rare in practice).

## Schema changes

```ts
// Added to PhotoMarker (map-corridors)
type PhotoMarker = Readonly<{
  // …existing…
  label?: PhotoLabel
  labelUpdatedAt?: string   // NEW — ISO 8601
}>

// Added to ApiPhoto (photo-helper)
interface ApiPhoto {
  // …existing…
  label: string
  labelUpdatedAt?: string   // NEW — ISO 8601
}

// Added to MapPickEntry (map-picks.json)
type MapPickEntry = {
  // …existing…
  label?: string
  labelUpdatedAt?: string   // NEW
}

// NEW file format
type EditorPicksFile = {
  version: 1
  updatedAt: string
  picks: Array<{
    photoId: string         // pm-prefix; editor-only photos excluded
    label: string           // '' means explicitly cleared
    labelUpdatedAt: string
  }>
}
```

## Phases

### Phase A — Fix one-way (map → editor) label sync
- `useCompetitionSystem`: new `setCandidateLabel(photoId, label)` mutator,
  stamps `labelUpdatedAt = now()`.
- `useMapPicksSync` insert path: use `entry.label`, not `''`.
- `useMapPicksSync` update path: compare both label and flag (newer-wins
  on label, simple-diff on flag).
- Tests in `useMapPicksSync.test.ts`.

### Phase B — Editor writer `photo-helper-picks.json`
- New `frontend/photo-helper/src/handoff/editorPicksWriter.ts`. Mirror
  of `mapPicksWriter.ts`: 300 ms debounce, serialized writes,
  `flushPendingEditorPicks()`.
- `AppApi.tsx`: useEffect on `session.candidates` + slot photos →
  schedule write. Pagehide flushes best-effort.
- Tests with fake timers.

### Phase C — Map reader for `photo-helper-picks.json`
- New `frontend/map-corridors/src/hooks/useEditorPicksSync.ts`. Mirror
  of `useMapPicksSync.ts`: runs on competition load + visibilitychange.
- Applies `entry.label` to local `marker.label` only when
  `entry.labelUpdatedAt > marker.labelUpdatedAt` (newer wins).
- Never inserts markers (the editor file isn't a source of new photos).
- Tests for newer-wins, older-loses, missing-file, equal-timestamp
  (local wins).

### Phase D — Collision prevention via cross-app `usedLabels`
- Map-corridors: `usedLabels` becomes (local marker labels) ∪
  (labels from the last-read `photo-helper-picks.json`).
- Photo-helper: existing label-claim logic gains union with
  `map-picks.json` labels.
- Picker UI disables collisions in both apps.

### Phase E — Docs
- Update `docs/photo-map-culling/guide.md`:
  - Strike out "two-way label sync" from Deferred work.
  - "Cross-app handoff" diagram shows both files.
  - "Data schemas" includes `labelUpdatedAt`.
- ADR-022 in `decisions.md`: "Bidirectional label sync via two mirror
  files with per-photo `labelUpdatedAt`."

## Edge cases (verified by tests)

| Case | Behaviour |
|---|---|
| Missing `photo-helper-picks.json` | No-op, no error. |
| User labels in map then editor within 300 ms | Last writer wins; rare in single-user flow. |
| Map sets "A" on photo X; editor unaware; editor user picks "A" for Y | Editor's `usedLabels` union from `map-picks.json` disables "A". |
| Tie-break on equal `labelUpdatedAt` | Local always wins — protects in-flight edits. |
| User clears label | Empty string + new timestamp. Other side sees newer; clears. |
| Editor deletes a `pm-` candidate | Map keeps marker + label. Editor file omits the photo; map ignores absence. |

## Effort

~2 days total, all in `feat/photo-map-culling`.
