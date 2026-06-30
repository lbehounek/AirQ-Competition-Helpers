import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildTourSteps,
  shouldAutoStartTour,
  markTourSeen,
  ONBOARDING_KEY,
} from '../onboarding/mapCorridorsTour';
import en from '../locales/en.json';
import cs from '../locales/cs.json';

// Echo translator: returns the key so we can assert which keys the steps use,
// and a real-locale lookup to assert every key the tour references exists.
const echo = (k: string) => k;

function lookup(dict: Record<string, unknown>) {
  return (key: string): string => {
    const v = key.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)?.[part], dict);
    if (typeof v !== 'string') throw new Error(`missing i18n key: ${key}`);
    return v;
  };
}

describe('buildTourSteps', () => {
  it('produces the 6 ordered steps with the expected element anchors', () => {
    const steps = buildTourSteps(echo);
    expect(steps).toHaveLength(6);
    // Anchored steps target stable [data-tour] selectors present at load.
    expect(steps[1].element).toBe('[data-tour="import"]');
    expect(steps[4].element).toBe('[data-tour="send"]');
    expect(steps[5].element).toBe('[data-tour="help"]');
    // Data-dependent steps (welcome/categorize/split) are centered (no element).
    expect(steps[0].element).toBeUndefined();
    expect(steps[2].element).toBeUndefined();
    expect(steps[3].element).toBeUndefined();
  });

  it('every key the tour references resolves in EN', () => {
    expect(() => buildTourSteps(lookup(en))).not.toThrow();
  });

  it('every key the tour references resolves in CS (parity)', () => {
    expect(() => buildTourSteps(lookup(cs))).not.toThrow();
  });
});

describe('first-run gate', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('auto-starts when the flag is unset, then never again after markTourSeen', () => {
    expect(shouldAutoStartTour()).toBe(true);
    markTourSeen();
    expect(shouldAutoStartTour()).toBe(false);
    expect(window.localStorage.getItem(ONBOARDING_KEY)).not.toBeNull();
  });

  it('does not auto-start (and does not throw) when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(shouldAutoStartTour()).toBe(false);
  });
});
