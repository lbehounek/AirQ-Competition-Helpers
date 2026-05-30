// Single source of truth for the cross-app photo-map-culling handoff
// wire format. Both map-corridors and photo-helper import these types
// AND the runtime guards from here, eliminating the four-way drift the
// review of PR #64 flagged.
//
// File layout on disk (OPFS, per competition):
//   competitions/{compId}/map-picks.json          ← written by map-corridors
//   competitions/{compId}/photo-helper-picks.json ← written by photo-helper
//
// See:
//   ADR-005 — one-way map-picks.json
//   ADR-017 — flag lives in map-picks.json only
//   ADR-019 — upsert + delete semantics on read
//   docs/photo-map-culling/label-sync-plan.md — bidirectional label rules

export type {
  MapPickEntry,
  MapPicksFile,
  EditorPickEntry,
  EditorPicksFile,
  WireFlag,
} from './types';
export {
  MAP_PICKS_FILENAME,
  EDITOR_PICKS_FILENAME,
  PM_PHOTO_ID_PREFIX,
  isWireFlag,
  isPickFlag,
  isMapPickEntry,
  isMapPicksFile,
  isEditorPickEntry,
  isEditorPicksFile,
} from './guards';
