import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildTourSteps,
  shouldAutoStartTour,
  markTourSeen,
  scheduleAutoStartTour,
  ONBOARDING_KEY,
} from '../onboarding/photoHelperTour';
import en from '../locales/en.json';
import cs from '../locales/cs.json';

// Every tour.* key the feature references — steps + driver button labels + the
// Help button. A missing key in either locale renders the raw key to users.
const ALL_TOUR_KEYS = [
  'tour.next', 'tour.prev', 'tour.done',
  'tour.welcome.title', 'tour.welcome.body',
  'tour.sets.title', 'tour.sets.body',
  'tour.edit.title', 'tour.edit.body',
  'tour.tray.title', 'tour.tray.body',
  'tour.export.title', 'tour.export.body',
  'tour.help.title', 'tour.help.body', 'tour.help.button',
];

const echo = (k: string) => k;

function lookup(dict: Record<string, unknown>) {
  return (key: string): string => {
    const v = key.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)?.[part], dict);
    if (typeof v !== 'string') throw new Error(`missing i18n key: ${key}`);
    return v;
  };
}

describe('photoHelper buildTourSteps', () => {
  it('produces the 6 ordered steps with the expected element anchors', () => {
    const steps = buildTourSteps(echo);
    expect(steps).toHaveLength(6);
    expect(steps[4].element).toBe('[data-tour="export"]');
    expect(steps[5].element).toBe('[data-tour="help"]');
    // welcome / sets / edit / tray are centered (data-dependent → no element).
    expect(steps[0].element).toBeUndefined();
    expect(steps[1].element).toBeUndefined();
    expect(steps[2].element).toBeUndefined();
    expect(steps[3].element).toBeUndefined();
  });
});

describe('photoHelper i18n parity — ALL tour keys', () => {
  it.each(['en', 'cs'])('every tour key resolves in %s', (loc) => {
    const get = lookup(loc === 'en' ? en : cs);
    for (const key of ALL_TOUR_KEYS) {
      expect(() => get(key), `missing ${key} in ${loc}`).not.toThrow();
    }
  });
});

describe('photoHelper first-run gate + scheduleAutoStartTour', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('auto-starts when unset, then never again after markTourSeen', () => {
    expect(shouldAutoStartTour()).toBe(true);
    markTourSeen();
    expect(shouldAutoStartTour()).toBe(false);
    expect(window.localStorage.getItem(ONBOARDING_KEY)).not.toBeNull();
  });

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(shouldAutoStartTour()).toBe(false);
  });

  it('fires once after the delay and marks seen only when it fires', () => {
    const run = vi.fn();
    const cleanup = scheduleAutoStartTour(run, 600);
    expect(run).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(ONBOARDING_KEY)).toBeNull();
    vi.advanceTimersByTime(600);
    expect(run).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(ONBOARDING_KEY)).not.toBeNull();
    cleanup();
  });

  it('cleanup before fire cancels it and leaves "seen" unset', () => {
    const run = vi.fn();
    scheduleAutoStartTour(run, 600)();
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
    expect(shouldAutoStartTour()).toBe(true);
  });
});
