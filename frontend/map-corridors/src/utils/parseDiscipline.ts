/**
 * Map-corridors variant: re-exports the canonical parser from
 * `@airq/shared-discipline` under the legacy local name. The semantics
 * (returns `Discipline | null`) match the shared parser exactly — null
 * lets `App.tsx` fall back to `session?.discipline` (the rally-vs-
 * precision choice persists in the session, not just the URL).
 *
 * Kept as a re-export so existing imports `from '../utils/parseDiscipline'`
 * keep working without a sweep.
 */
export { parseDisciplineFromSearch } from '@airq/shared-discipline'
