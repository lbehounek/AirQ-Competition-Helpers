/**
 * Extract the "preceding TP" startName from a corridor segment name.
 *
 * Corridor names emitted by `preciseCorridor.ts:281, 292, 320, 376` follow
 * the template `{distance}NM-after-{prevTP}→{nextTP}`. The startName is
 * the TP the corridor measures FROM (the PRECEDING point), NOT the
 * corridor's destination — answer-sheet "From TP X / Distance" rows are
 * anchored to the preceding TP's exact track-snapped coordinate.
 *
 * Examples (real shapes from preciseCorridor.ts):
 *   "5NM-after-SP→TP1"   → "SP"   (matched by the SP-special-case branch)
 *   "1NM-after-SP→TP1"   → "SP"   (rally `?use1NmAfterSp` toggle)
 *   "1NM-after-TP1→TP2"  → "TP1"
 *   "1NM-after-TP4→FP"   → "TP4"
 *
 * Fallback to "SP" when the name doesn't match the template (no arrow,
 * no `after-` token, alternate authoring tools that emit `CPn` names).
 * Preserves the pre-2026-04-26 behavior so markers in unrecognised
 * corridors fall back to the SP startCoord, which is always present in
 * the exact-points lookup — no "missing point" branch downstream.
 *
 * Extracted from `App.tsx` (was inline at 236-239) so the contract can
 * be unit-tested directly. The original inline code was wrapped in a
 * `useMemo` callback inside the React component and was therefore
 * structurally untestable — the 2026-04-26 regression test in
 * `matchPointsToCorridors.test.ts` only verified the matcher's echo, not
 * this parser. Splitting into a pure module pins the actual contract.
 */
export function extractStartName(corridorName: string): string {
  const beforeArrow = String(corridorName).split('→')[0] || '';
  if (beforeArrow.includes('SP')) return 'SP';
  if (beforeArrow.includes('after-')) return beforeArrow.split('after-').pop() || 'SP';
  return 'SP';
}

/**
 * Extract the "following TP" endName from a corridor segment name.
 *
 * Mirror of `extractStartName` for the post-arrow side. Used by the
 * leg-projection fallback (feedback 2026-05-03 follow-up): photos
 * outside any polygon must project onto the NEAREST scenic leg —
 * meaning a leg whose corridor was dropped because it's a chain of
 * dashed connectors. To skip legs that already have a corridor we need
 * the (start → end) waypoint pair from each corridor name.
 *
 * Examples (real shapes from preciseCorridor.ts):
 *   "5NM-after-SP→TP1"   → "TP1"
 *   "1NM-after-TP1→TP2"  → "TP2"
 *   "1NM-after-TP4→FP"   → "FP"
 *
 * Returns '' when the name has no arrow (alternate authoring tools, no
 * recognised shape). The leg-projection fallback treats an empty
 * endName as "no covered pair" — the corresponding leg won't be
 * skipped, which is the safe direction to fail.
 */
export function extractEndName(corridorName: string): string {
  const parts = String(corridorName).split('→');
  if (parts.length < 2) return '';
  return (parts[1] || '').trim();
}
