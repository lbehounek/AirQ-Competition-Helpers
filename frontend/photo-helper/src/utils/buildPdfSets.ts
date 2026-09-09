import { generateTurningPointLabels } from './imageProcessing';
import type { ApiPhoto, ApiPhotoSet } from '../types/api';

export type PdfSetsInput = {
  mode: 'turningpoint' | 'track';
  layoutMode: 'landscape' | 'portrait';
  isPrecision: boolean;
  set1: ApiPhotoSet;
  set2: ApiPhotoSet;
  /** Track-mode label generator (letters/digits with dot). */
  generateLabel: (index: number, offset?: number) => string;
};

export type LabeledPhoto = ApiPhoto & { label: string };
export type LabeledSet = ApiPhotoSet & { photos: LabeledPhoto[] };

export type PdfSetsOutput = {
  set1WithLabels: LabeledSet;
  set2WithLabels: LabeledSet;
};

/**
 * Track-mode label for one photo: the route-ordered label handed over from
 * map-corridors when the photo carries one, otherwise the positional
 * `generateLabel(index, offset)`. Returns the printed string.
 *
 * WHY the handed-over label wins:
 *   `ApiPhoto.label` on a `pm-` photo is the letter/number the user assigned
 *   to that photo IN map-corridors (see useMapPicksSync — `entry.label` →
 *   `photo.label`, preserved through `routeImportedPickIntoSets` into the
 *   slot). That same label is what map-corridors prints in the ANSWER SHEET
 *   (App.tsx `labelToMarker` — one row per label, with distance + from-TP).
 *   The positional label knows only where the card sits in the print grid, so
 *   overwriting the handed-over one silently desynchronises the printed
 *   en-route sheet from the answer sheet: the judge's key says "C is 1.2 NM
 *   from TP3" while the competitor's sheet has a different photo under C.
 *   Nothing in the app warns about it — the two artefacts are exported
 *   separately, from two apps, and each looks internally consistent.
 *
 * WHY the positional label is still the FALLBACK and not dead code: most
 *   photos have no handed-over label at all — anything imported directly into
 *   photo-helper is created with `label: ''`, and so is a "no photo"
 *   placeholder (see createPlaceholderPhoto, which relies on the by-index
 *   labeling to show its slot letter). Legacy persisted photos may lack the
 *   key entirely, hence the `?.`/`??`.
 *
 * The presence test trims because the wire type is a bare `string`
 * (shared-handoff/types.ts keeps it un-narrowed on purpose, so a future label
 * set doesn't break older readers) — a whitespace-only value is not a label
 * and must not print as a blank cell where a positional letter belongs.
 *
 * The fallback stays PURELY positional: a labelled photo does not consume or
 * shift the fallback sequence for its unlabelled neighbours. Mixing the two
 * sources in one set can therefore collide (photo 0 falls back to `A` while
 * photo 3 carries a handed-over `A`); resolving that would mean inventing an
 * allocation policy, and in the real workflow a set comes from one source.
 */
function trackLabelFor(
  photo: ApiPhoto,
  index: number,
  /** Undefined for set1 — forwarded verbatim so the generator sees the same
   *  argument list it always did (set1: no offset, set2: set1's photo count). */
  offset: number | undefined,
  generateLabel: PdfSetsInput['generateLabel'],
): string {
  const handedOver = photo.label?.trim() ?? '';
  // `||` short-circuits: `generateLabel` is never called for a labelled photo.
  // That also keeps a labelled photo out of `generateLabelForMode`'s
  // `RangeError` when a set runs past the 20-entry label alphabet.
  return handedOver || generateLabel(index, offset);
}

/**
 * Build the labeled `{set1WithLabels, set2WithLabels}` pair that
 * `generatePDF` consumes.
 *
 * Precision mode drops set2 from the output (and from turningpoint
 * label generation) so a stale set2 — e.g. user switched discipline
 * mid-session — does not leak into the printed PDF. This is the core
 * competition-artefact correctness guarantee from feedback 2026-04-18.
 *
 * Track mode prefers the route-ordered label handed over from map-corridors
 * (`ApiPhoto.label`) and falls back to the positional `generateLabel` — see
 * `trackLabelFor` for why. Turning-point mode is always positional.
 *
 * Pure function, no React / session hook dependencies — tests can
 * drive the full behavior matrix directly.
 */
export function buildPdfSets(input: PdfSetsInput): PdfSetsOutput {
  const { mode, layoutMode, isPrecision, set1, set2, generateLabel } = input;

  if (mode === 'turningpoint') {
    // Turning-point labels stay PURELY positional, deliberately — this is the
    // one place where overwriting a handed-over label is correct. SP / TP1..TPn
    // / FP is a structural sequence over the whole sheet pair (the first cell IS
    // the start point, the last IS the finish point — see
    // generateTurningPointLabels), not a per-photo name. A `pick-turning` photo
    // may still carry a letter from map-corridors' label picker, but that letter
    // belongs to the EN-ROUTE answer sheet (App.tsx `labelToMarker`, keyed on
    // A..T / 1..20); letting it through here would punch an "F" into the middle
    // of an SP/TP/FP navigation sheet and break the numbering either side of it.
    const set1Count = set1.photos.length;
    const set2Count = isPrecision ? 0 : set2.photos.length;
    const turningPointLabels = generateTurningPointLabels(set1Count, set2Count, layoutMode);

    const set1WithLabels: LabeledSet = {
      ...set1,
      photos: set1.photos.map((photo, index) => ({
        ...photo,
        label: turningPointLabels.set1[index] || 'X',
      })),
    };

    const set2WithLabels: LabeledSet = isPrecision
      ? { ...set2, photos: [] }
      : {
          ...set2,
          photos: set2.photos.map((photo, index) => ({
            ...photo,
            label: turningPointLabels.set2[index] || 'X',
          })),
        };

    return { set1WithLabels, set2WithLabels };
  }

  // Track mode — letter/digit labels continue across sets in rally,
  // and set2 is dropped for precision. A photo that arrived from
  // map-corridors keeps ITS label (see `trackLabelFor`); the positional
  // sequence is the fallback for everything else.
  const set1WithLabels: LabeledSet = {
    ...set1,
    photos: set1.photos.map((photo, index) => ({
      ...photo,
      label: trackLabelFor(photo, index, undefined, generateLabel),
    })),
  };

  const set1Count = set1.photos.length;
  const set2WithLabels: LabeledSet = isPrecision
    ? { ...set2, photos: [] }
    : {
        ...set2,
        photos: set2.photos.map((photo, index) => ({
          ...photo,
          label: trackLabelFor(photo, index, set1Count, generateLabel),
        })),
      };

  return { set1WithLabels, set2WithLabels };
}
