import { describe, it, expect } from 'vitest';
import { pickEffectiveLayout } from '../utils/pickEffectiveLayout';

/**
 * Pins the precedence chain for PDF layout resolution
 * (feedback 2026-04-26 #5: "PDF layout 3x3/5x2 sometimes works,
 * sometimes doesn't" — caused by reading stale `session.layoutMode`
 * before the OPFS write window closed).
 *
 * The chain MUST be: context > session > 'landscape'. A regression
 * flipping the order or removing the context tier would silently
 * re-introduce the race.
 */
describe('pickEffectiveLayout', () => {
  describe('precedence — context wins over session', () => {
    it('returns the context value when both context and session are set', () => {
      // The race scenario: user toggled to portrait, OPFS write hasn't
      // landed yet, session still says landscape — context value (the
      // truth the user just saw) must win.
      expect(pickEffectiveLayout('portrait', 'landscape')).toBe('portrait');
      expect(pickEffectiveLayout('landscape', 'portrait')).toBe('landscape');
    });

    it('returns the context value when context is set and session is undefined', () => {
      expect(pickEffectiveLayout('portrait', undefined)).toBe('portrait');
      expect(pickEffectiveLayout('landscape', undefined)).toBe('landscape');
    });

    it('returns the context value when context is set and session is null', () => {
      expect(pickEffectiveLayout('portrait', null)).toBe('portrait');
    });
  });

  describe('precedence — session is the cold-start fallback', () => {
    it('returns the session value when context is undefined', () => {
      // Cold-start path: hook just mounted, AppApi.tsx:167-171 effect
      // hasn't yet synced session.layoutMode → context. Until then,
      // session is the source of truth.
      expect(pickEffectiveLayout(undefined, 'portrait')).toBe('portrait');
      expect(pickEffectiveLayout(undefined, 'landscape')).toBe('landscape');
    });

    it('returns the session value when context is null', () => {
      expect(pickEffectiveLayout(null, 'portrait')).toBe('portrait');
    });
  });

  describe('precedence — landscape is the hardcoded floor', () => {
    it('returns "landscape" when both inputs are undefined', () => {
      // Legacy sessions persisted before layoutMode existed don't carry
      // the field at all. Default to landscape (the original-only mode).
      expect(pickEffectiveLayout(undefined, undefined)).toBe('landscape');
    });

    it('returns "landscape" when both inputs are null', () => {
      expect(pickEffectiveLayout(null, null)).toBe('landscape');
    });
  });

  describe('regression: NEVER flip the precedence', () => {
    // The race the PR fixed was the OLD code reading session before
    // context. If a future refactor inverts the chain, this test fails.
    it('does NOT prefer session over context when context is set', () => {
      const result = pickEffectiveLayout('portrait', 'landscape');
      expect(result).not.toBe('landscape');
      expect(result).toBe('portrait');
    });
  });
});
