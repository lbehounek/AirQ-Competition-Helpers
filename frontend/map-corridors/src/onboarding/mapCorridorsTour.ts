// First-run guided tour for Map Corridors, built on driver.js (MIT, framework-
// agnostic — no React-19 peer-dep risk). Steps mix element-anchored highlights
// (import button, send button, help button — all present at load) with centered
// explanatory steps for features that only exist AFTER the user imports data
// (categorize, set-split), so the tour works on a brand-new empty competition.

import type { Config, Driver, DriveStep } from 'driver.js';
// The stylesheet stays EAGER (≈3 kB): keeping it in `index-*.css` avoids a
// runtime <style> injection from an async chunk under Electron's `app://`.
import 'driver.js/dist/driver.css';

/** Bumped if the tour changes materially → re-shows once for returning users.
 *  v2: added the keyboard-navigation step (client asked for the map rotation
 *  controls twice — they were shipped but nothing in the app taught them). */
export const ONBOARDING_KEY = 'airq.mapCorridors.onboarding.v2';

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Build the ordered tour steps from the i18n translator. Pure + exported so the
 * step set (anchors, order, completeness) is unit-testable without a DOM.
 * Element-less steps render as a centered modal (driver.js behaviour).
 */
export function buildTourSteps(t: T): DriveStep[] {
  const centered = (key: string): DriveStep => ({
    popover: { title: t(`app.tour.${key}.title`), description: t(`app.tour.${key}.body`) },
  });
  return [
    // Basics first (most important), then the detailed features.
    centered('welcome'),
    {
      element: '[data-tour="import"]',
      popover: {
        title: t('app.tour.import.title'),
        description: t('app.tour.import.body'),
        side: 'bottom',
        align: 'start',
      },
    },
    centered('nogps'),       // drag a no-GPS photo onto the map to give it a location
    centered('categorize'),  // track vs turning; re-sort by dragging between groups
    centered('labels'),      // assign answer-sheet letters in the photo popup
    centered('compare'),     // compare variants of the same point, pick the best
    centered('split'),       // "Set 2 starts at" — where the sheets split (rally)
    centered('maptools'),    // map style, ground markers, print, export KML, answer sheet
    centered('keyboard'),    // arrows pan, Shift|Ctrl+arrows rotate/tilt, N/U/R
    {
      // The primary "Send to editor" button in the right-side panel footer.
      element: '[data-tour="send"]',
      popover: {
        title: t('app.tour.send.title'),
        description: t('app.tour.send.body'),
        side: 'left',
        align: 'end',
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

/**
 * driver.js's `driver` factory, injected into {@link runMapCorridorsTour} so
 * the tour is unit-testable with a fake and so this module never imports
 * driver.js statically. (Same pattern as photo-helper's photoHelperTour.ts.)
 */
export type DriverFactory = (options?: Config) => Driver;

/** Load driver.js (≈26 kB) on demand — one `import()` → one async chunk. */
const loadDriver = (): Promise<DriverFactory> => import('driver.js').then((m) => m.driver);

/**
 * Swallow-and-log a tour start failure. A tour is started from an onClick or a
 * timer, where a rejected promise would be an unhandled rejection: the tour is
 * an optional nicety, so a missing chunk (web build, tab open across a deploy)
 * must never break the click that triggered it.
 */
const onTourFailure = (err: unknown): void => {
  console.error(
    '[onboarding] tour failed to start — on the web build a new version was probably deployed; reload the page',
    err,
  );
};

/**
 * Run the guided tour with an already-loaded driver factory; returns the live
 * `Driver` (so a caller/test can inspect or destroy it). Pure with respect to
 * module state — everything it needs is an argument.
 */
export function runMapCorridorsTour(driver: DriverFactory, t: T): Driver {
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
  return d;
}

/**
 * Start the guided tour now (used by the Help button and first-run). Thin lazy
 * wrapper around {@link runMapCorridorsTour}: driver.js is fetched on demand,
 * so the popover appears once the chunk resolves (ms from disk/cache) instead
 * of synchronously, and a load failure is logged rather than thrown.
 */
export function startMapCorridorsTour(t: T): void {
  void loadDriver()
    .then((driver) => {
      runMapCorridorsTour(driver, t);
    })
    .catch(onTourFailure);
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

/**
 * Schedule the first-run auto-start and return a cleanup. Two correctness rules
 * baked in (PR #109 review):
 *  - "Seen" is marked only when the tour ACTUALLY fires (inside the timer), not
 *    eagerly — so an unmount/cleanup before it fires doesn't permanently mark
 *    the user as onboarded without ever showing the tour.
 *  - The gate is read once at schedule time; callers must run this in a
 *    mount-once effect (stable deps) so a re-render can't cancel-then-skip it.
 * `run` is injected (rather than calling startMapCorridorsTour directly) so the
 * scheduling/marking logic is unit-testable with fake timers.
 */
export function scheduleAutoStartTour(run: () => void, delayMs = 600): () => void {
  if (!shouldAutoStartTour()) return () => {};
  const id = window.setTimeout(() => {
    markTourSeen();
    run();
  }, delayMs);
  return () => window.clearTimeout(id);
}
