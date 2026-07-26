/**
 * Boot-time discipline resolution for the editor.
 *
 * The discipline decides NUMBERED vs LETTERED photo labels and whether a
 * second answer sheet is printed — it changes the printed deliverable, so
 * getting it wrong is a real-world failure, not a cosmetic one. Until now
 * it came from `?discipline=` ONLY, so any entry point that lost the param
 * silently downgraded a precision competition to rally.
 *
 * SOURCE OF TRUTH for the fallback: map-corridors' per-competition session,
 * `competitions/{id}/corridors/session.json` -> `.discipline`. That is where
 * the rally/precision toggle already persists (see map-corridors'
 * `useCorridorSessionOPFS.setDiscipline`), so this adds NO new persistence
 * layer — the editor simply reads the record the map app already owns.
 * photo-helper's own records (`competitions-index.json`,
 * `competitions/{id}/session.json`) carry no discipline field at all.
 *
 * WHY THIS RUNS BEFORE REACT MOUNTS (from `main.tsx`) rather than inside a
 * hook: every consumer reads the discipline once at mount —
 * `LabelingProvider` in a `useState` initializer, `AppApi` in a `useMemo`
 * with an empty dep array, and `useCompetitionSystem` in
 * `migrateLegacyPrecisionTitles`, which WRITES the migrated track-set
 * titles back to disk. Resolving asynchronously after mount would relabel a
 * grid the user is already looking at AND could persist rally titles into a
 * precision competition before the correction arrived. A boot gate keeps
 * every consumer synchronous, consistent, and correct on the first frame.
 */
import { initStorage, type StorageInterface } from '@airq/shared-storage';
import { isDiscipline, parseDisciplineFromSearch, type Discipline } from '@airq/shared-discipline';

/** Where map-corridors keeps its per-competition session, relative to `competitions/{id}/`. */
const CORRIDORS_DIR = 'corridors';
const CORRIDORS_SESSION_FILE = 'session.json';

/**
 * Read the discipline map-corridors persisted for `competitionId`.
 * Returns `Discipline | null`; `null` means "we do not know", which the
 * caller turns into the historical rally default. Every failure mode
 * collapses to `null` on purpose:
 *   - no corridors session yet (the user never opened the map app for this
 *     competition) -> `getDirectoryHandle({create:false})` rejects
 *   - OPFS unavailable / private browsing -> `initStorage` rejects
 *   - corrupt or hand-edited value -> fails the shared `isDiscipline`
 *     allowlist (stricter than map-corridors' own load path, which casts)
 *
 * `storage` is injectable so tests can drive it without mocking the module
 * graph — same dependency-injection shape as `syncMapPicksOnce`.
 */
export async function readPersistedDiscipline(
  competitionId: string,
  storage?: StorageInterface,
): Promise<Discipline | null> {
  try {
    // `initStorage`, not `getStorage`: at boot nothing has initialized the
    // singleton yet and `getStorage` throws in that state. `initStorage` is
    // idempotent and is what competitionService uses moments later anyway.
    const store = storage ?? (await initStorage());
    const handles = await store.init();
    // `create: false` on every hop — a read-only boot probe must never
    // materialise directories for a competition that may not exist.
    const competitionsDir = await store.getDirectoryHandle(handles.root, 'competitions', { create: false });
    const compDir = await store.getDirectoryHandle(competitionsDir, competitionId, { create: false });
    const corridorsDir = await store.getDirectoryHandle(compDir, CORRIDORS_DIR, { create: false });
    const session = await store.readJSON<Record<string, unknown>>(corridorsDir, CORRIDORS_SESSION_FILE);
    const raw = session?.discipline;
    return isDiscipline(raw) ? raw : null;
  } catch {
    // A missing directory is the common, expected case (competition created
    // in the editor and never opened on the map). Deliberately silent: this
    // runs on every editor boot, so logging here would cry wolf constantly.
    return null;
  }
}

/**
 * Full boot resolution. The URL wins when present and valid; otherwise fall
 * back to the persisted map-corridors session; otherwise return `null` and
 * let `resolveDiscipline` apply the single rally default.
 *
 * Note the invalid-value path: `parseDisciplineFromSearch` still
 * `console.error`s a bad `?discipline=Precision` (that QA signal is
 * preserved) and returns null, after which we consult the persisted session
 * — strictly better than the previous silent rally.
 */
export async function resolveBootDiscipline(
  search: string,
  storage?: StorageInterface,
): Promise<Discipline | null> {
  // Fast path: valid param present (desktop launcher, and the web handoff
  // once App.tsx stamps it) -> zero storage I/O, zero added boot latency.
  const fromUrl = parseDisciplineFromSearch(search);
  if (fromUrl) return fromUrl;

  const competitionId = new URLSearchParams(search).get('competitionId');
  // Web standalone / no competition selected: nothing to look up, and no
  // competition whose discipline we could get wrong.
  if (!competitionId) return null;

  return readPersistedDiscipline(competitionId, storage);
}
