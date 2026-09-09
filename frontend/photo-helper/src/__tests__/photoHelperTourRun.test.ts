/**
 * The tour CHOREOGRAPHY, exercised through the injected driver factory.
 *
 * These branches were previously unreachable from a test (driver.js was a
 * static import that needs a real DOM/overlay): making the factory a parameter
 * of `run*Tour` is what makes the open-editor / close-editor timers, the
 * boolean back-compat arg and `onDestroyed` assertable with a fake.
 *
 * No module mocks are needed here — the module under test never touches
 * driver.js on this path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Config, DriveStep } from 'driver.js';
import {
  buildTourSteps,
  buildEditorTourSteps,
  runPhotoHelperTour,
  runEditorModalTour,
} from '../onboarding/photoHelperTour';

// The stylesheet is imported eagerly by the module under test; jsdom cannot parse it.
vi.mock('driver.js/dist/driver.css', () => ({}));

const t = (key: string) => key;

/** Index of the step that anchors on the photo inside the editor modal. */
const photoIdx = buildTourSteps(t).findIndex((s: DriveStep) => s.element === '[data-tour="editor-photo"]');
/** Index of the step that anchors on the editor controls. */
const controlsIdx = buildTourSteps(t).findIndex((s: DriveStep) => s.element === '[data-tour="editor"]');

describe('runPhotoHelperTour', () => {
  const fake = { drive: vi.fn(), moveNext: vi.fn(), getActiveIndex: vi.fn(), destroy: vi.fn() };
  let captured: Config;
  const factory = vi.fn((cfg?: Config) => {
    captured = cfg as Config;
    return fake;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    captured = {} as Config;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives sane step indices from the real step builder', () => {
    // If these ever go negative the choreography silently stops firing, so the
    // rest of this suite would pass vacuously.
    expect(photoIdx).toBeGreaterThan(0);
    expect(controlsIdx).toBeGreaterThanOrEqual(0);
  });

  it('builds the tour with the injected factory and drives it', () => {
    const d = runPhotoHelperTour(factory as never, t);

    expect(d).toBe(fake);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.drive).toHaveBeenCalledTimes(1);
    expect(captured.steps).toEqual(buildTourSteps(t, false));
  });

  it('accepts a bare boolean as the old isPrecision argument', () => {
    runPhotoHelperTour(factory as never, t, true);

    expect(captured.steps).toEqual(buildTourSteps(t, true));
  });

  it('opens the editor and advances after 450 ms when the modal actually opened', () => {
    const openEditor = vi.fn(() => true);
    const closeEditor = vi.fn();
    runPhotoHelperTour(factory as never, t, { openEditor, closeEditor });
    fake.getActiveIndex.mockReturnValue(photoIdx - 1);

    captured.onNextClick?.(undefined, {} as DriveStep, {} as never);

    expect(openEditor).toHaveBeenCalledTimes(1);
    expect(fake.moveNext).not.toHaveBeenCalled();
    vi.advanceTimersByTime(449);
    expect(fake.moveNext).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fake.moveNext).toHaveBeenCalledTimes(1);
  });

  it('advances on the next tick when no photo could be opened', () => {
    const openEditor = vi.fn(() => false);
    runPhotoHelperTour(factory as never, t, { openEditor });
    fake.getActiveIndex.mockReturnValue(photoIdx - 1);

    captured.onNextClick?.(undefined, {} as DriveStep, {} as never);

    expect(fake.moveNext).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(fake.moveNext).toHaveBeenCalledTimes(1);
  });

  it('closes the editor and advances after 80 ms when leaving the editor section', () => {
    const closeEditor = vi.fn();
    runPhotoHelperTour(factory as never, t, { closeEditor });
    fake.getActiveIndex.mockReturnValue(controlsIdx);

    captured.onNextClick?.(undefined, {} as DriveStep, {} as never);

    expect(closeEditor).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(79);
    expect(fake.moveNext).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fake.moveNext).toHaveBeenCalledTimes(1);
  });

  it('advances synchronously on every other step', () => {
    const openEditor = vi.fn(() => true);
    const closeEditor = vi.fn();
    runPhotoHelperTour(factory as never, t, { openEditor, closeEditor });
    fake.getActiveIndex.mockReturnValue(0);

    captured.onNextClick?.(undefined, {} as DriveStep, {} as never);

    expect(fake.moveNext).toHaveBeenCalledTimes(1);
    expect(openEditor).not.toHaveBeenCalled();
    expect(closeEditor).not.toHaveBeenCalled();
  });

  it('advances synchronously at the editor step when no openEditor was supplied', () => {
    runPhotoHelperTour(factory as never, t);
    fake.getActiveIndex.mockReturnValue(photoIdx - 1);

    captured.onNextClick?.(undefined, {} as DriveStep, {} as never);

    expect(fake.moveNext).toHaveBeenCalledTimes(1);
  });

  it('closes the editor when the tour is destroyed, and tolerates no opts', () => {
    const closeEditor = vi.fn();
    runPhotoHelperTour(factory as never, t, { closeEditor });
    captured.onDestroyed?.(undefined, {} as DriveStep, {} as never);
    expect(closeEditor).toHaveBeenCalledTimes(1);

    runPhotoHelperTour(factory as never, t);
    expect(() => captured.onDestroyed?.(undefined, {} as DriveStep, {} as never)).not.toThrow();
  });
});

describe('runEditorModalTour', () => {
  it('drives the in-modal steps with the injected factory', () => {
    const fake = { drive: vi.fn(), moveNext: vi.fn(), getActiveIndex: vi.fn(), destroy: vi.fn() };
    let captured: Config = {} as Config;
    const factory = vi.fn((cfg?: Config) => {
      captured = cfg as Config;
      return fake;
    });

    const d = runEditorModalTour(factory as never, t);

    expect(d).toBe(fake);
    expect(fake.drive).toHaveBeenCalledTimes(1);
    expect(captured.steps).toEqual(buildEditorTourSteps(t));
  });
});
