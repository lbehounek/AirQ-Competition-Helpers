import { describe, it, expect } from 'vitest';
import {
  promoteCandidateToSlot,
  demoteSlotToCandidate,
  setCandidateFlag,
  removeCandidate,
  clearAllCandidates,
  updateCandidateCanvasState,
  routeImportedPickIntoSets,
  reconcilePlacedToDesiredSet,
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

describe('routeImportedPickIntoSets', () => {
  // Builds a session with explicit mode + optional discipline buckets so we
  // can exercise the active-vs-inactive routing branches. Track-landscape
  // capacity is 9; turning-point is 10 (see getGridCapacity).
  function makeRouteSession(opts: {
    mode: 'track' | 'turningpoint';
    sets?: { set1: ApiPhoto[]; set2: ApiPhoto[] };
    setsTrack?: { set1: ApiPhoto[]; set2: ApiPhoto[] };
    setsTurning?: { set1: ApiPhoto[]; set2: ApiPhoto[] };
    layoutMode?: 'portrait' | 'landscape';
  }): ApiPhotoSession {
    const wrap = (s?: { set1: ApiPhoto[]; set2: ApiPhoto[] }) =>
      s ? { set1: { title: '', photos: s.set1 }, set2: { title: '', photos: s.set2 } } : undefined;
    const base: any = {
      id: 'sess-1',
      version: 1,
      createdAt: '2026-05-31T00:00:00Z',
      updatedAt: '2026-05-31T00:00:00Z',
      mode: opts.mode,
      competition_name: 'Test',
      sets: wrap(opts.sets) ?? { set1: { title: '', photos: [] }, set2: { title: '', photos: [] } },
      candidates: { photos: [] },
    };
    if (opts.setsTrack) base.setsTrack = wrap(opts.setsTrack);
    if (opts.setsTurning) base.setsTurning = wrap(opts.setsTurning);
    if (opts.layoutMode) base.layoutMode = opts.layoutMode;
    return base as ApiPhotoSession;
  }

  const fill = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => makePhoto(`${prefix}${i + 1}`));

  it('routes a pick-track into the active track set1, clears flag, mirrors bucket', () => {
    const session = makeRouteSession({ mode: 'track' });
    const photo = makePhoto('pm-a', { flag: 'pick-track' as CandidateFlag });

    const { session: next, placement, revokeUrl } = routeImportedPickIntoSets(session, photo, 'track', false);

    expect(placement).toBe('set1');
    expect(next.sets.set1.photos.map(p => p.id)).toEqual(['pm-a']);
    expect(next.sets.set1.photos[0].flag).toBeUndefined();
    // Active-set placement keeps the live URL and mirrors into setsTrack.
    expect(next.sets.set1.photos[0].url).toBe('blob:pm-a');
    expect(next.setsTrack?.set1.photos.map(p => p.id)).toEqual(['pm-a']);
    expect(next.candidates?.photos).toHaveLength(0);
    expect(revokeUrl).toBeUndefined();
    expect(next.version).toBe(session.version + 1);
  });

  it('spills into set2 when set1 is full (track landscape capacity 9)', () => {
    const session = makeRouteSession({ mode: 'track', sets: { set1: fill(9, 's'), set2: [] } });
    const photo = makePhoto('pm-a', { flag: 'pick-track' as CandidateFlag });

    const { session: next, placement } = routeImportedPickIntoSets(session, photo, 'track', false);

    expect(placement).toBe('set2');
    expect(next.sets.set1.photos).toHaveLength(9);
    expect(next.sets.set2.photos.map(p => p.id)).toEqual(['pm-a']);
  });

  it('falls back to the candidate tray (flag kept) when both sets are full', () => {
    const session = makeRouteSession({ mode: 'track', sets: { set1: fill(9, 's'), set2: fill(9, 't') } });
    const photo = makePhoto('pm-a', { flag: 'pick-track' as CandidateFlag });

    const { session: next, placement, revokeUrl } = routeImportedPickIntoSets(session, photo, 'track', false);

    expect(placement).toBe('tray');
    expect(next.candidates?.photos.map(p => p.id)).toEqual(['pm-a']);
    expect(next.candidates?.photos[0].flag).toBe('pick-track');
    expect(next.candidates?.photos[0].url).toBe('blob:pm-a');
    expect(next.sets.set1.photos).toHaveLength(9);
    expect(next.sets.set2.photos).toHaveLength(9);
    expect(revokeUrl).toBeUndefined();
  });

  it('routes a pick-turning into the INACTIVE turning bucket without touching the active view', () => {
    const session = makeRouteSession({ mode: 'track', sets: { set1: fill(2, 's'), set2: [] } });
    const photo = makePhoto('pm-a', { flag: 'pick-turning' as CandidateFlag });

    const { session: next, placement, revokeUrl } = routeImportedPickIntoSets(session, photo, 'turningpoint', false);

    expect(placement).toBe('set1');
    // Active (track) view is untouched.
    expect(next.sets.set1.photos.map(p => p.id)).toEqual(['s1', 's2']);
    // Lands in the turning bucket, stored with an empty URL (regenerated on
    // mode-load) and flag cleared.
    expect(next.setsTurning?.set1.photos.map(p => p.id)).toEqual(['pm-a']);
    expect(next.setsTurning?.set1.photos[0].url).toBe('');
    expect(next.setsTurning?.set1.photos[0].flag).toBeUndefined();
    // The live URL is now orphaned — caller revokes it.
    expect(revokeUrl).toBe('blob:pm-a');
  });

  it('turning-point capacity is 10 — 10th into set1, 11th spills to set2', () => {
    const session = makeRouteSession({ mode: 'turningpoint', sets: { set1: fill(9, 's'), set2: [] } });
    const tenth = routeImportedPickIntoSets(session, makePhoto('pm-10', { flag: 'pick-turning' as CandidateFlag }), 'turningpoint', false);
    expect(tenth.placement).toBe('set1');
    expect(tenth.session.sets.set1.photos).toHaveLength(10);

    const full = makeRouteSession({ mode: 'turningpoint', sets: { set1: fill(10, 's'), set2: [] } });
    const eleventh = routeImportedPickIntoSets(full, makePhoto('pm-11', { flag: 'pick-turning' as CandidateFlag }), 'turningpoint', false);
    expect(eleventh.placement).toBe('set2');
  });

  it('precision is single-set: overflow from a full set1 goes to the tray, never set2', () => {
    // Precision track is single-set (set2 unused), so isPrecision=true must
    // skip set2 even though it is empty.
    const session = makeRouteSession({ mode: 'track', sets: { set1: fill(9, 's'), set2: [] } });
    const photo = makePhoto('pm-a', { flag: 'pick-track' as CandidateFlag });

    const { session: next, placement } = routeImportedPickIntoSets(session, photo, 'track', true);

    expect(placement).toBe('tray');
    expect(next.sets.set2.photos).toHaveLength(0);
    expect(next.candidates?.photos.map(p => p.id)).toEqual(['pm-a']);
  });

  // Idempotency guard — a rapid re-sync (mount run + a visibilitychange run)
  // can call the helper twice for the same id before React recomputes the
  // `placedIds` memo. The second call must NOT append a duplicate; it returns
  // the existing placement and hands back the redundant blob URL to revoke.
  it('is idempotent by id in the active set — second call does not duplicate', () => {
    const first = routeImportedPickIntoSets(
      makeRouteSession({ mode: 'track' }),
      makePhoto('pm-a', { flag: 'pick-track' as CandidateFlag }),
      'track',
      false,
    );
    expect(first.session.sets.set1.photos.map(p => p.id)).toEqual(['pm-a']);

    // Re-run against the just-placed session with a fresh-URL duplicate.
    const dup = makePhoto('pm-a', { flag: 'pick-track' as CandidateFlag, url: 'blob:pm-a-2' });
    const second = routeImportedPickIntoSets(first.session, dup, 'track', false);

    expect(second.placement).toBe('set1');
    expect(second.session.sets.set1.photos.map(p => p.id)).toEqual(['pm-a']); // no duplicate
    expect(second.session.sets.set1.photos).toHaveLength(1);
    // The redundant URL minted for this attempt is handed back for revocation.
    expect(second.revokeUrl).toBe('blob:pm-a-2');
    // No-op: session is returned unchanged (version not bumped).
    expect(second.session).toBe(first.session);
  });

  it('is idempotent by id in an inactive bucket — second call does not duplicate', () => {
    const first = routeImportedPickIntoSets(
      makeRouteSession({ mode: 'track' }),
      makePhoto('pm-tp', { flag: 'pick-turning' as CandidateFlag }),
      'turningpoint',
      false,
    );
    expect(first.session.setsTurning?.set1.photos.map(p => p.id)).toEqual(['pm-tp']);

    const dup = makePhoto('pm-tp', { flag: 'pick-turning' as CandidateFlag, url: 'blob:pm-tp-2' });
    const second = routeImportedPickIntoSets(first.session, dup, 'turningpoint', false);

    expect(second.placement).toBe('set1');
    expect(second.session.setsTurning?.set1.photos).toHaveLength(1);
    expect(second.revokeUrl).toBe('blob:pm-tp-2');
    expect(second.session).toBe(first.session);
  });

  it('is idempotent by id in the tray — a re-routed overflow pick does not duplicate', () => {
    const first = routeImportedPickIntoSets(
      makeRouteSession({ mode: 'track', sets: { set1: fill(9, 's'), set2: fill(9, 't') } }),
      makePhoto('pm-a', { flag: 'pick-track' as CandidateFlag }),
      'track',
      false,
    );
    expect(first.placement).toBe('tray');
    expect(first.session.candidates?.photos.map(p => p.id)).toEqual(['pm-a']);

    const dup = makePhoto('pm-a', { flag: 'pick-track' as CandidateFlag, url: 'blob:pm-a-2' });
    const second = routeImportedPickIntoSets(first.session, dup, 'track', false);

    expect(second.placement).toBe('tray');
    expect(second.session.candidates?.photos.map(p => p.id)).toEqual(['pm-a']); // no duplicate
    expect(second.revokeUrl).toBe('blob:pm-a-2');
    expect(second.session).toBe(first.session);
  });

  // --- desiredSet (TP set-break) routing ---

  it('honors desiredSet=set2 — goes straight to set2 even though set1 has room', () => {
    const session = makeRouteSession({ mode: 'track' });
    const photo = makePhoto('pm-a', { flag: 'pick-track' as CandidateFlag });

    const { session: next, placement } = routeImportedPickIntoSets(session, photo, 'track', false, 'set2');

    expect(placement).toBe('set2');
    expect(next.sets.set1.photos).toHaveLength(0);
    expect(next.sets.set2.photos.map(p => p.id)).toEqual(['pm-a']);
  });

  it('overflows a full desiredSet to the tray — never cross-spills into the other sheet', () => {
    // desiredSet=set1 is full, but set2 is empty: must go to tray, NOT set2.
    const session = makeRouteSession({ mode: 'track', sets: { set1: fill(9, 's'), set2: [] } });
    const photo = makePhoto('pm-a', { flag: 'pick-track' as CandidateFlag });

    const { session: next, placement } = routeImportedPickIntoSets(session, photo, 'track', false, 'set1');

    expect(placement).toBe('tray');
    expect(next.sets.set2.photos).toHaveLength(0); // no cross-spill
    expect(next.candidates?.photos.map(p => p.id)).toEqual(['pm-a']);
    expect(next.candidates?.photos[0].flag).toBe('pick-track');
  });

  it('ignores desiredSet under precision (single-set) — falls back to default fill', () => {
    // Precision: set2 unavailable. desiredSet=set2 must be ignored → set1.
    const session = makeRouteSession({ mode: 'track' });
    const photo = makePhoto('pm-a', { flag: 'pick-track' as CandidateFlag });

    const { session: next, placement } = routeImportedPickIntoSets(session, photo, 'track', true, 'set2');

    expect(placement).toBe('set1');
    expect(next.sets.set1.photos.map(p => p.id)).toEqual(['pm-a']);
  });

  it('desiredSet routes into the inactive bucket with url:"" like the default path', () => {
    const session = makeRouteSession({ mode: 'track' });
    const photo = makePhoto('pm-tp', { flag: 'pick-turning' as CandidateFlag });

    const { session: next, placement, revokeUrl } =
      routeImportedPickIntoSets(session, photo, 'turningpoint', false, 'set2');

    expect(placement).toBe('set2');
    expect(next.sets.set1.photos).toHaveLength(0); // active track view untouched
    expect(next.setsTurning?.set2.photos.map(p => p.id)).toEqual(['pm-tp']);
    expect(next.setsTurning?.set2.photos[0].url).toBe('');
    expect(revokeUrl).toBe('blob:pm-tp');
  });
});

