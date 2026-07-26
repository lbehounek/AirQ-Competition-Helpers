/**
 * Photo-helper's discipline resolver. Delegates to `@airq/shared-discipline`
 * for the strict allowlist + console.error rule (the canonical
 * implementation), then applies photo-helper's own fallback chain, because
 * every consumer in this app needs a non-null Discipline:
 *
 *  - `AppApi.tsx` – `isPrecision` flips PDF set2 drop, 9-photo cap, etc.
 *  - `LabelingContext.tsx` – locks labeling to numbers
 *  - `useCompetitionSystem.ts` – gates competition mode + the track-set
 *    title migration (which PERSISTS, so a wrong value corrupts state)
 *
 * Chain: `?discipline=` -> boot-resolved persisted value -> `'rally'`.
 *
 * The middle link exists because the URL param is NOT guaranteed. A stale
 * bookmark, a hand-typed URL, or (until the companion fix) the web build's
 * map -> editor handoff all arrive without it, and jumping straight to
 * rally silently downgrades a precision competition: letter labels and a
 * spurious second answer sheet on a PRINTED deliverable.
 * `utils/resolveBootDiscipline.ts` fills the holder from map-corridors'
 * persisted session exactly once, before React mounts — see its docstring
 * for why it has to be boot-time and not a hook.
 *
 * The map-corridors app uses the shared parser directly instead, because it
 * has a meaningful third state (null = "use the persisted session
 * discipline") and reads that session synchronously from its own hook.
 */
import { parseDisciplineFromSearch } from '@airq/shared-discipline';
import type { Discipline } from '@airq/shared-discipline';

export type { Discipline } from '@airq/shared-discipline';

// Module-level on purpose. It is written exactly once by the boot gate in
// `main.tsx` before `createRoot`, then only read. It cannot be React state:
// `LabelingProvider` consumes it inside a `useState` initializer and
// `resolveDefaultLabeling` is a module-scope helper, so both need a plain
// synchronous read that is already correct on the very first render.
let bootDiscipline: Discipline | null = null;

/**
 * Publish the boot-resolved discipline. Called once from `main.tsx` before
 * the first render; pass `null` to clear it (tests, and the "we could not
 * determine it" outcome, which simply leaves the rally default in charge).
 */
export function setBootDiscipline(discipline: Discipline | null): void {
  bootDiscipline = discipline;
}

/**
 * Resolve the active discipline: URL param first (the desktop launcher and
 * map-corridors' "Send to editor" both stamp it and it describes the window
 * the user actually opened), then the boot-resolved persisted value, then
 * the historical `'rally'` default. Synchronous by construction — never
 * returns null, never changes value during a page's lifetime.
 */
export function resolveDiscipline(search: string): Discipline {
  return parseDisciplineFromSearch(search) ?? bootDiscipline ?? 'rally';
}
