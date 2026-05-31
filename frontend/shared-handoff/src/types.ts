// Wire-format type definitions. Anything not declared here SHOULD NOT
// appear in either handoff JSON file — if it does, the reader's guard
// will drop the offending entry.
//
// Keep these types narrow and forward-compatible:
//   - "Optional" fields use `?:` rather than `T | null` so the JSON
//     stays clean (no explicit nulls).
//   - `label` is intentionally typed as `string`, NOT as the project's
//     PhotoLabel union, so a future addition to the label set doesn't
//     break readers running on an older bundle.
//   - `flag` is a closed `WireFlag` union — the cross-app vocabulary
//     must agree, so a typo in one app must compile-fail in the other.

/**
 * Closed enum of valid flag values on the wire.
 *
 * Bare `pick` is RETAINED for backward compatibility with `map-picks.json`
 * files written before the pick/track split — a v1 file's `flag: 'pick'`
 * must still validate. New writes emit the categorized `pick-track` /
 * `pick-turning`; the reader normalizes a legacy bare `pick` to `pick-track`.
 */
export type WireFlag = 'pick' | 'pick-track' | 'pick-turning' | 'neutral' | 'reject';

/**
 * One row in `map-picks.json` — photo-map-culling's outgoing handoff
 * from map-corridors. The `photoId` is `pm-` prefixed by construction
 * (see PM_PHOTO_ID_PREFIX); the reader on the photo-helper side filters
 * by this prefix and never touches photo-helper-owned candidates.
 */
export interface MapPickEntry {
  photoId: string;
  filename: string;
  /**
   * 'neutral' is materialized at write time (PhotoMarker stores flag
   * only for 'pick'/'reject'; absent flag means neutral). The reader
   * gets an explicit value — simpler than branching on absence.
   */
  flag: WireFlag;
  gps?: {
    capturedAt?: {
      lng: number;
      lat: number;
      altitude?: number;
      timestamp?: string;
    };
    subjectAt?: { lng: number; lat: number };
  };
  /** Empty/absent ≠ explicit clear here — see EditorPickEntry for the clear semantics. */
  label?: string;
  /** ISO 8601 — when label was last set in map-corridors. Drives bidirectional sync resolution. */
  labelUpdatedAt?: string;
  /**
   * Target print sheet within the photo's discipline, when the user has
   * designated a "set break" turning point in map-corridors. `set1` = photo
   * is before-or-at the break in route order; `set2` = after it. The editor
   * routes the photo into that sheet (overflow → candidate tray) instead of
   * its default `set1 → set2 → tray` capacity fill. Absent = no break chosen
   * (or the photo is precision/single-set) → editor uses the default fill.
   * One-way (map → editor); the reverse channel never carries it. See
   * docs/photo-map-culling/set-split-suggestion-plan.md.
   */
  set?: 'set1' | 'set2';
}

export interface MapPicksFile {
  version: 1;
  updatedAt: string;
  picks: MapPickEntry[];
}

/**
 * One row in `photo-helper-picks.json` — photo-helper's incoming
 * label edits, headed back to map-corridors. ONLY tracks `pm-`-prefixed
 * candidates; photo-helper-originated photos stay in the editor.
 *
 * The empty-string label has explicit meaning here: "user cleared the
 * label" — distinct from map-corridors' absent-means-no-info idiom on
 * MapPickEntry. The asymmetry exists because editor-side never emits a
 * row at all unless `labelUpdatedAt` is set, so absence is unambiguous;
 * map-corridors-side can emit a row purely for flag/gps and may legitimately
 * have no label history.
 */
export interface EditorPickEntry {
  photoId: string;
  /** Empty string = explicit clear. */
  label: string;
  /** ISO 8601 — required; readers drop entries without it. */
  labelUpdatedAt: string;
}

export interface EditorPicksFile {
  version: 1;
  updatedAt: string;
  picks: EditorPickEntry[];
}