describe('reconcilePlacedToDesiredSet', () => {
  // Active-discipline session: session.sets IS the discipline's live sheets.
  function makeActiveSession(opts: {
    mode?: 'track' | 'turningpoint';
    set1?: ApiPhoto[];
    set2?: ApiPhoto[];
    candidates?: ApiPhoto[];
    layoutMode?: 'portrait' | 'landscape';
  }): ApiPhotoSession {
    const base: any = {
      id: 'sess-1',
      version: 1,
      createdAt: '2026-05-31T00:00:00Z',
      updatedAt: '2026-05-31T00:00:00Z',
      mode: opts.mode ?? 'track',
      competition_name: 'Test',
      sets: {
        set1: { title: 'S1', photos: opts.set1 ?? [] },
        set2: { title: 'S2', photos: opts.set2 ?? [] },
      },
      candidates: { photos: opts.candidates ?? [] },
    };
    if (opts.layoutMode) base.layoutMode = opts.layoutMode;
    return base as ApiPhotoSession;
  }

  const fillR = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => makePhoto(`${prefix}${i + 1}`));

  it('moves a placed pick set1 → set2 when the break says so, preserving its state', () => {
    const p = makePhoto('pm-x');
    p.label = 'TP3';
    p.canvasState = { ...p.canvasState, brightness: 0.7 } as any;
    const session = makeActiveSession({ set1: [makePhoto('a'), p, makePhoto('b')], set2: [] });

    const { session: next, moved } = reconcilePlacedToDesiredSet(session, 'pm-x', 'set2', false);

    expect(moved).toBe(true);
    // Removed from set1 (others keep order), appended to set2.
    expect(next.sets.set1.photos.map(q => q.id)).toEqual(['a', 'b']);
    expect(next.sets.set2.photos.map(q => q.id)).toEqual(['pm-x']);
    // Editor-owned state survives the move.
    expect(next.sets.set2.photos[0].label).toBe('TP3');
    expect((next.sets.set2.photos[0].canvasState as any).brightness).toBe(0.7);
    // Active bucket mirrored.
    expect(next.setsTrack?.set2.photos.map(q => q.id)).toEqual(['pm-x']);
    expect(next.version).toBe(session.version + 1);
  });

  it('is a no-op (same ref) when the pick is already in the desired sheet', () => {
    const p = makePhoto('pm-x');
    const session = makeActiveSession({ set1: [p], set2: [] });
    const { session: next, moved } = reconcilePlacedToDesiredSet(session, 'pm-x', 'set1', false);
    expect(moved).toBe(false);
    expect(next).toBe(session);
  });

  it('is a no-op when the pick is not in the active sets (inactive bucket / tray)', () => {
    const session = makeActiveSession({ set1: [makePhoto('a')], set2: [] });
    const { session: next, moved } = reconcilePlacedToDesiredSet(session, 'pm-missing', 'set2', false);
    expect(moved).toBe(false);
    expect(next).toBe(session);
  });

  it('overflows to the tray (category flag) when the target sheet is full — no cross-spill back', () => {
    const p = makePhoto('pm-x');
    // set1 has the pick + others; set2 (target) is full at capacity 9.
    const session = makeActiveSession({ set1: [p, ...fillR(3, 's')], set2: fillR(9, 't') });

    const { session: next, moved } = reconcilePlacedToDesiredSet(session, 'pm-x', 'set2', false);

    expect(moved).toBe(true);
    expect(next.sets.set1.photos.map(q => q.id)).toEqual(['s1', 's2', 's3']); // removed from set1
    expect(next.sets.set2.photos).toHaveLength(9); // unchanged — full
    expect(next.candidates?.photos.map(q => q.id)).toEqual(['pm-x']);
    expect(next.candidates?.photos[0].flag).toBe('pick-track'); // re-flagged by category
  });

  it('tray overflow uses pick-turning in turning-point mode', () => {
    const p = makePhoto('pm-x');
    const session = makeActiveSession({ mode: 'turningpoint', set1: [p], set2: fillR(10, 't') });
    const { session: next } = reconcilePlacedToDesiredSet(session, 'pm-x', 'set2', false);
    expect(next.candidates?.photos[0].flag).toBe('pick-turning');
  });

  it('is a no-op under precision (single-set — no cross-sheet membership)', () => {
    const p = makePhoto('pm-x');
    const session = makeActiveSession({ set1: [p], set2: [] });
    const { session: next, moved } = reconcilePlacedToDesiredSet(session, 'pm-x', 'set2', true);
    expect(moved).toBe(false);
    expect(next).toBe(session);
  });
});
