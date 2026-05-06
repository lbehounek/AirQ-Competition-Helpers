/**
 * Shared discipline + photo-labeling rules
 *
 * Single source of truth for:
 *  - The `Discipline` type (`'precision' | 'rally'`)
 *  - URL `?discipline=` parsing (strict allowlist; logs invalid values)
 *  - The discipline → labeling-mode rule (precision → numbers, else letters)
 *  - The 20-element photo-label sets (letters A..T, numbers 1..20)
 *
 * Consumed by `@airq/photo-helper` and `@airq/map-corridors`. Both apps
 * previously implemented these rules separately; this package collapses
 * the duplication so a future change to e.g. precision labeling cannot
 * land in one app and not the other.
 */

// ---------------------------------------------------------------------------
// Discipline type + allowlist
// ---------------------------------------------------------------------------

export type Discipline = 'precision' | 'rally';

export const DISCIPLINES = ['precision', 'rally'] as const;

const DISCIPLINE_SET: ReadonlySet<string> = new Set<string>(DISCIPLINES);

function isDiscipline(value: unknown): value is Discipline {
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

export const ALL_PHOTO_LABELS = [
  ...PHOTO_LABELS_LETTERS,
  ...PHOTO_LABELS_NUMBERS,
] as const;

export type PhotoLabelLetter = (typeof PHOTO_LABELS_LETTERS)[number];
export type PhotoLabelNumber = (typeof PHOTO_LABELS_NUMBERS)[number];
export type PhotoLabel = (typeof ALL_PHOTO_LABELS)[number];

// ---------------------------------------------------------------------------
// Discipline → labeling rule
// ---------------------------------------------------------------------------

export type LabelingMode = 'letters' | 'numbers';

/**
 * The single rule. Precision flying competition rules require photos to
 * be labelled with NUMBERS (1, 2, 3...) — letters are not permitted.
 * Rally has no such constraint and keeps the historical letter default.
 */
export function getLabelingMode(discipline: Discipline): LabelingMode {
  return discipline === 'precision' ? 'numbers' : 'letters';
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

/**
 * Generates the label for a zero-based photo index, given the active
 * discipline. Used by photo-helper to render labels at draw time
 * (no per-photo persistence — the label is a function of position only).
 *
 * Indexes outside [0, 19] are wrapped/clamped depending on mode:
 *  - numbers: returns `${index + 1}` for any index (no upper bound — the
 *    UI caps at 20 elsewhere; we don't second-guess it here)
 *  - letters: `String.fromCharCode(65 + index)` for `index < 26`,
 *    otherwise undefined behaviour (as before — UI caps it).
 */
export function generateLabel(discipline: Discipline, index: number): string {
  if (getLabelingMode(discipline) === 'numbers') {
    return String(index + 1);
  }
  return String.fromCharCode(65 + index);
}
