/**
 * Auto-prefill rules for the rally track-mode set title pair.
 *
 * The track print-header is a two-set affair where set1 covers the
 * first leg and set2 covers the rest:
 *
 *   ┌──────────────┐  ┌──────────────┐
 *   │  SP – TP3    │  │  TP3 – FP    │
 *   └──────────────┘  └──────────────┘
 *      (set 1)            (set 2)
 *
 * When the user customises set1 to indicate the split TP (e.g. types
 * `SP - TP3`), set2 should auto-fill to `TP3 - FP` so the header is
 * coherent without the user having to update both fields.
 *
 * In turning-point mode the relationship is bidirectional — typing
 * either set re-derives the other.
 *
 * The regex `/^SP\s*-\s*TP(\d+)$/i` matches `SP - TP<N>` (case-
 * insensitive, lenient on inner whitespace). The default placeholder
 * `SP - TPX` deliberately does NOT match (`TPX` is not a digit), so
 * the auto-prefill only fires after the user has chosen a real TP
 * number — it never overwrites the user's edits with TPX → FP garbage.
 *
 * Extracted from `AppApi.tsx:316`, `useCompetitionSystem.ts:679`, and
 * `usePhotoSessionOPFS.ts:355-356` so the contract can be unit-tested
 * once and the three call sites stay in lockstep.
 */

/**
 * Match `SP - TP<N>` and capture the TP number, or null if no match.
 * Used by track-mode set1 edits to derive set2.
 */
export function matchSpTpTitle(title: string): string | null {
  const match = title.match(/^\s*SP\s*-\s*TP(\d+)\s*$/i);
  return match ? match[1] : null;
}

/**
 * Match `TP<N> - FP` and capture the TP number, or null if no match.
 * Used by turning-point-mode set2 edits to derive set1.
 */
export function matchTpFpTitle(title: string): string | null {
  const match = title.match(/^\s*TP(\d+)\s*-\s*FP\s*$/i);
  return match ? match[1] : null;
}

/**
 * Given a new set1 title, return the auto-derived set2 title or null
 * when the new title doesn't fit the `SP - TP<N>` pattern.
 *
 *   "SP - TP3"   → "TP3 - FP"
 *   "SP - TPX"   → null  (placeholder, not a real TP number)
 *   "SP-TP10"    → "TP10 - FP"  (lenient on whitespace)
 *   "Custom"     → null
 *
 * Callers should leave set2 untouched when this returns null, so the
 * user's deliberate overrides survive.
 */
export function deriveSet2FromSet1(set1Title: string): string | null {
  const num = matchSpTpTitle(set1Title);
  return num !== null ? `TP${num} - FP` : null;
}

/**
 * Given a new set2 title, return the auto-derived set1 title or null
 * when the new title doesn't fit the `TP<N> - FP` pattern.
 *
 * Used in turning-point mode where the relationship is bidirectional
 * (`usePhotoSessionOPFS.ts:355-372`). Track mode only does set1 → set2.
 */
export function deriveSet1FromSet2(set2Title: string): string | null {
  const num = matchTpFpTitle(set2Title);
  return num !== null ? `SP - TP${num}` : null;
}
