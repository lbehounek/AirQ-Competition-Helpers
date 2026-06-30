import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildTourSteps,
  shouldAutoStartTour,
  markTourSeen,
  scheduleAutoStartTour,
  ONBOARDING_KEY,
} from '../onboarding/mapCorridorsTour';
import en from '../locales/en.json';
import cs from '../locales/cs.json';

// Every app.tour.* key the feature references — not just buildTourSteps' steps,
// but also the driver button labels (startMapCorridorsTour) and the Help button
// (App.tsx). A missing key in either locale renders the raw key to users.
const ALL_TOUR_KEYS = [
  'app.tour.next', 'app.tour.prev', 'app.tour.done',
  'app.tour.welcome.title', 'app.tour.welcome.body',
  'app.tour.import.title', 'app.tour.import.body',
  'app.tour.categorize.title', 'app.tour.categorize.body',
  'app.tour.split.title', 'app.tour.split.body',
  'app.tour.send.title', 'app.tour.send.body',
  'app.tour.help.title', 'app.tour.help.body', 'app.tour.help.button',
];

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

describe('i18n parity — ALL tour keys (steps + buttons + help)', () => {
  it.each(['en', 'cs'])('every tour key resolves in %s', (loc) => {
    const dict = loc === 'en' ? en : cs;
    const get = lookup(dict);
    for (const key of ALL_TOUR_KEYS) {
      expect(() => get(key), `missing ${key} in ${loc}`).not.toThrow();
    }
  });
});

describe('scheduleAutoStartTour', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('fires the tour once after the delay AND marks seen only when it fires', () => {
    const run = vi.fn();
    expect(window.localStorage.getItem(ONBOARDING_KEY)).toBeNull();
    const cleanup = scheduleAutoStartTour(run, 600);
    // Not marked or run before the timer fires.
    expect(run).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(ONBOARDING_KEY)).toBeNull();
    vi.advanceTimersByTime(600);
    expect(run).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(ONBOARDING_KEY)).not.toBeNull();
    cleanup();
  });

  it('does nothing when the tour was already seen', () => {
    markTourSeen();
    const run = vi.fn();
    scheduleAutoStartTour(run, 600);
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it('cleanup before the timer fires cancels it AND leaves "seen" unset (will show next time)', () => {
    const run = vi.fn();
    const cleanup = scheduleAutoStartTour(run, 600);
    cleanup();
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(ONBOARDING_KEY)).toBeNull();
    expect(shouldAutoStartTour()).toBe(true);
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
