/**
 * Photo-helper variant of the discipline parser. Delegates to
 * `@airq/shared-discipline` for the strict allowlist + console.error rule
 * (the canonical implementation), then applies a rally fallback at the
 * boundary because every consumer in this app needs a non-null Discipline:
 *
 *  - `AppApi.tsx` – `isPrecision` flips PDF set2 drop, 9-photo cap, etc.
 *  - `LabelingContext.tsx` – locks labeling to numbers
 *  - `useCompetitionSystem.ts` – gates competition mode
 *
 * The map-corridors app uses the shared parser directly because it has a
 * meaningful third state (null = "use the persisted session discipline").
 *
 * This wrapper exists so existing `import { parseDiscipline } from
 * '../utils/parseDiscipline'` callsites keep working without a sweep.
 */
import { parseDisciplineFromSearch } from '@airq/shared-discipline';
import type { Discipline } from '@airq/shared-discipline';

export type { Discipline } from '@airq/shared-discipline';

export function parseDiscipline(search: string): Discipline {
  return parseDisciplineFromSearch(search) ?? 'rally';
}
