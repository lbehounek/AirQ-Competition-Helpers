import { DISCIPLINES, type Discipline } from '@airq/shared-discipline';

export const MAX_AGE_DAYS = 30;
export const MAX_COMPETITIONS = 10;
export const COMPETITIONS_INDEX_FILE = 'competitions-index.json';
export const DEFAULT_DISCIPLINE: Discipline = 'rally';
// Alias for the canonical list rather than a second frozen copy.
export const VALID_DISCIPLINES: readonly Discipline[] = DISCIPLINES;
