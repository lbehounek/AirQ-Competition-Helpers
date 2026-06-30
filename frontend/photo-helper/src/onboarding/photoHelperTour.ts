// First-run guided tour for Photo Helper (the editor), built on driver.js
// (MIT, framework-agnostic). Mirrors the Map Corridors tour: element-anchored
// steps where the target exists at load (export, help), centered explanatory
// steps for the sets / editing / tray which depend on the user's data — so the
// tour works on a brand-new empty session. See mapCorridorsTour.ts.

import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

/** Bumped if the tour changes materially → re-shows once for returning users. */
export const ONBOARDING_KEY = 'airq.photoHelper.onboarding.v1';

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Build the ordered tour steps from the i18n translator. Pure + exported so the
 * step set (anchors, order, completeness) is unit-testable without a DOM.
 */
export function buildTourSteps(t: T): DriveStep[] {
  return [
    {
      popover: {
        title: t('tour.welcome.title'),
        description: t('tour.welcome.body'),
      },
    },
    {
      popover: {
        title: t('tour.sets.title'),
        description: t('tour.sets.body'),
      },
    },
    {
      popover: {
        title: t('tour.edit.title'),
        description: t('tour.edit.body'),
      },
    },
    {
      popover: {
        title: t('tour.tray.title'),
        description: t('tour.tray.body'),
      },
    },
    {
      element: '[data-tour="export"]',
      popover: {
        title: t('tour.export.title'),
        description: t('tour.export.body'),
        side: 'bottom',
        align: 'end',
      },
    },
    {
      element: '[data-tour="help"]',
      popover: {
        title: t('tour.help.title'),
        description: t('tour.help.body'),
        side: 'bottom',
        align: 'end',
      },
    },
  ];
}

/** Start the guided tour now (used by the Help button and first-run). */
export function startPhotoHelperTour(t: T): void {
  const d = driver({
    showProgress: true,
    allowClose: true,
    overlayOpacity: 0.6,
    nextBtnText: t('tour.next'),
    prevBtnText: t('tour.prev'),
    doneBtnText: t('tour.done'),
    steps: buildTourSteps(t),
  });
  d.drive();
}

/** True if the first-run tour hasn't been shown yet (never throws). */
export function shouldAutoStartTour(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) === null;
  } catch {
    return false;
  }
}

/** Mark the first-run tour as shown so it won't auto-start again. */
export function markTourSeen(): void {
  try {
    window.localStorage.setItem(ONBOARDING_KEY, new Date().toISOString());
  } catch {
    /* best-effort */
  }
}

/**
 * Schedule the first-run auto-start and return a cleanup. "Seen" is marked only
 * when the tour ACTUALLY fires (inside the timer), and the gate is read once at
 * schedule time — callers must run this in a mount-once effect. (Same contract
 * as Map Corridors; see its review note about the [t]-identity re-render bug.)
 */
export function scheduleAutoStartTour(run: () => void, delayMs = 600): () => void {
  if (!shouldAutoStartTour()) return () => {};
  const id = window.setTimeout(() => {
    markTourSeen();
    run();
  }, delayMs);
  return () => window.clearTimeout(id);
}
