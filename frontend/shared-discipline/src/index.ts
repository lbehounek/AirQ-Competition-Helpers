/**
 * Shared discipline + photo-labeling rules
 *
 * Single source of truth for:
 *  - The `Discipline` type (`'precision' | 'rally'`)
 *  - URL `?discipline=` parsing (strict allowlist; logs invalid values)
 *  - The discipline → labeling-mode rule (precision → numbers, else letters)
 *  - The 20-element photo-label sets (letters A..T, numbers 1..20)
 *  - Label generation by index (bounds-checked, returns `PhotoLabel`)
 *
 * Consumed by `@airq/photo-helper` and `@airq/map-corridors`. Both apps
 * previously implemented these rules separately; this package collapses
 * the duplication so a future change to e.g. precision labeling cannot
 * land in one app and not the other.
 */

// ---------------------------------------------------------------------------
// Discipline type + allowlist
// ---------------------------------------------------------------------------

// `DISCIPLINES` is the single source of truth; the type is derived from it
// so adding a new discipline is a one-line change that the compiler then
// forces through every `switch (discipline)` site (see `getLabelingMode`).
export const DISCIPLINES = ['precision', 'rally'] as const;

export type Discipline = (typeof DISCIPLINES)[number];

const DISCIPLINE_SET: ReadonlySet<string> = new Set<string>(DISCIPLINES);

/**
 * Type guard for `unknown -> Discipline`. Exported so consumers
 * rehydrating persisted state (storage, KML imports) can validate
 * without reinventing the allowlist.
 */
export function isDiscipline(value: unknown): value is Discipline {
  return typeof value === 'string' && DISCIPLINE_SET.has(value);
}

// ---------------------------------------------------------------------------
// URL parser
// ---------------------------------------------------------------------------

/**
 * Parse the `?discipline=` URL parameter emitted by the desktop launcher
 * (see `frontend/desktop/main.js`). Strict allowlist: only exact
 * `'precision'` or `'rally'` accepted.
 *
 * Returns `null` when:
 *  - the param is absent
 *  - the value is empty (semantically "unset", same as absent)
 *  - the value is non-empty but not in the allowlist (also calls
 *    `console.error` so a launcher drift like `?Discipline=Precision`
 *    surfaces during QA instead of silently downgrading precision → rally)
 *
 * Notes on input handling — `URLSearchParams` is permissive:
 *  - The leading `?` is optional (`'discipline=precision'` parses fine).
 *  - URL fragments are NOT stripped (`'?discipline=precision#foo'` parses
 *    the value as `'precision#foo'`, which then fails the allowlist).
 *    Callers should pass `window.location.search` (which excludes the
 *    hash) — relying on this parser to strip a fragment is unsafe.
 *  - Duplicate `discipline` keys: first wins (`URLSearchParams.get`
 *    semantics).
 *
 * Callers that need a default fall back themselves:
 *
 * ```ts
 * const discipline = parseDisciplineFromSearch(window.location.search) ?? 'rally';
 * ```
 *
 * The default-rally semantics live at the call site, not here, because
 * map-corridors uses `null` to mean "let the persisted session discipline
 * decide" — a default would mask that.
 */
