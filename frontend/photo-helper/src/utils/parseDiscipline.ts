export type Discipline = 'precision' | 'rally';

/**
 * Parse the `?discipline=` URL parameter emitted by the desktop launcher
 * (see `desktop/main.js`). Accepts only the two exact values; anything
 * else (absent, empty, typo, wrong case) falls back to `rally` — that
 * is the safe default for web / legacy sessions that never saw the
 * launcher.
 *
 * Invalid non-empty values are logged via `console.error` so a launcher
 * drift (e.g. `?Discipline=Precision`) surfaces during QA instead of
 * silently downgrading precision mode to rally.
 *
 * Exposed as a pure function so the browser consumer and tests share
 * the same allowlist.
 */
export function parseDiscipline(search: string): Discipline {
  const params = new URLSearchParams(search);
  const d = params.get('discipline');
  if (d === 'precision' || d === 'rally') return d;
  if (d !== null && d !== '') {
    console.error(`[parseDiscipline] Invalid ?discipline="${d}"; defaulting to rally.`);
  }
  return 'rally';
}
