/**
 * Slugify a competition (or any) name for use in exported file names.
 *
 *   "Plzeň 2026"          → "plzen-2026"
 *   "Brno – jaro / 2026"  → "brno-jaro-2026"
 *   "  ___  "             → ""   (caller decides on a fallback)
 *   "Москва 2026"         → "2026"  (Cyrillic letters dropped — see below)
 *   "北京"                 → ""     (non-Latin scripts collapse to empty)
 *
 * Steps: lowercase → NFD normalise → strip combining marks (diacritics,
 * U+0300..U+036F) → collapse any run of non-`[a-z0-9]` characters to a
 * single dash → trim leading/trailing dashes. Returns an empty string when
 * the input slugs down to nothing so callers can fall back to a default
 * filename.
 *
 * Scope: this handles Latin diacritics (Czech/Slovak š,č,ř,ž,ý,á,í,é,ú,ů,ó,
 * ď,ť,ň,ľ,ĺ,ŕ, plus all other NFD-decomposable Latin scripts). Non-Latin
 * scripts (Cyrillic, Greek, CJK, Arabic, …) are NOT transliterated — they
 * are simply dropped, since transliteration is locale-dependent and a
 * filename slug isn't the right layer to encode language policy. Callers
 * MUST check for an empty result and fall back to a default filename when
 * the source is non-Latin only.
 */
export function slugifyForFilename(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
