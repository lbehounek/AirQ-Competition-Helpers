/**
 * Shared parser for the in-app drag payload exchanged between `PhotoGridApi`
 * and `CandidateTray`. Centralised so the strict literal-union check on
 * `setKey` (defense against `__proto__`-style prototype pollution via JSON
 * keys) lives in ONE place rather than being duplicated across both
 * components — see PR #62 review G3.
 *
 * Wire format (MIME `application/x-airq-photo`):
 *   { kind: 'slot', setKey: 'set1' | 'set2', index: number, photoId: string }
 *   { kind: 'tray', photoId: string }
 *
 * `null` return signals "not a recognised payload": malformed JSON, missing
 * fields, wrong types, or `setKey` not in the literal union. Callers MUST
 * fall through to their default (text/plain reorder, or no-op) on null.
 */

export type DragPayload =
  | { kind: 'slot'; setKey: 'set1' | 'set2'; photoId: string; index: number }
  | { kind: 'tray'; photoId: string };

const SET_KEY_UNION: ReadonlyArray<'set1' | 'set2'> = ['set1', 'set2'];

export function parseDragPayload(raw: string | null | undefined): DragPayload | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Logged so a misbehaving drag source is debuggable in devtools without
    // needing to source-patch (PR #62 review I5). Return null so callers
    // fall through to their non-internal-payload path.
    console.warn('parseDragPayload: malformed drag payload', raw, err);
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as { kind?: unknown; setKey?: unknown; photoId?: unknown; index?: unknown };

  if (p.kind === 'tray' && typeof p.photoId === 'string') {
    return { kind: 'tray', photoId: p.photoId };
  }

  // Strict literal-union check: must be exactly 'set1' or 'set2', NOT any
  // arbitrary string. Without this guard, a payload with `setKey: '__proto__'`
  // would later be used as an index into `session.sets[setKey]`, polluting
  // or crashing downstream code (PR #62 review I5).
  if (
    p.kind === 'slot' &&
    typeof p.photoId === 'string' &&
    typeof p.index === 'number' &&
    SET_KEY_UNION.includes(p.setKey as 'set1' | 'set2')
  ) {
    return {
      kind: 'slot',
      setKey: p.setKey as 'set1' | 'set2',
      photoId: p.photoId,
      index: p.index,
    };
  }

  return null;
}

/**
 * Serialise a drag payload for `dataTransfer.setData`. Counterpart to
 * `parseDragPayload`; centralising both directions guarantees round-trip
 * compatibility under refactoring.
 */
export function serializeDragPayload(payload: DragPayload): string {
  return JSON.stringify(payload);
}

export const DRAG_PAYLOAD_MIME = 'application/x-airq-photo';
