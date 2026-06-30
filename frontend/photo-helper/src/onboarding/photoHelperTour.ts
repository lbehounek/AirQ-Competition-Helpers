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
    {
      // Anchored on the real layout selector — "where exactly to change the sheet layout".
      element: '[data-tour="layout"]',
      popover: { title: t('tour.layout.title'), description: t('tour.layout.body'), side: 'bottom', align: 'start' },
    },
    centered('edit'),         // click a photo → in-modal "?" tours every editing tool
    centered('modal'),        // what the in-modal editor tour covers
    centered('labels'),       // label numbering + position
    {
      // Anchored on the real candidate tray (at the top of the page).
      element: '[data-tour="tray"]',
      popover: { title: t('tour.tray.title'), description: t('tour.tray.body'), side: 'bottom', align: 'start' },
    },
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

/**
 * Steps for the in-modal editor tour — runs WHILE the editing modal is open
 * (launched from the modal's "?"), so it anchors on the real, visible editor
 * elements. Pure + exported for tests.
 */
export function buildEditorTourSteps(t: T): DriveStep[] {
  return [
    {
      element: '[data-tour="editor-photo"]',
      popover: {
        title: t('tour.editorTour.photo.title'),
        description: t('tour.editorTour.photo.body'),
        side: 'right',
        align: 'center',
      },
    },
    {
      element: '[data-tour="editor"]',
      popover: {
        title: t('tour.editorTour.controls.title'),
        description: t('tour.editorTour.controls.body'),
      },
    },
    {
      element: '[data-tour="editor-help"]',
      popover: {
        title: t('tour.editorTour.replay.title'),
        description: t('tour.editorTour.replay.body'),
        side: 'bottom',
        align: 'end',
      },
    },
  ];
}

/** Launch the in-modal editor tour (the modal's "?" button). */
export function startEditorModalTour(t: T): void {
  const d = driver({
    showProgress: true,
    allowClose: true,
    overlayOpacity: 0.6,
    nextBtnText: t('tour.next'),
    prevBtnText: t('tour.prev'),
    doneBtnText: t('tour.done'),
    steps: buildEditorTourSteps(t),
  });
  d.drive();
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
