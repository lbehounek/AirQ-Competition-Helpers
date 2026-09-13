# Dashed legs are undrawn scenic legs — no corridor

**Status:** authoring convention for *these* course files, confirmed by Lukáš
2026-09-13. **Not** an FAI rule.

## The rule

In the KML files this app is given, a leg drawn as a **dashed** line is an
**undrawn scenic leg**. It carries **no corridor**.

A solid leg carries a corridor. That is the whole distinction.

## Why this is written down

It existed nowhere. A code review of PR #122 went looking and found:

- The FAI GAC rally, precision and landing rule notes contain **zero**
  occurrences of `corridor`, `scenic`, or `dash`.
- `docs/USER_MANUAL.md` and `.cs.md` — no hits either.
- The three code comments that describe the behaviour
  (`matchPoints.ts`, `extractStartName.ts`, `App.tsx`) all say the corridor was
  *"dropped"* — they record what the pipeline did in May 2026, not a rule.

Worse, the repository briefly documented the **opposite**. The 2.31.1 CHANGELOG
and `CORRIDOR_TP_SKIP.md` both list "no corridor on a dashed leg" as *the defect
being repaired*, and 2.31.1 duly started drawing corridors on all eight MZB legs
when three is correct. 2.31.5 reverses that. Those documents are historical;
**this one is the rule.**

## What counts as dashed

Detection is **pure geometric inference, never a style read**. All 79
`<LineString>` placemarks in `MZB_2026_RED.kml` carry the identical
`<styleUrl>#myStyleLine</styleUrl>` — dashed and solid legs are
indistinguishable in the source markup.

So "dashed" is derived from shape, in `segments.ts`:

| Shape | Repaired? | Dashed? | Corridor |
|---|---|---|---|
| One continuous LineString | n/a | no | **yes** |
| ≥3 short collinear pieces with gaps ≈ the dash length | yes | **yes** | **no** |
| ≥3 short collinear pieces that **touch** (gap ≈ 0) | yes | no | **yes** |
| Long pieces with ~50 m digitising slop | yes | no | **yes** |
| 1–2 isolated short marks | no | no | n/a (decoration) |

**Repair and suppression are separate tests, and conflating them is a defect.**
Every short run is spliced back together so waypoints snap and distances
measure — that is what fixed TP 5 landing 6.4 km off. Only a run whose pieces
are genuinely *separated* is undrawn, and only those lose the corridor.
`MIN_GAP_TO_DASH_RATIO` (0.25) is the discriminator: MZB's real gaps measure
gap/dash = 1.00, touching pieces 0, slop far below 0.25.

## Consequences

- A dashed leg is **measured** (it counts toward course length) but **uncovered**.
- Photos on an uncovered leg attribute by projection rather than containment —
  this is exactly why `coveredLegs` in `matchPoints.ts` is a preference and not
  an exclusion.
- **Gates are independent.** A gate marks 1 NM after a turning point regardless
  of whether the following leg carries a corridor, so MZB shows 8 gates with 3
  corridors. Nothing downstream pairs them; this is pre-existing and correct.

## If this ever changes

It is a per-file convention, so a different organiser could plausibly draw
dashes meaning something else. If a course turns up where dashed legs *should*
carry corridors, that is a new input shape, not a bug in this rule — and it
needs its own fixture before anything here moves.
