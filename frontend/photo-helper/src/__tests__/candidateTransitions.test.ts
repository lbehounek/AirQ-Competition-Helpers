import { describe, it, expect } from 'vitest';
import {
  promoteCandidateToSlot,
  demoteSlotToCandidate,
  setCandidateFlag,
  removeCandidate,
  clearAllCandidates,
  updateCandidateCanvasState,
} from '../utils/candidateTransitions';
import type { ApiPhoto, ApiPhotoSession, CandidateFlag } from '../types/api';

// Pure-helper tests — the hook layer calls these and then writes the result.
// If these are correct, slot↔tray UX correctness reduces to "does the hook
// call the right helper with the right arguments." See docs/CANDIDATE_PHOTOS.md.

function makePhoto(id: string, extras: Partial<ApiPhoto> = {}): ApiPhoto {
  return {
    id,
    sessionId: 'sess-1',
    url: `blob:${id}`,
    filename: `${id}.jpg`,
    canvasState: {
      position: { x: 0, y: 0 },
      scale: 1,
      brightness: 0,
      contrast: 1,
      sharpness: 0,
      whiteBalance: { temperature: 0, tint: 0, auto: false },
      labelPosition: 'bottom-left',
    } as any,
    label: '',
    ...extras,
  };
}

function makeSession(
  set1Photos: ApiPhoto[],
  set2Photos: ApiPhoto[],
  candidates: ApiPhoto[],
): ApiPhotoSession {
  return {
    id: 'sess-1',
    version: 1,
    createdAt: '2026-05-12T00:00:00Z',
    updatedAt: '2026-05-12T00:00:00Z',
    mode: 'track',
    competition_name: 'Test',
    sets: {
      set1: { title: 'Set 1', photos: set1Photos },
      set2: { title: 'Set 2', photos: set2Photos },
    },
    candidates: { photos: candidates },
  };
}

describe('promoteCandidateToSlot', () => {
  it('promotes candidate into empty slot, clears flag', () => {
    const cand = makePhoto('c1', { flag: 'pick' as CandidateFlag });
    const session = makeSession([], [], [cand]);
    const next = promoteCandidateToSlot(session, 'c1', 'set1', 0);

    expect(next.candidates?.photos).toHaveLength(0);
    expect(next.sets.set1.photos).toHaveLength(1);
    expect(next.sets.set1.photos[0].id).toBe('c1');
    expect(next.sets.set1.photos[0].flag).toBeUndefined();
    expect(next.version).toBe(session.version + 1);
  });

  it('appends when slot index is past the end (clamped to append)', () => {
    const cand = makePhoto('c1');
    const existing = makePhoto('s1');
    const session = makeSession([existing], [], [cand]);
    const next = promoteCandidateToSlot(session, 'c1', 'set1', 99);

    expect(next.sets.set1.photos.map(p => p.id)).toEqual(['s1', 'c1']);
    expect(next.candidates?.photos).toHaveLength(0);
  });

  it('swaps with occupied slot — old slot photo returns as pick', () => {
    const cand = makePhoto('c1', { flag: 'neutral' as CandidateFlag });
    const s1 = makePhoto('s1');
    const s2 = makePhoto('s2');
    const session = makeSession([s1, s2], [], [cand]);

    const next = promoteCandidateToSlot(session, 'c1', 'set1', 0);

    expect(next.sets.set1.photos.map(p => p.id)).toEqual(['c1', 's2']);
    expect(next.sets.set1.photos[0].flag).toBeUndefined();
    expect(next.candidates?.photos).toHaveLength(1);
    expect(next.candidates?.photos[0].id).toBe('s1');
    expect(next.candidates?.photos[0].flag).toBe('pick');
  });

  it('preserves canvasState across promotion', () => {
    const cand = makePhoto('c1');
    cand.canvasState = { ...cand.canvasState, brightness: 0.5 } as any;
    const session = makeSession([], [], [cand]);

    const next = promoteCandidateToSlot(session, 'c1', 'set1', 0);
    expect((next.sets.set1.photos[0].canvasState as any).brightness).toBe(0.5);
  });

  it('no-op when candidate id is unknown', () => {
    const session = makeSession([], [], []);
    const next = promoteCandidateToSlot(session, 'missing', 'set1', 0);
    expect(next).toBe(session);
  });

  // PR #62 review A1: pinning current behavior for negative `slotIndex` so a
  // refactor (e.g., a stricter guard) doesn't silently change behavior. The
  // hook wrapper now clamps `slotIndex` to a safe range, but the pure helper
  // historically accepted negatives — `Math.min(-1, photos.length)` yields -1
  // which `splice(-1, 0, x)` interprets as "insert before the last element".
  it('with negative slotIndex on empty set: appends at index 0', () => {
    const cand = makePhoto('c1');
    const session = makeSession([], [], [cand]);
    const next = promoteCandidateToSlot(session, 'c1', 'set1', -1);
    expect(next.sets.set1.photos.map(p => p.id)).toEqual(['c1']);
  });

  it('with negative slotIndex on populated set: inserts before last element', () => {
    const cand = makePhoto('c1');
    const session = makeSession([makePhoto('s1'), makePhoto('s2')], [], [cand]);
    // photos.length=2; slotIndex=-1; splice(min(-1,2)=-1, 0, c1) → ['s1','c1','s2']
    const next = promoteCandidateToSlot(session, 'c1', 'set1', -1);
    expect(next.sets.set1.photos.map(p => p.id)).toEqual(['s1', 'c1', 's2']);
  });

  // PR #62 review C1 + A3: when "Send to Set X" is called on a full set, the
  // AppApi handler now passes `slotIndex = capacity - 1`, which lands in the
  // swap branch. This test pins the helper-level behavior the handler relies on.
  it('with slotIndex = length - 1 on full set: SWAPS with the last photo (not append)', () => {
    const cand = makePhoto('c1', { flag: 'pick' as CandidateFlag });
    const slots = Array.from({ length: 9 }, (_, i) => makePhoto(`s${i + 1}`));
    const session = makeSession(slots, [], [cand]);

    const next = promoteCandidateToSlot(session, 'c1', 'set1', 8);

    expect(next.sets.set1.photos).toHaveLength(9);
    expect(next.sets.set1.photos[8].id).toBe('c1');
    expect(next.sets.set1.photos[8].flag).toBeUndefined();
    expect(next.candidates?.photos.map(p => p.id)).toEqual(['s9']);
    expect(next.candidates?.photos[0].flag).toBe('pick');
  });

  // Documents the original C1 bug, kept as a regression marker: with
  // slotIndex == photos.length on a full set, the helper falls into the
  // APPEND branch (NOT swap). This is why the hook wrapper / handler must
  // clamp to capacity-1 before calling.
  it('with slotIndex = length on full set: APPENDS past capacity (helper unaware of capacity)', () => {
    const cand = makePhoto('c1');
    const slots = Array.from({ length: 9 }, (_, i) => makePhoto(`s${i + 1}`));
    const session = makeSession(slots, [], [cand]);
    const next = promoteCandidateToSlot(session, 'c1', 'set1', 9);
    expect(next.sets.set1.photos).toHaveLength(10);
    expect(next.sets.set1.photos[9].id).toBe('c1');
  });
});

