import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseDragPayload,
  serializeDragPayload,
  DRAG_PAYLOAD_MIME,
} from '../utils/dragPayload';

// PR #62 review G3: the wire-format parser is the critical security
// boundary for in-app drag-and-drop. The strict literal-union check on
// `setKey` defends against `__proto__`-style prototype pollution where a
// crafted payload would otherwise be used to index `session.sets[setKey]`
// or `[modeKey]` — turning a drop into arbitrary object access. The check
// used to live inline in both `PhotoGridApi.tsx` and `CandidateTray.tsx`;
// this test pins it now that it's a shared helper.

describe('parseDragPayload', () => {
  it('returns null on null / undefined / empty input', () => {
    expect(parseDragPayload(null)).toBeNull();
    expect(parseDragPayload(undefined)).toBeNull();
    expect(parseDragPayload('')).toBeNull();
  });

  it('returns null on malformed JSON (and logs a warning)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseDragPayload('{not json')).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('malformed');
    warnSpy.mockRestore();
  });

  it('returns null on JSON primitives (string, number, boolean, null)', () => {
    expect(parseDragPayload('"a string"')).toBeNull();
    expect(parseDragPayload('42')).toBeNull();
    expect(parseDragPayload('true')).toBeNull();
    expect(parseDragPayload('null')).toBeNull();
  });

  it('parses a valid tray payload', () => {
    const raw = JSON.stringify({ kind: 'tray', photoId: 'photo-1' });
    expect(parseDragPayload(raw)).toEqual({ kind: 'tray', photoId: 'photo-1' });
  });

  it('rejects tray payload with non-string photoId', () => {
    expect(parseDragPayload(JSON.stringify({ kind: 'tray', photoId: 123 }))).toBeNull();
    expect(parseDragPayload(JSON.stringify({ kind: 'tray', photoId: null }))).toBeNull();
    expect(parseDragPayload(JSON.stringify({ kind: 'tray' }))).toBeNull();
  });

  it('parses a valid slot payload', () => {
    const raw = JSON.stringify({ kind: 'slot', setKey: 'set1', index: 3, photoId: 'photo-X' });
    expect(parseDragPayload(raw)).toEqual({
      kind: 'slot',
      setKey: 'set1',
      index: 3,
      photoId: 'photo-X',
    });
  });

  it('parses slot payload with setKey: set2', () => {
    const raw = JSON.stringify({ kind: 'slot', setKey: 'set2', index: 0, photoId: 'p' });
    expect(parseDragPayload(raw)).toEqual({
      kind: 'slot',
      setKey: 'set2',
      index: 0,
      photoId: 'p',
    });
  });

  // The critical security check: setKey is a literal union, and ANY other
  // value (including string-typed `__proto__`, `constructor`, etc.) is
  // rejected at the parser layer — downstream code never sees the foreign
  // value. Failing any of these tests would re-enable prototype pollution.
  it('rejects __proto__ as setKey (prototype pollution defense)', () => {
    const raw = JSON.stringify({ kind: 'slot', setKey: '__proto__', index: 0, photoId: 'p' });
    expect(parseDragPayload(raw)).toBeNull();
  });

  it('rejects constructor as setKey', () => {
    const raw = JSON.stringify({ kind: 'slot', setKey: 'constructor', index: 0, photoId: 'p' });
    expect(parseDragPayload(raw)).toBeNull();
  });

  it('rejects arbitrary string setKey', () => {
    const raw = JSON.stringify({ kind: 'slot', setKey: 'set3', index: 0, photoId: 'p' });
    expect(parseDragPayload(raw)).toBeNull();
  });

  it('rejects empty-string setKey', () => {
    const raw = JSON.stringify({ kind: 'slot', setKey: '', index: 0, photoId: 'p' });
    expect(parseDragPayload(raw)).toBeNull();
  });

  it('rejects slot payload with non-number index', () => {
    const raw = JSON.stringify({ kind: 'slot', setKey: 'set1', index: '3', photoId: 'p' });
    expect(parseDragPayload(raw)).toBeNull();
  });

  it('rejects slot payload missing photoId', () => {
    const raw = JSON.stringify({ kind: 'slot', setKey: 'set1', index: 0 });
    expect(parseDragPayload(raw)).toBeNull();
  });

  it('rejects unrecognised kind', () => {
    const raw = JSON.stringify({ kind: 'mystery', photoId: 'p' });
    expect(parseDragPayload(raw)).toBeNull();
  });

  it('rejects missing kind', () => {
    const raw = JSON.stringify({ photoId: 'p' });
    expect(parseDragPayload(raw)).toBeNull();
  });

  it('ignores extra fields without rejecting', () => {
    const raw = JSON.stringify({
      kind: 'tray',
      photoId: 'p',
      extra: { malicious: true },
      injected: '__proto__',
    });
    expect(parseDragPayload(raw)).toEqual({ kind: 'tray', photoId: 'p' });
  });
});

