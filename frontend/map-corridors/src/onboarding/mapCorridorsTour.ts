// First-run guided tour for Map Corridors, built on driver.js (MIT, framework-
// agnostic — no React-19 peer-dep risk). Steps mix element-anchored highlights
// (import button, send button, help button — all present at load) with centered
// explanatory steps for features that only exist AFTER the user imports data
// (categorize, set-split), so the tour works on a brand-new empty competition.

import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

/** Bumped if the tour changes materially → re-shows once for returning users. */
export const ONBOARDING_KEY = 'airq.mapCorridors.onboarding.v1';

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Build the ordered tour steps from the i18n translator. Pure + exported so the
 * step set (anchors, order, completeness) is unit-testable without a DOM.
 * Element-less steps render as a centered modal (driver.js behaviour).
 */
export function buildTourSteps(t: T): DriveStep[] {
  return [
    {
      popover: {
        title: t('app.tour.welcome.title'),
        description: t('app.tour.welcome.body'),
      },
    },
    {
      element: '[data-tour="import"]',
      popover: {
        title: t('app.tour.import.title'),
        description: t('app.tour.import.body'),
        side: 'bottom',
        align: 'start',
      },
    },
    {
      popover: {
        title: t('app.tour.categorize.title'),
        description: t('app.tour.categorize.body'),
      },
    },
    {
      popover: {
        title: t('app.tour.split.title'),
        description: t('app.tour.split.body'),
      },
    },
    {
      element: '[data-tour="send"]',
      popover: {
        title: t('app.tour.send.title'),
        description: t('app.tour.send.body'),
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="help"]',
      popover: {
        title: t('app.tour.help.title'),
        description: t('app.tour.help.body'),
        side: 'bottom',
        align: 'end',
      },
    },
  ];
}

/** Start the guided tour now (used by the Help button and first-run). */
export function startMapCorridorsTour(t: T): void {
  const d = driver({
    showProgress: true,
    allowClose: true,
    overlayOpacity: 0.6,
    nextBtnText: t('app.tour.next'),
    prevBtnText: t('app.tour.prev'),
    doneBtnText: t('app.tour.done'),
    steps: buildTourSteps(t),
  });
  d.drive();
}

/** True if the first-run tour hasn't been shown yet (defaults to "show" on any
 *  storage error, but never throws). */
export function shouldAutoStartTour(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) === null;
  } catch {
    return false; // storage unavailable → don't nag
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
