// Runtime guards for the handoff JSON files. Used by both readers to
// reject malformed entries WITHOUT failing the whole sync — a single
// bad row drops out, the rest still apply. Prototype-pollution payloads
// (__proto__, constructor.prototype) parse as own data properties via
// JSON.parse and never reach prototypes, so we don't need to scrub
// keys; we just refuse rows whose declared fields don't pass.

import type {
  EditorPickEntry,
  EditorPicksFile,
  MapPickEntry,
  MapPicksFile,
  WireFlag,
} from './types';

/** Canonical filenames; pin once so a typo on one side fails at compile time. */
export const MAP_PICKS_FILENAME = 'map-picks.json' as const;
export const EDITOR_PICKS_FILENAME = 'photo-helper-picks.json' as const;

/** Prefix that marks a photo as map-originated. Readers gate inclusion on this. */
export const PM_PHOTO_ID_PREFIX = 'pm-' as const;

// Bare `pick` kept for back-compat with legacy map-picks.json (pre-split).
const WIRE_FLAGS: ReadonlySet<string> = new Set(['pick', 'pick-track', 'pick-turning', 'neutral', 'reject']);

export function isWireFlag(x: unknown): x is WireFlag {
  return typeof x === 'string' && WIRE_FLAGS.has(x);
}

// The three values that all mean "this photo is a pick". Single source of
// truth so the pick/track split (A3, 2026-05-30) doesn't leave stale
// `flag === 'pick'` comparisons scattered across both apps. Includes the
// legacy bare `pick` so a candidate that hasn't been normalized yet still
// reads as a pick. Accepts `unknown` (and undefined) so callers can pass a
// possibly-absent marker/candidate flag without a pre-check.
const PICK_FLAGS: ReadonlySet<string> = new Set(['pick', 'pick-track', 'pick-turning']);

/** True for any pick category — bare `pick` (legacy), `pick-track`, or `pick-turning`. */
export function isPickFlag(x: unknown): boolean {
  return typeof x === 'string' && PICK_FLAGS.has(x);
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isOptionalString(x: unknown): x is string | undefined {
  return x === undefined || typeof x === 'string';
}

// `labelUpdatedAt` may be absent (no label history) but if present must
// be a non-empty string — empty timestamp is meaningless and would
// confuse the lexicographic newer-wins comparison. Mirrors the editor
// side, where the field is required-and-non-empty.
function isOptionalNonEmptyString(x: unknown): x is string | undefined {
  return x === undefined || (typeof x === 'string' && x.length > 0);
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isLngLat(x: unknown): x is { lng: number; lat: number } {
  if (!isObject(x)) return false;
  return isFiniteNumber(x.lng) && isFiniteNumber(x.lat);
}

function isCapturedAt(x: unknown): boolean {
  if (!isObject(x)) return false;
  if (!isFiniteNumber(x.lng)) return false;
  if (!isFiniteNumber(x.lat)) return false;
  if (x.altitude !== undefined && !isFiniteNumber(x.altitude)) return false;
  if (x.timestamp !== undefined && typeof x.timestamp !== 'string') return false;
  return true;
}

function isGps(x: unknown): boolean {
  if (!isObject(x)) return false;
  if (x.capturedAt !== undefined && !isCapturedAt(x.capturedAt)) return false;
  if (x.subjectAt !== undefined && !isLngLat(x.subjectAt)) return false;
  return true;
}

export function isMapPickEntry(x: unknown): x is MapPickEntry {
  if (!isObject(x)) return false;
  if (typeof x.photoId !== 'string' || x.photoId.length === 0) return false;
  if (typeof x.filename !== 'string') return false;
  if (!isWireFlag(x.flag)) return false;
  if (x.gps !== undefined && !isGps(x.gps)) return false;
  if (!isOptionalString(x.label)) return false;
  if (!isOptionalNonEmptyString(x.labelUpdatedAt)) return false;
  return true;
}

export function isMapPicksFile(x: unknown): x is MapPicksFile {
  if (!isObject(x)) return false;
  if (x.version !== 1) return false;
  if (typeof x.updatedAt !== 'string') return false;
  if (!Array.isArray(x.picks)) return false;
  // We DON'T require every entry to be valid — readers drop bad rows
  // individually so one corrupt entry doesn't sink the whole file. The
  // shape guard only checks the file envelope.
  return true;
}

export function isEditorPickEntry(x: unknown): x is EditorPickEntry {
  if (!isObject(x)) return false;
  if (typeof x.photoId !== 'string' || x.photoId.length === 0) return false;
  if (typeof x.label !== 'string') return false;
  if (typeof x.labelUpdatedAt !== 'string' || x.labelUpdatedAt.length === 0) return false;
  return true;
}

export function isEditorPicksFile(x: unknown): x is EditorPicksFile {
  if (!isObject(x)) return false;
  if (x.version !== 1) return false;
  if (typeof x.updatedAt !== 'string') return false;
  if (!Array.isArray(x.picks)) return false;
  return true;
}