describe('serializeDragPayload + parseDragPayload round-trip', () => {
  it('round-trips a tray payload', () => {
    const original = { kind: 'tray' as const, photoId: 'photo-42' };
    expect(parseDragPayload(serializeDragPayload(original))).toEqual(original);
  });

  it('round-trips a slot payload', () => {
    const original = { kind: 'slot' as const, setKey: 'set1' as const, index: 5, photoId: 'photo-A' };
    expect(parseDragPayload(serializeDragPayload(original))).toEqual(original);
  });
});

// PR #62 review I5: the original parser accepted any `typeof p.index === 'number'`
// (so NaN, Infinity, negative, float, 1e20 all passed) and any string photoId
// (including empty string). Downstream code in candidateTransitions clamps,
// but defense-in-depth at the parser is cheap and removes a whole class of
// "hostile or buggy producer" failure modes.
describe('parseDragPayload — index/photoId bounds-checks (PR #62 review I5)', () => {
  const slot = (overrides: Record<string, unknown>) =>
    JSON.stringify({ kind: 'slot', setKey: 'set1', index: 0, photoId: 'p', ...overrides });

  it('rejects slot payload with NaN index', () => {
    // JSON serialises NaN to null, so we go around JSON.stringify here.
    const raw = '{"kind":"slot","setKey":"set1","index":NaN,"photoId":"p"}';
    expect(parseDragPayload(raw)).toBeNull();
  });

  it('rejects slot payload with Infinity index', () => {
    const raw = '{"kind":"slot","setKey":"set1","index":Infinity,"photoId":"p"}';
    expect(parseDragPayload(raw)).toBeNull();
  });

  it('rejects slot payload with negative index', () => {
    expect(parseDragPayload(slot({ index: -1 }))).toBeNull();
    expect(parseDragPayload(slot({ index: -999 }))).toBeNull();
  });

  it('rejects slot payload with float index', () => {
    expect(parseDragPayload(slot({ index: 1.5 }))).toBeNull();
    expect(parseDragPayload(slot({ index: 0.1 }))).toBeNull();
  });

  it('rejects slot payload with absurdly large index', () => {
    expect(parseDragPayload(slot({ index: 1000 }))).toBeNull();
    expect(parseDragPayload(slot({ index: 1e20 }))).toBeNull();
  });

  it('accepts boundary index values (0 and a realistic max)', () => {
    expect(parseDragPayload(slot({ index: 0 }))).not.toBeNull();
    expect(parseDragPayload(slot({ index: 999 }))).not.toBeNull();
    expect(parseDragPayload(slot({ index: 9 }))).not.toBeNull(); // typical grid slot
  });

  it('rejects slot payload with empty-string photoId', () => {
    expect(parseDragPayload(slot({ photoId: '' }))).toBeNull();
  });

  it('rejects tray payload with empty-string photoId', () => {
    expect(parseDragPayload(JSON.stringify({ kind: 'tray', photoId: '' }))).toBeNull();
  });

  it('accepts tray payload with non-empty photoId', () => {
    expect(parseDragPayload(JSON.stringify({ kind: 'tray', photoId: 'x' }))).toEqual({
      kind: 'tray',
      photoId: 'x',
    });
  });
});

describe('DRAG_PAYLOAD_MIME', () => {
  it('is the documented in-app MIME type and is stable across releases', () => {
    // Pinning the literal: changing this MIME breaks the drag contract
    // between PhotoGridApi and CandidateTray. If you need to bump it,
    // update both components AND remember the in-flight session
    // compatibility (a previously serialised payload doesn't auto-migrate).
    expect(DRAG_PAYLOAD_MIME).toBe('application/x-airq-photo');
  });
});

beforeEach(() => {
  // Quiet expected console.warn from the malformed-JSON path; tests that
  // explicitly assert the warning re-enable it locally.
});
afterEach(() => {
  vi.restoreAllMocks();
});
