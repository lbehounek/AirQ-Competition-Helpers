import { describe, it, expect } from 'vitest';
import {
  getGridCapacity,
  TURNING_POINT_PER_SET,
  TRACK_LANDSCAPE_PER_SET,
  TRACK_PORTRAIT_PER_SET,
} from '../utils/getGridCapacity';

// Single source of truth for grid capacity across five sites
// (`addPhotosToSet`, `reorderPhotos`, `getSessionStats` x2,
// `addPhotosToTurningPoint`). A cap bump must propagate uniformly — these
// tests pin the rule so a future change can't drift any one site.
describe('getGridCapacity', () => {
  it('exposes the documented constants', () => {
    expect(TURNING_POINT_PER_SET).toBe(10);
    expect(TRACK_LANDSCAPE_PER_SET).toBe(9);
    expect(TRACK_PORTRAIT_PER_SET).toBe(10);
  });

  it('returns track-landscape default for null/undefined session', () => {
    expect(getGridCapacity(null)).toBe(9);
    expect(getGridCapacity(undefined)).toBe(9);
  });

  describe('turning-point mode', () => {
    it('caps at 10 in landscape', () => {
      expect(getGridCapacity({ mode: 'turningpoint', layoutMode: 'landscape' })).toBe(10);
    });

    it('caps at 10 in portrait', () => {
      expect(getGridCapacity({ mode: 'turningpoint', layoutMode: 'portrait' })).toBe(10);
    });

    it('caps at 10 even when layoutMode is missing', () => {
      // Layout is irrelevant for turning-point mode — the auto-flipping
      // 3×3 / 5×2 grid handles both orientations at 10/set.
      expect(getGridCapacity({ mode: 'turningpoint' })).toBe(10);
    });
  });

  describe('track mode', () => {
    it('caps at 9 in landscape', () => {
      expect(getGridCapacity({ mode: 'track', layoutMode: 'landscape' })).toBe(9);
    });

    it('caps at 10 in portrait', () => {
      expect(getGridCapacity({ mode: 'track', layoutMode: 'portrait' })).toBe(10);
    });

    it('defaults to landscape (9) when layoutMode is missing', () => {
      // The legacy default — track mode without an explicit layoutMode
      // renders in landscape, so capacity follows.
      expect(getGridCapacity({ mode: 'track' })).toBe(9);
    });

    it('treats unknown layoutMode strings as landscape (9)', () => {
      // Defensive: anything other than 'portrait' falls into the
      // landscape branch.
      expect(getGridCapacity({ mode: 'track', layoutMode: 'square' as any })).toBe(9);
    });
  });

  it('defaults to track when mode is missing', () => {
    // A session loaded from an older build might not have `mode` set.
    // Track is the legacy default.
    expect(getGridCapacity({ layoutMode: 'portrait' })).toBe(10);
    expect(getGridCapacity({ layoutMode: 'landscape' })).toBe(9);
    expect(getGridCapacity({})).toBe(9);
  });
});
