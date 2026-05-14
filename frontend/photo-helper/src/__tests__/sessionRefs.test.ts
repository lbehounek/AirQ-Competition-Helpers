import { describe, it, expect } from 'vitest';
import { isPhotoReferencedInSession } from '../utils/sessionRefs';
import type { ApiPhoto, ApiPhotoSession } from '../types/api';

// PR #62 review IMP-2: the shared cross-bucket reference check used by every
// candidate / slot deletion path. The OPFS file is shared across the active
// `sets`, the per-mode buckets (`setsTrack`/`setsTurning`), and the
// candidate pool. Deleting the file while ANY container still references
// it would break the inactive mode on next load.

function p(id: string): ApiPhoto {
  return {
    id,
    sessionId: 'sess-1',
    url: `blob:${id}`,
    filename: `${id}.jpg`,
    canvasState: {} as any,
    label: '',
  };
}

function makeSession(opts: {
  set1?: ApiPhoto[];
  set2?: ApiPhoto[];
  setsTrack?: { set1?: ApiPhoto[]; set2?: ApiPhoto[] };
  setsTurning?: { set1?: ApiPhoto[]; set2?: ApiPhoto[] };
  candidates?: ApiPhoto[];
}): ApiPhotoSession {
  const session: ApiPhotoSession = {
    id: 'sess-1',
    version: 1,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    mode: 'track',
    competition_name: 'Test',
    sets: {
      set1: { title: 'Set 1', photos: opts.set1 ?? [] },
      set2: { title: 'Set 2', photos: opts.set2 ?? [] },
    },
  };
  if (opts.setsTrack) {
    session.setsTrack = {
      set1: { title: 'Set 1', photos: opts.setsTrack.set1 ?? [] },
      set2: { title: 'Set 2', photos: opts.setsTrack.set2 ?? [] },
    };
  }
  if (opts.setsTurning) {
    session.setsTurning = {
      set1: { title: 'Set 1', photos: opts.setsTurning.set1 ?? [] },
      set2: { title: 'Set 2', photos: opts.setsTurning.set2 ?? [] },
    };
  }
  if (opts.candidates) {
    session.candidates = { photos: opts.candidates };
  }
  return session;
}

describe('isPhotoReferencedInSession', () => {
  it('returns false for empty session', () => {
    const s = makeSession({});
    expect(isPhotoReferencedInSession(s, 'x')).toBe(false);
  });

  it('returns false when id is not in any container', () => {
    const s = makeSession({ set1: [p('a')], set2: [p('b')], candidates: [p('c')] });
    expect(isPhotoReferencedInSession(s, 'missing')).toBe(false);
  });

  it('returns true when id is in active sets.set1', () => {
    const s = makeSession({ set1: [p('x')] });
    expect(isPhotoReferencedInSession(s, 'x')).toBe(true);
  });

  it('returns true when id is in active sets.set2', () => {
    const s = makeSession({ set2: [p('x')] });
    expect(isPhotoReferencedInSession(s, 'x')).toBe(true);
  });

  it('returns true when id is in setsTrack.set1', () => {
    const s = makeSession({ setsTrack: { set1: [p('x')] } });
    expect(isPhotoReferencedInSession(s, 'x')).toBe(true);
  });

  it('returns true when id is in setsTrack.set2', () => {
    const s = makeSession({ setsTrack: { set2: [p('x')] } });
    expect(isPhotoReferencedInSession(s, 'x')).toBe(true);
  });

  it('returns true when id is in setsTurning.set1', () => {
    const s = makeSession({ setsTurning: { set1: [p('x')] } });
    expect(isPhotoReferencedInSession(s, 'x')).toBe(true);
  });

  it('returns true when id is in setsTurning.set2', () => {
    const s = makeSession({ setsTurning: { set2: [p('x')] } });
    expect(isPhotoReferencedInSession(s, 'x')).toBe(true);
  });

  it('returns true when id is in candidates pool', () => {
    const s = makeSession({ candidates: [p('x')] });
    expect(isPhotoReferencedInSession(s, 'x')).toBe(true);
  });

  // The post-removePhoto state: `sets` no longer has photo, but the OTHER
  // mode bucket still does. The shared OPFS file must NOT be deleted.
  it('returns true when removed-from-active-sets photo still lives in the other mode bucket', () => {
    const s = makeSession({
      set1: [], // photo was just removed from here
      setsTrack: { set1: [] }, // active mode bucket mirrored the removal
      setsTurning: { set1: [p('x')] }, // OTHER mode bucket still references
    });
    expect(isPhotoReferencedInSession(s, 'x')).toBe(true);
  });

  // The post-removePhoto state with mirror applied: no other container
  // references the id. The OPFS file is safe to delete.
  it('returns false after slot removal mirrored into active bucket with no other refs', () => {
    const s = makeSession({
      set1: [], // photo was removed
      setsTrack: { set1: [] }, // active bucket mirrored the removal
      setsTurning: { set1: [] }, // inactive bucket also clean
    });
    expect(isPhotoReferencedInSession(s, 'x')).toBe(false);
  });

  // PR #62 review CRIT-3/IMP-2: the cleanup-dialog path must NOT
  // delete a file that a slot still references, even if the same id is
  // briefly present in candidates due to a race.
  it('returns true when id is in BOTH candidates and a slot (defensive)', () => {
    const s = makeSession({
      set1: [p('x')],
      candidates: [p('x')],
    });
    expect(isPhotoReferencedInSession(s, 'x')).toBe(true);
  });
});
