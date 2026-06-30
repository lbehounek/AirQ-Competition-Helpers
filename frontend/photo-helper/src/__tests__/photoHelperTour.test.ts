import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildTourSteps,
  buildEditorTourSteps,
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
  'tour.sets.titlePrecision', 'tour.sets.bodyPrecision',
  'tour.layout.title', 'tour.layout.body',
  'tour.edit.title', 'tour.edit.body',
  'tour.modal.title', 'tour.modal.body',
  'tour.labels.title', 'tour.labels.body',
  'tour.tray.title', 'tour.tray.body',
  'tour.placeholder.title', 'tour.placeholder.body',
  'tour.export.title', 'tour.export.body',
  'tour.help.title', 'tour.help.body', 'tour.help.button',
  'tour.editorTour.photo.title', 'tour.editorTour.photo.body',
  'tour.editorTour.controls.title', 'tour.editorTour.controls.body',
  'tour.editorTour.replay.title', 'tour.editorTour.replay.body',
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
  it('produces the ordered steps with the expected element anchors', () => {
    const steps = buildTourSteps(echo);
    expect(steps).toHaveLength(10);
    // Anchored on real controls (visual, not just descriptive).
    expect(steps[2].element).toBe('[data-tour="layout"]');
    expect(steps[6].element).toBe('[data-tour="tray"]');
    expect(steps[8].element).toBe('[data-tour="export"]');
    expect(steps[9].element).toBe('[data-tour="help"]');
    // The remaining detailed steps are centered (no element).
    for (const i of [0, 1, 3, 4, 5, 7]) {
      expect(steps[i].element, `step ${i} should be centered`).toBeUndefined();
    }
  });

  it('the in-modal editor tour anchors on the real modal elements', () => {
    const steps = buildEditorTourSteps(echo);
    expect(steps.map((s) => s.element)).toEqual([
      '[data-tour="editor-photo"]',
      '[data-tour="editor"]',
      '[data-tour="editor-help"]',
    ]);
  });

  it('the answer-sheets step is discipline-aware (rally vs precision keys)', () => {
    expect(buildTourSteps(echo, false)[1].popover?.title).toBe('tour.sets.title');
    expect(buildTourSteps(echo, false)[1].popover?.description).toBe('tour.sets.body');
    expect(buildTourSteps(echo, true)[1].popover?.title).toBe('tour.sets.titlePrecision');
    expect(buildTourSteps(echo, true)[1].popover?.description).toBe('tour.sets.bodyPrecision');
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