describe('demoteSlotToCandidate', () => {
  it('demotes slot photo with default flag = pick', () => {
    const s1 = makePhoto('s1');
    const session = makeSession([s1], [], []);
    const next = demoteSlotToCandidate(session, 'set1', 's1');

    expect(next.sets.set1.photos).toHaveLength(0);
    expect(next.candidates?.photos).toHaveLength(1);
    expect(next.candidates?.photos[0].id).toBe('s1');
    expect(next.candidates?.photos[0].flag).toBe('pick');
  });

  it('appends to existing candidates pool', () => {
    const c1 = makePhoto('c1', { flag: 'reject' as CandidateFlag });
    const s1 = makePhoto('s1');
    const session = makeSession([s1], [], [c1]);

    const next = demoteSlotToCandidate(session, 'set1', 's1');
    expect(next.candidates?.photos.map(p => p.id)).toEqual(['c1', 's1']);
    expect(next.candidates?.photos[0].flag).toBe('reject');
    expect(next.candidates?.photos[1].flag).toBe('pick');
  });

  it('no-op when slot photo id is unknown', () => {
    const session = makeSession([], [], []);
    const next = demoteSlotToCandidate(session, 'set1', 'missing');
    expect(next).toBe(session);
  });
});

describe('setCandidateFlag', () => {
  it('updates flag from pick → reject', () => {
    const c1 = makePhoto('c1', { flag: 'pick' as CandidateFlag });
    const session = makeSession([], [], [c1]);
    const next = setCandidateFlag(session, 'c1', 'reject');
    expect(next.candidates?.photos[0].flag).toBe('reject');
  });

  it('no-op when id is unknown', () => {
    const c1 = makePhoto('c1');
    const session = makeSession([], [], [c1]);
    const next = setCandidateFlag(session, 'missing', 'reject');
    expect(next).toBe(session);
  });
});