export function parseDisciplineFromSearch(search: string): Discipline | null {
  const params = new URLSearchParams(search);
  const d = params.get('discipline');
  if (isDiscipline(d)) return d;
  if (d !== null && d !== '') {
    console.error(`[parseDiscipline] Invalid ?discipline="${d}"; falling back.`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Photo label sets
// ---------------------------------------------------------------------------

// Rally / web / legacy: photos are labelled A..T (matches photo-helper's
// `letters` mode). Precision rules require numeric labels 1..20 (matches
// photo-helper's `numbers` mode for precision discipline). Both sets are
// length 20 — the maximum number of photos in a precision track set.

export const PHOTO_LABELS_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
] as const;

export const PHOTO_LABELS_NUMBERS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
] as const;

/**
 * Disjoint union of both label sets. Required because a session created
 * under one discipline may be reopened under the other (e.g., user toggles
 * mode mid-flight in map-corridors, or imports a KML produced under the
 * other discipline). Existing labels must remain valid even when they
 * don't match the *current* discipline's preferred set; the active set is
 * filtered at the UI layer via `getLabelsForDiscipline`, not by narrowing
 * the persisted type.
 */
export const ALL_PHOTO_LABELS = [
  ...PHOTO_LABELS_LETTERS,
  ...PHOTO_LABELS_NUMBERS,
] as const;

export type PhotoLabelLetter = (typeof PHOTO_LABELS_LETTERS)[number];
export type PhotoLabelNumber = (typeof PHOTO_LABELS_NUMBERS)[number];
export type PhotoLabel = (typeof ALL_PHOTO_LABELS)[number];

/**
 * Maximum index supported by `generateLabel` / `generateLabelForMode`.
 * Both label sets are length 20 (precision track-set cap), so valid
 * indices are `[0, 19]`.
 */
export const MAX_LABEL_INDEX = 19;

// ---------------------------------------------------------------------------
// Discipline → labeling rule
// ---------------------------------------------------------------------------

export type LabelingMode = 'letters' | 'numbers';

/**
 * The single rule. Precision flying competition rules require photos to
 * be labelled with NUMBERS (1, 2, 3...) — letters are not permitted.
 * Rally has no such constraint and keeps the historical letter default.
 *
 * Exhaustive switch with `never` check: adding a new `Discipline` will
 * fail compilation here, forcing the maintainer to make an explicit
 * choice instead of silently falling through to the rally default.
 */
export function getLabelingMode(discipline: Discipline): LabelingMode {
  switch (discipline) {
    case 'precision':
      return 'numbers';
    case 'rally':
      return 'letters';
    default: {
      const _exhaustive: never = discipline;
      throw new Error(`[getLabelingMode] unhandled discipline: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Picks the appropriate label *set* for the active discipline. Used by
 * map-corridors to populate the marker label-picker and the answer sheet.
 */
export function getLabelsForDiscipline(discipline: Discipline): readonly PhotoLabel[] {
  return getLabelingMode(discipline) === 'numbers'
    ? PHOTO_LABELS_NUMBERS
    : PHOTO_LABELS_LETTERS;
}

// ---------------------------------------------------------------------------
// Label generation
// ---------------------------------------------------------------------------

function assertValidLabelIndex(index: number, fnName: string): void {
  if (!Number.isInteger(index) || index < 0 || index > MAX_LABEL_INDEX) {
    throw new RangeError(
      `[${fnName}] index must be an integer in [0, ${MAX_LABEL_INDEX}]; got ${index}`,
    );
  }
}

/**
 * Returns the label at `index` for the given labeling mode. Bounds-checked:
 * throws `RangeError` for non-integer or out-of-range indices instead of
 * producing silent garbage (`String.fromCharCode(65 + 26)` = `'['`,
 * `String(index + 1)` for index = -1 = `'0'` — both invalid as labels but
 * type-equivalent to a real label).
 *
 * Used by photo-helper's `LabelingContext` to render labels at draw time
 * — the user can flip the labeling mode independently of the URL-derived
 * discipline (e.g., a rally session can opt into numbers), so the keying
 * axis is `LabelingMode`, not `Discipline`.
 */
export function generateLabelForMode(mode: LabelingMode, index: number): PhotoLabel {
  assertValidLabelIndex(index, 'generateLabelForMode');
  return mode === 'numbers' ? PHOTO_LABELS_NUMBERS[index] : PHOTO_LABELS_LETTERS[index];
}

/**
 * Generates the label for a zero-based photo index, given the active
 * discipline. Convenience wrapper over `generateLabelForMode` for callers
 * that already have a `Discipline` (e.g., map-corridors marker rendering).
 *
 * Same bounds contract — `RangeError` for indices outside `[0, 19]`.
 */
export function generateLabel(discipline: Discipline, index: number): PhotoLabel {
  return generateLabelForMode(getLabelingMode(discipline), index);
}
