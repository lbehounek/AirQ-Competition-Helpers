import { describe, it, expect } from 'vitest';
import { collectModeSwitchRevokeUrls } from '../utils/modeSwitchRevokeUrls';

/**
 * Pins the contract for which blob URLs are revoked on mode switch
 * (feedback 2026-04-26 #4).
 *
 * The bug was: pre-revoking the INCOMING bucket's URLs caused the
 * "first TP page photos flicker and disappear" symptom. The first
 * fix over-corrected and stopped revoking the OUTGOING bucket too,
 * leaking ~9-20 blob URL registrations per mode switch.
 *
 * Correct behavior:
 *   ✓ revoke session.sets URLs (outgoing view)
 *   ✓ revoke outgoing mode-bucket URLs (setsTrack OR setsTurning)
 *   ✗ NEVER revoke incoming mode-bucket URLs (causes flicker)
 */
describe('collectModeSwitchRevokeUrls', () => {
  // Build a session where each bucket has DISTINCT blob URLs, mirroring
  // production where competitionService.loadSessionPhotos calls
  // URL.createObjectURL independently for each bucket (lines 596-610).
  const buildSession = (currentMode: 'track' | 'turningpoint') => ({
    mode: currentMode,
    sets: {
      set1: { photos: [{ url: 'blob:sets-s1-a' }, { url: 'blob:sets-s1-b' }] },
      set2: { photos: [{ url: 'blob:sets-s2-a' }] },
    },
    setsTrack: {
      set1: { photos: [{ url: 'blob:track-s1-a' }, { url: 'blob:track-s1-b' }] },
      set2: { photos: [{ url: 'blob:track-s2-a' }] },
    },
    setsTurning: {
      set1: { photos: [{ url: 'blob:turning-s1-a' }] },
      set2: { photos: [{ url: 'blob:turning-s2-a' }, { url: 'blob:turning-s2-b' }] },
    },
  });

  describe('switching FROM track TO turningpoint', () => {
    it('revokes session.sets AND outgoing setsTrack URLs', () => {
      const urls = collectModeSwitchRevokeUrls(buildSession('track'), 'turningpoint');
      expect(urls).toContain('blob:sets-s1-a');
      expect(urls).toContain('blob:sets-s1-b');
      expect(urls).toContain('blob:sets-s2-a');
      expect(urls).toContain('blob:track-s1-a');
      expect(urls).toContain('blob:track-s1-b');
      expect(urls).toContain('blob:track-s2-a');
    });

    it('NEVER revokes incoming setsTurning URLs (would cause flicker)', () => {
      const urls = collectModeSwitchRevokeUrls(buildSession('track'), 'turningpoint');
      expect(urls).not.toContain('blob:turning-s1-a');
      expect(urls).not.toContain('blob:turning-s2-a');
      expect(urls).not.toContain('blob:turning-s2-b');
    });
  });

  describe('switching FROM turningpoint TO track', () => {
    it('revokes session.sets AND outgoing setsTurning URLs', () => {
      const urls = collectModeSwitchRevokeUrls(buildSession('turningpoint'), 'track');
      expect(urls).toContain('blob:sets-s1-a');
      expect(urls).toContain('blob:sets-s1-b');
      expect(urls).toContain('blob:sets-s2-a');
      expect(urls).toContain('blob:turning-s1-a');
      expect(urls).toContain('blob:turning-s2-a');
      expect(urls).toContain('blob:turning-s2-b');
    });

    it('NEVER revokes incoming setsTrack URLs (would cause flicker)', () => {
      const urls = collectModeSwitchRevokeUrls(buildSession('turningpoint'), 'track');
      expect(urls).not.toContain('blob:track-s1-a');
      expect(urls).not.toContain('blob:track-s1-b');
      expect(urls).not.toContain('blob:track-s2-a');
    });
  });

  describe('edge cases', () => {
    it('returns an empty array for a no-op switch (mode === nextMode)', () => {
      // Defensive: caller may not guard. Contract holds either way.
      expect(collectModeSwitchRevokeUrls(buildSession('track'), 'track')).toEqual([]);
      expect(collectModeSwitchRevokeUrls(buildSession('turningpoint'), 'turningpoint')).toEqual([]);
    });

    it('skips photos with no `url` field', () => {
      const session = {
        mode: 'track' as const,
        sets: {
          set1: { photos: [{}, { url: undefined }, { url: '' }] },
          set2: { photos: [{ url: 'blob:keep-me' }] },
        },
        setsTrack: { set1: { photos: [] }, set2: { photos: [] } },
        setsTurning: { set1: { photos: [] }, set2: { photos: [] } },
      };
      const urls = collectModeSwitchRevokeUrls(session, 'turningpoint');
      expect(urls).toEqual(['blob:keep-me']);
    });

    it('skips non-blob URLs (e.g. data: or http:)', () => {
      // Defensive: production never stores http URLs in session photos
      // but we shouldn't `revokeObjectURL` on something that wasn't
      // produced by `createObjectURL` either way.
      const session = {
        mode: 'track' as const,
        sets: {
          set1: {
            photos: [
              { url: 'http://example.com/foo.jpg' },
              { url: 'data:image/png;base64,iVBORw0' },
              { url: 'blob:legit' },
            ],
          },
          set2: { photos: [] },
        },
        setsTrack: { set1: { photos: [] }, set2: { photos: [] } },
        setsTurning: { set1: { photos: [] }, set2: { photos: [] } },
      };
      const urls = collectModeSwitchRevokeUrls(session, 'turningpoint');
      expect(urls).toEqual(['blob:legit']);
    });

    it('de-duplicates URLs shared between session.sets and the outgoing bucket', () => {
      // First hook render: session.sets and the active mode-bucket may
      // share photo references (both initialised from the same
      // loadPhotoUrls pass). The set-based de-dupe means the consumer
      // calls URL.revokeObjectURL once per unique URL.
      const session = {
        mode: 'track' as const,
        sets: { set1: { photos: [{ url: 'blob:shared' }] }, set2: { photos: [] } },
        setsTrack: { set1: { photos: [{ url: 'blob:shared' }] }, set2: { photos: [] } },
        setsTurning: { set1: { photos: [] }, set2: { photos: [] } },
      };
      const urls = collectModeSwitchRevokeUrls(session, 'turningpoint');
      expect(urls).toEqual(['blob:shared']);
    });

    it('handles missing setsTrack / setsTurning gracefully (legacy sessions)', () => {
      // Sessions persisted before the mode-bucket fields existed have
      // no `setsTrack` or `setsTurning`. Should not throw.
      const session = {
        mode: 'track' as const,
        sets: { set1: { photos: [{ url: 'blob:keep' }] }, set2: { photos: [] } },
      };
      const urls = collectModeSwitchRevokeUrls(session, 'turningpoint');
      expect(urls).toEqual(['blob:keep']);
    });

    it('handles a missing photos array in a bucket (defensive)', () => {
      const session = {
        mode: 'track' as const,
        sets: { set1: {}, set2: { photos: [{ url: 'blob:s2' }] } },
        setsTrack: { set1: { photos: [{ url: 'blob:t1' }] }, set2: {} },
        setsTurning: { set1: { photos: [] }, set2: { photos: [] } },
      };
      const urls = collectModeSwitchRevokeUrls(session, 'turningpoint');
      expect(urls).toContain('blob:s2');
      expect(urls).toContain('blob:t1');
      expect(urls).toHaveLength(2);
    });
  });

  describe('regression: NEVER revoke the incoming bucket', () => {
    // Doubled-up assertion to catch the most likely regression: someone
    // "fixes the leak" by adding the incoming bucket back. That would
    // re-introduce the flicker the PR fixed.
    it('switching to turningpoint never returns any setsTurning URLs', () => {
      const urls = collectModeSwitchRevokeUrls(buildSession('track'), 'turningpoint');
      const turningUrls = urls.filter(u => u.includes('turning'));
      expect(turningUrls).toEqual([]);
    });

    it('switching to track never returns any setsTrack URLs', () => {
      const urls = collectModeSwitchRevokeUrls(buildSession('turningpoint'), 'track');
      const trackUrls = urls.filter(u => u.includes('track'));
      expect(trackUrls).toEqual([]);
    });
  });
});