describe('removeCandidate', () => {
  it('drops the matching candidate, preserves others', () => {
    const session = makeSession([], [], [makePhoto('c1'), makePhoto('c2'), makePhoto('c3')]);
    const next = removeCandidate(session, 'c2');
    expect(next.candidates?.photos.map(p => p.id)).toEqual(['c1', 'c3']);
  });

  it('no-op when id is unknown', () => {
    const session = makeSession([], [], [makePhoto('c1')]);
    const next = removeCandidate(session, 'missing');
    expect(next).toBe(session);
  });
});

describe('clearAllCandidates', () => {
  it('empties the pool and bumps version', () => {
    const session = makeSession([], [], [makePhoto('c1'), makePhoto('c2')]);
    const next = clearAllCandidates(session);
    expect(next.candidates?.photos).toHaveLength(0);
    expect(next.version).toBe(session.version + 1);
  });

  it('no-op when pool is already empty', () => {
    const session = makeSession([], [], []);
    const next = clearAllCandidates(session);
    expect(next).toBe(session);
  });
});

describe('updateCandidateCanvasState', () => {
  it('merges canvasState partial without dropping other fields', () => {
    const c1 = makePhoto('c1');
    c1.canvasState = { ...c1.canvasState, brightness: 0.2 } as any;
    const session = makeSession([], [], [c1]);

    const next = updateCandidateCanvasState(session, 'c1', { contrast: 1.5 });

    expect((next.candidates?.photos[0].canvasState as any).brightness).toBe(0.2);
    expect((next.candidates?.photos[0].canvasState as any).contrast).toBe(1.5);
  });

  it('no-op when id is unknown', () => {
    const session = makeSession([], [], [makePhoto('c1')]);
    const next = updateCandidateCanvasState(session, 'missing', { brightness: 1 });
    expect(next).toBe(session);
  });
});

describe('flow: drop → promote → demote → flag → cleanup', () => {
  it('simulates the v1 cull workflow end-to-end', () => {
    // Start with 3 candidates, empty slots.
    let session = makeSession([], [], [
      makePhoto('a', { flag: 'neutral' as CandidateFlag }),
      makePhoto('b', { flag: 'neutral' as CandidateFlag }),
      makePhoto('c', { flag: 'neutral' as CandidateFlag }),
    ]);

    // Mark 'a' as a pick.
    session = setCandidateFlag(session, 'a', 'pick');
    expect(session.candidates?.photos[0].flag).toBe('pick');

    // Promote 'a' to set1.
    session = promoteCandidateToSlot(session, 'a', 'set1', 0);
    expect(session.sets.set1.photos[0].id).toBe('a');
    expect(session.sets.set1.photos[0].flag).toBeUndefined();
    expect(session.candidates?.photos).toHaveLength(2);

    // Reject 'b'.
    session = setCandidateFlag(session, 'b', 'reject');
    expect(session.candidates?.photos.find(p => p.id === 'b')?.flag).toBe('reject');

    // User changes their mind — demote 'a' back to tray.
    session = demoteSlotToCandidate(session, 'set1', 'a');
    expect(session.sets.set1.photos).toHaveLength(0);
    expect(session.candidates?.photos.find(p => p.id === 'a')?.flag).toBe('pick');

    // Final cleanup wipes the pool.
    session = clearAllCandidates(session);
    expect(session.candidates?.photos).toHaveLength(0);
  });
});

// PR #62 review G13: legacy sessions on disk don't have a `candidates`
// field. The helpers must treat that the same as an empty pool, otherwise
// reading an old session triggers a crash before the user can even
// migrate. The hook layer never constructs `undefined` candidates today,
// but persistence boundary code can.
describe('candidate helpers handle undefined session.candidates (legacy)', () => {
  function makeLegacySession(): ApiPhotoSession {
    return {
      id: 'sess-legacy',
      version: 1,
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
      mode: 'track',
      competition_name: 'Legacy',
      sets: {
        set1: { title: 'Set 1', photos: [] },
        set2: { title: 'Set 2', photos: [] },
      },
      // candidates: intentionally absent
    };
  }

  it('setCandidateFlag returns same session when candidates is undefined', () => {
    const session = makeLegacySession();
    const next = setCandidateFlag(session, 'any', 'pick');
    expect(next).toBe(session);
  });

  it('removeCandidate returns same session when candidates is undefined', () => {
    const session = makeLegacySession();
    const next = removeCandidate(session, 'any');
    expect(next).toBe(session);
  });

  it('clearAllCandidates returns same session when candidates is undefined', () => {
    const session = makeLegacySession();
    const next = clearAllCandidates(session);
    expect(next).toBe(session);
  });

  it('updateCandidateCanvasState returns same session when candidates is undefined', () => {
    const session = makeLegacySession();
    const next = updateCandidateCanvasState(session, 'any', { brightness: 5 });
    expect(next).toBe(session);
  });
});
