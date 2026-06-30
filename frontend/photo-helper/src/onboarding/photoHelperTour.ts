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
 * Build the ordered tour steps from the i18n translator. The "answer sheets"
 * step is discipline-aware: rally has two sheets (Set 1 / Set 2), precision has
 * a single sheet — so the editor's tour must not promise two sets in precision.
 * Pure + exported so the step set is unit-testable without a DOM.
 */
export function buildTourSteps(t: T, isPrecision = false): DriveStep[] {
  const centered = (key: string): DriveStep => ({
    popover: { title: t(`tour.${key}.title`), description: t(`tour.${key}.body`) },
  });
  return [
    // Basics first (most important), then the detailed editor features.
    centered('welcome'),
    {
      // Discipline-aware: rally has Set 1 / Set 2; precision a single sheet.
      popover: {
        title: t(isPrecision ? 'tour.sets.titlePrecision' : 'tour.sets.title'),
        description: t(isPrecision ? 'tour.sets.bodyPrecision' : 'tour.sets.body'),
      },
    },
    centered('layout'),       // portrait (10/page) vs landscape (9/page)
    centered('edit'),         // click a photo to open the editing modal
    centered('modal'),        // the modal's controls: brightness/contrast/…/zoom
    centered('labels'),       // label numbering + position
    centered('tray'),         // candidate tray at the top; drag into slots
    centered('placeholder'),  // "Insert no photo" for a missing turning point
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
export function startPhotoHelperTour(t: T, isPrecision = false): void {
  const d = driver({
    showProgress: true,
    allowClose: true,
    overlayOpacity: 0.6,
    nextBtnText: t('tour.next'),
    prevBtnText: t('tour.prev'),
    doneBtnText: t('tour.done'),
    steps: buildTourSteps(t, isPrecision),
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
