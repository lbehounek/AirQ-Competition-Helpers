import type { Discipline } from '../corridors/preciseCorridor'

/**
 * Parse the `?discipline=` URL parameter. Returns `null` when the
 * param is absent or invalid so the caller can fall back to the
 * session-level discipline (see `App.tsx` — `effectiveDiscipline`).
 *
 * Invalid non-empty values are logged via `console.error` so a
 * desktop-launcher drift surfaces during QA instead of silently
 * downgrading precision sessions to rally.
 */
export function parseDisciplineFromSearch(search: string): Discipline | null {
  const params = new URLSearchParams(search)
  const d = params.get('discipline')
  if (d === 'precision' || d === 'rally') return d
  if (d !== null && d !== '') {
    console.error(`[parseDiscipline] Invalid ?discipline="${d}"; falling back to session discipline.`)
  }
  return null
}
