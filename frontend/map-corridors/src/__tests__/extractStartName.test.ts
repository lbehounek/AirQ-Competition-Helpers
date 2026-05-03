import { describe, it, expect } from 'vitest'
import { extractStartName, extractEndName } from '../corridors/extractStartName'

/**
 * Pins the parser at App.tsx:236-239 (now extracted). The 2026-04-26 user
 * feedback was "rally distance from following point, not preceding" —
 * which would manifest here as `extractStartName('1NM-after-TP1→TP2')`
 * returning 'TP2' instead of 'TP1'. The "preceding TP" contract is the
 * load-bearing invariant; everything downstream (haversine distance,
 * answer-sheet "From TP" column) keys off this string.
 */
describe('extractStartName', () => {
  describe('production name shapes (preciseCorridor.ts:281, 292, 376)', () => {
    it('returns "SP" for the {N}NM-after-SP→TP1 corridor (default 5NM)', () => {
      expect(extractStartName('5NM-after-SP→TP1')).toBe('SP')
    })

    it('returns "SP" for the rally 1NM-after-SP→TP1 corridor (use1NmAfterSp toggle)', () => {
      // App.tsx:178-180 emits `1NM-after-SP→TP1` instead of 5NM when the
      // rally `?use1NmAfterSp` user toggle is active. Same SP attribution.
      expect(extractStartName('1NM-after-SP→TP1')).toBe('SP')
    })

    it('returns the PRECEDING TP for {N}NM-after-TPn→TP(n+1) intermediate corridors', () => {
      expect(extractStartName('1NM-after-TP1→TP2')).toBe('TP1')
      expect(extractStartName('1NM-after-TP2→TP3')).toBe('TP2')
      expect(extractStartName('1NM-after-TP9→TP10')).toBe('TP9')
    })

    it('returns the preceding TP for the final-leg {N}NM-after-TPn→FP corridor', () => {
      expect(extractStartName('1NM-after-TP4→FP')).toBe('TP4')
      expect(extractStartName('1NM-after-TP1→FP')).toBe('TP1')
    })
  })

  describe('the "preceding, not following" contract — the 2026-04-26 user complaint', () => {
    // The bug the user reported was "rally distance measured from following
    // point". If this parser ever flipped to extract the post-arrow name,
    // every "From TP" answer-sheet cell would shift one TP forward and
    // every measured distance would be wrong.
    it('NEVER returns the post-arrow (following) TP for after-TPn→TPm names', () => {
      const result = extractStartName('1NM-after-TP1→TP2')
      expect(result).toBe('TP1')
      expect(result).not.toBe('TP2')
    })

    it('NEVER returns the post-arrow target for after-TPn→FP names', () => {
      const result = extractStartName('1NM-after-TP4→FP')
      expect(result).toBe('TP4')
      expect(result).not.toBe('FP')
    })
  })

  describe('fallback semantics — preserves pre-2026-04-26 behavior', () => {
    it('falls back to "SP" for names with no arrow', () => {
      // No `→` means the parser can't determine the preceding TP from
      // the name. The matcher will then either still find a containment
      // hit (using startCoord which is set elsewhere) or fall through to
      // the nearest-corridor cap path.
      expect(extractStartName('TP1')).toBe('SP')
      expect(extractStartName('')).toBe('SP')
    })

    it('returns "SP" when the name itself is "SP" (matches SP branch)', () => {
      expect(extractStartName('SP')).toBe('SP')
    })

    it('falls back to "SP" for unrecognised name shapes (e.g. CP-style authoring)', () => {
      // Some users arrive with KMLs from alternate authoring tools that
      // use "CP n" (Control Point) names. The parser doesn't recognise
      // them and returns the SP fallback rather than throwing.
      expect(extractStartName('CP1→CP2')).toBe('SP')
      expect(extractStartName('Waypoint1→Waypoint2')).toBe('SP')
    })

    it('handles non-string-ish inputs without throwing (defensive String() coercion)', () => {
      // `String(name)` in the parser guarantees no `.split` errors even if
      // upstream hands us a number or null. Behavior is fallback "SP".
      expect(extractStartName(null as unknown as string)).toBe('SP')
      expect(extractStartName(undefined as unknown as string)).toBe('SP')
    })
  })

  describe('edge cases — substring-overlap robustness', () => {
    it('matches "SP" anywhere in the pre-arrow segment, not just at the end', () => {
      // The current implementation uses `includes('SP')` so any pre-arrow
      // substring containing "SP" is attributed to SP. Pinning behavior.
      expect(extractStartName('5NM-after-SP→TP1')).toBe('SP')
    })

    it('uses .pop() after splitting on "after-" so the LAST segment wins', () => {
      // Defensive: if a name contains "after-" twice (shouldn't happen
      // in production but is theoretically possible with custom names),
      // the LAST after- segment is used as the startName.
      expect(extractStartName('1NM-after-something-after-TP3→TP4')).toBe('TP3')
    })
  })
})

// `extractEndName` was added 2026-05-03 follow-up to support filtering
// legs-with-corridors out of the leg-projection fallback. It mirrors
// `extractStartName` but reads the post-arrow side of the corridor name.
describe('extractEndName', () => {
  it('returns the post-arrow target for {N}NM-after-X→Y corridors', () => {
    expect(extractEndName('5NM-after-SP→TP1')).toBe('TP1')
    expect(extractEndName('1NM-after-TP1→TP2')).toBe('TP2')
    expect(extractEndName('1NM-after-TP9→TP10')).toBe('TP10')
    expect(extractEndName('1NM-after-TP4→FP')).toBe('FP')
  })

  it('returns empty string when the name has no arrow', () => {
    // Empty endName signals "no covered pair" to the leg-projection
    // filter — the corresponding leg is left eligible. Safer to leave
    // a leg eligible than to spuriously skip it.
    expect(extractEndName('SP')).toBe('')
    expect(extractEndName('TP1')).toBe('')
    expect(extractEndName('')).toBe('')
  })

  it('trims whitespace around the post-arrow segment', () => {
    expect(extractEndName('1NM-after-TP1→ TP2 ')).toBe('TP2')
  })

  it('handles non-string-ish inputs without throwing', () => {
    expect(extractEndName(null as unknown as string)).toBe('')
    expect(extractEndName(undefined as unknown as string)).toBe('')
  })
})
