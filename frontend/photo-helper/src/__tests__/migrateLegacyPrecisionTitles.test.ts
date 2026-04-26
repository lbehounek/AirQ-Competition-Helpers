import { describe, it, expect } from 'vitest';
import { migrateLegacyPrecisionTitles } from '../utils/migrateLegacyPrecisionTitles';
import type { ApiPhotoSession } from '../types/api';

const baseSession = (overrides: Partial<ApiPhotoSession> = {}): ApiPhotoSession => ({
  id: 'session-test',
  version: 1,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
  mode: 'track',
  competition_name: 'Test',
  sets: {
    set1: { title: 'SP - TPX', photos: [] },
    set2: { title: 'TPX - FP', photos: [] },
  },
  setsTrack: {
    set1: { title: 'SP - TPX', photos: [] },
    set2: { title: 'TPX - FP', photos: [] },
  },
  setsTurning: {
    set1: { title: '', photos: [] },
    set2: { title: '', photos: [] },
  },
  ...overrides,
});

describe('migrateLegacyPrecisionTitles', () => {
  describe('happy path: precision session with legacy rally defaults', () => {
    it('rewrites set1 to "SP - FP" and set2 to "" when both match prior defaults', () => {
      const session = baseSession();
      const result = migrateLegacyPrecisionTitles(session, true);

      expect(result.migrated).toBe(true);
      expect(result.session.sets.set1.title).toBe('SP - FP');
      expect(result.session.sets.set2.title).toBe('');
    });

    it('also rewrites setsTrack so the precision title persists across mode switches', () => {
      // setsTrack is loaded back into session.sets when the user enters
      // track mode; if we only migrated session.sets, switching to
      // turning-point and back would restore the rally defaults.
      const session = baseSession();
      const result = migrateLegacyPrecisionTitles(session, true);

      expect(result.session.setsTrack?.set1.title).toBe('SP - FP');
      expect(result.session.setsTrack?.set2.title).toBe('');
    });

    it('preserves photos arrays when rewriting titles', () => {
      const photos = [
        { id: 'p1', sessionId: 's1', url: 'blob:a', filename: '1.jpg', canvasState: {} as any, label: 'X' },
      ];
      const session = baseSession({
        sets: {
          set1: { title: 'SP - TPX', photos },
          set2: { title: 'TPX - FP', photos: [] },
        },
      });
      const result = migrateLegacyPrecisionTitles(session, true);

      expect(result.session.sets.set1.photos).toEqual(photos);
    });
  });

  describe('safety guards: NEVER clobber user-customised titles', () => {
    it('does NOT migrate when set1 has been customised in BOTH buckets', () => {
      // Realistic: title edits propagate to both `session.sets` (the
      // active view) and the active-mode bucket (`setsTrack` here),
      // because saveSessionPhotos persists the active bucket on every
      // edit. So a user-edited session has both buckets out of sync
      // with the legacy default — neither matches, neither migrates.
      const session = baseSession({
        sets: {
          set1: { title: 'SP - my custom note', photos: [] },
          set2: { title: 'TPX - FP', photos: [] },
        },
        setsTrack: {
          set1: { title: 'SP - my custom note', photos: [] },
          set2: { title: 'TPX - FP', photos: [] },
        },
      });
      const result = migrateLegacyPrecisionTitles(session, true);

      expect(result.migrated).toBe(false);
      expect(result.session.sets.set1.title).toBe('SP - my custom note');
      expect(result.session.sets.set2.title).toBe('TPX - FP');
      expect(result.session.setsTrack?.set1.title).toBe('SP - my custom note');
    });

    it('does NOT migrate when set2 has been customised in BOTH buckets', () => {
      const session = baseSession({
        sets: {
          set1: { title: 'SP - TPX', photos: [] },
          set2: { title: 'TP3 - FP', photos: [] },
        },
        setsTrack: {
          set1: { title: 'SP - TPX', photos: [] },
          set2: { title: 'TP3 - FP', photos: [] },
        },
      });
      const result = migrateLegacyPrecisionTitles(session, true);

      expect(result.migrated).toBe(false);
      expect(result.session.sets.set1.title).toBe('SP - TPX');
      expect(result.session.sets.set2.title).toBe('TP3 - FP');
    });

    it('does NOT migrate session.sets when only setsTrack matches the legacy pair', () => {
      // Defensive: each bucket migrates independently. If the user
      // edited session.sets but not setsTrack (unlikely but possible),
      // only the unedited bucket is rewritten.
      const session = baseSession({
        sets: {
          set1: { title: 'My custom', photos: [] },
          set2: { title: 'Also custom', photos: [] },
        },
      });
      const result = migrateLegacyPrecisionTitles(session, true);

      expect(result.migrated).toBe(true);
      expect(result.session.sets.set1.title).toBe('My custom');
      expect(result.session.sets.set2.title).toBe('Also custom');
      expect(result.session.setsTrack?.set1.title).toBe('SP - FP');
      expect(result.session.setsTrack?.set2.title).toBe('');
    });

    it('does NOT migrate when only set1 matches but set2 does not', () => {
      // Both fields must match — partial match means user edited.
      const session = baseSession({
        sets: {
          set1: { title: 'SP - TPX', photos: [] },
          set2: { title: 'something else', photos: [] },
        },
        setsTrack: {
          set1: { title: 'SP - TPX', photos: [] },
          set2: { title: 'something else', photos: [] },
        },
      });
      const result = migrateLegacyPrecisionTitles(session, true);

      expect(result.migrated).toBe(false);
      expect(result.session).toBe(session);
    });
  });

  describe('discipline guard: NEVER touch rally sessions', () => {
    it('returns unchanged when isPrecision=false (rally legitimately uses these titles)', () => {
      const session = baseSession();
      const result = migrateLegacyPrecisionTitles(session, false);

      expect(result.migrated).toBe(false);
      expect(result.session).toBe(session);
      expect(result.session.sets.set1.title).toBe('SP - TPX');
      expect(result.session.sets.set2.title).toBe('TPX - FP');
    });
  });

  describe('null/undefined safety', () => {
    it('returns the input unchanged for null session', () => {
      const result = migrateLegacyPrecisionTitles(null, true);
      expect(result.migrated).toBe(false);
    });

    it('returns the input unchanged for undefined session', () => {
      const result = migrateLegacyPrecisionTitles(undefined, true);
      expect(result.migrated).toBe(false);
    });

    it('handles missing setsTrack (legacy sessions before mode-buckets existed)', () => {
      const session = baseSession();
      delete session.setsTrack;

      const result = migrateLegacyPrecisionTitles(session, true);

      // session.sets still matches and gets migrated; setsTrack stays undefined.
      expect(result.migrated).toBe(true);
      expect(result.session.sets.set1.title).toBe('SP - FP');
      expect(result.session.setsTrack).toBeUndefined();
    });
  });

  describe('idempotence', () => {
    it('is a no-op on a session that has already been migrated', () => {
      const session = baseSession();
      const first = migrateLegacyPrecisionTitles(session, true);
      const second = migrateLegacyPrecisionTitles(first.session, true);

      expect(first.migrated).toBe(true);
      expect(second.migrated).toBe(false);
      expect(second.session).toBe(first.session);
    });
  });

  describe('immutability', () => {
    it('does not mutate the input session when no migration applies', () => {
      const session = baseSession({
        sets: {
          set1: { title: 'My custom', photos: [] },
          set2: { title: 'Also custom', photos: [] },
        },
        setsTrack: {
          set1: { title: 'My custom', photos: [] },
          set2: { title: 'Also custom', photos: [] },
        },
      });
      const snapshot = JSON.parse(JSON.stringify(session));
      migrateLegacyPrecisionTitles(session, true);
      expect(session).toEqual(snapshot);
    });

    it('does not mutate the input session when migration applies', () => {
      const session = baseSession();
      const snapshot = JSON.parse(JSON.stringify(session));
      const result = migrateLegacyPrecisionTitles(session, true);
      // Original untouched
      expect(session).toEqual(snapshot);
      // Result diverges
      expect(result.session.sets.set1.title).toBe('SP - FP');
    });
  });
});
