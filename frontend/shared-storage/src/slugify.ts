/**
 * Slugify a competition (or any) name for use in exported file names.
 *
 *   "Plzeň 2026"          → "plzen-2026"
 *   "Brno – jaro / 2026"  → "brno-jaro-2026"
 *   "  ___  "             → ""   (caller decides on a fallback)
 *
 * Steps: lowercase → NFD normalise → strip combining marks (diacritics,
 * U+0300..U+036F) → collapse any run of non-alphanumeric characters to a
 * single dash → trim leading/trailing dashes. Returns an empty string when
 * the input slugs down to nothing so callers can fall back to a default
 * filename.
 */
export function slugifyForFilename(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
