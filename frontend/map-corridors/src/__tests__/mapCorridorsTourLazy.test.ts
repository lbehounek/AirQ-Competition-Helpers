/**
 * The Map Corridors tour must not pull driver.js into the eager bundle: it is
 * reached through a single `import('driver.js')` inside `startMapCorridorsTour`.
 *
 * The regression guard is `driverEvaluated`: the mock factory flips it the
 * first time the module is actually evaluated, so "false right after importing
 * the tour module" proves there is no static import left. A `vite build` would
 * also catch it (see frontend/vite.chunks.ts), but this fails in seconds.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Config } from 'driver.js';

const state = vi.hoisted(() => ({ driverEvaluated: false }));

/** A stand-in for driver.js's `Driver` — only the methods the tour calls. */
const fake = { drive: vi.fn(), moveNext: vi.fn(), getActiveIndex: vi.fn(), destroy: vi.fn() };
/** The `Config` the tour handed to driver.js, captured by the fake factory. */
let captured: Config | undefined;
const driverMock = vi.fn((options?: Config) => {
  captured = options;
  return fake;
});

vi.mock('driver.js', () => {
  state.driverEvaluated = true;
  return { driver: driverMock };
});
// The stylesheet is imported eagerly on purpose; jsdom cannot parse it.
vi.mock('driver.js/dist/driver.css', () => ({}));

const t = (key: string) => key;

describe('mapCorridorsTour — lazy driver.js', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    state.driverEvaluated = false;
    captured = undefined;
    driverMock.mockImplementation((options?: Config) => {
      captured = options;
      return fake;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not evaluate driver.js when the tour module is imported', async () => {
    await import('../onboarding/mapCorridorsTour');
    expect(state.driverEvaluated).toBe(false);
  });

  it('loads driver.js and drives the tour when started', async () => {
    const tour = await import('../onboarding/mapCorridorsTour');

    expect(tour.startMapCorridorsTour(t)).toBeUndefined();

    await vi.waitFor(() => expect(driverMock).toHaveBeenCalledTimes(1));
    expect(state.driverEvaluated).toBe(true);

    const cfg = captured as Config;
    expect(cfg.steps).toEqual(tour.buildTourSteps(t));
    expect(cfg.nextBtnText).toBe('app.tour.next');
    expect(cfg.prevBtnText).toBe('app.tour.prev');
    expect(cfg.doneBtnText).toBe('app.tour.done');
    expect(cfg.showProgress).toBe(true);
    expect(cfg.allowClose).toBe(true);
    expect(cfg.overlayOpacity).toBe(0.6);
    expect(fake.drive).toHaveBeenCalledTimes(1);
  });

  it('runs with an injected factory without touching driver.js at all', async () => {
    const tour = await import('../onboarding/mapCorridorsTour');
    const local = { drive: vi.fn(), moveNext: vi.fn(), getActiveIndex: vi.fn(), destroy: vi.fn() };
    const factory = vi.fn(() => local);

    const d = tour.runMapCorridorsTour(factory as never, t);

    expect(d).toBe(local);
    expect(local.drive).toHaveBeenCalledTimes(1);
    expect(state.driverEvaluated).toBe(false);
  });

  it('logs — never throws — when the tour cannot start', async () => {
    // A rejected promise escaping here would be an unhandled rejection, which
    // vitest fails the run on: passing is itself part of the assertion.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    driverMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const tour = await import('../onboarding/mapCorridorsTour');

    expect(tour.startMapCorridorsTour(t)).toBeUndefined();

    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(String(error.mock.calls[0][0])).toContain('[onboarding]');
  });

  it('keeps the public surface the App and existing tests rely on', async () => {
    const tour = await import('../onboarding/mapCorridorsTour');

    expect(tour.ONBOARDING_KEY).toBe('airq.mapCorridors.onboarding.v2');
    for (const fn of [
      tour.buildTourSteps,
      tour.startMapCorridorsTour,
      tour.runMapCorridorsTour,
      tour.shouldAutoStartTour,
      tour.markTourSeen,
      tour.scheduleAutoStartTour,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });
});
