import type { Discipline } from '@airq/shared-discipline'

/**
 * Build the browser-fallback href for the "Send to editor" button.
 *
 * WHY this carries `discipline` and not just `competitionId`: photo-helper
 * decides NUMBERED vs LETTERED photo labels and whether a second answer
 * sheet is printed purely from `?discipline=`. In the desktop app the
 * Electron main process stamps that param for us (`navigate-to-app` in
 * desktop/main.js looks the discipline up in the competitions index); the
 * web build has no such launcher, so this function is the only place that
 * can put it on the URL. Omitting it made the editor fall back to rally
 * and print the wrong deliverable for a precision competition — letters
 * instead of numbers, plus a spurious set-2 answer sheet.
 *
 * WHY URLSearchParams instead of template interpolation: it percent-encodes
 * the competition id, so an id containing `&`, `#` or `?` cannot split the
 * query string (which would both break the handoff and let a crafted id
 * smuggle its own `discipline` value past us).
 */
export function buildEditorHref(competitionId: string, discipline: Discipline): string {
  const params = new URLSearchParams({ competitionId, discipline })
  return `/photo-helper/?${params.toString()}`
}
