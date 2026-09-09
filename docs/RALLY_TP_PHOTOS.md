# Turning-point photographs are a true/false task, not a measurement

**Status:** domain rule, not a defect report. Written 2026-09-10 after this was
nearly "fixed" as a data defect during the MZB 2026 corridor investigation
([`CORRIDOR_TP_SKIP.md`](./CORRIDOR_TP_SKIP.md)).

**Source:** FAI GAC Rally Flying Rules 2025, **A 3.4 Observation Test** —
A 3.4.3(a) and A 3.4.4.

---

## The rule

A rally competition hands the crew two kinds of photograph, and they work in
opposite directions.

**Turning-point photographs** (A 3.4.3a: min 11, max 17). Some show the real
turning point; some show a feature that is **not within 1.0 NM** of it
(A 3.4.4). The crew decides *correct* or *incorrect* for each and marks a box.
That decision is the task.

**En-route photographs** (A 3.4.3b: min 15, max 20). A ringed target within
300 m of track. The crew locates it and marks its position on the map. These
are the ones scored by distance.

| | TP photographs | En-route photographs |
|---|---|---|
| What the crew does | decides **correct / incorrect** | **locates** the target |
| Scored by distance? | **No** | Yes |
| Correct label | **slot position** (SP, TP1…TPn, FP) | route-ordered answer-sheet letter |
| What its GPS means | nothing — see below | the position being matched |

## Why a TP photograph's EXIF position is meaningless

An *incorrect* TP photograph is deliberately a picture of somewhere else, so its
EXIF position is **expected** to be far from the turning point it is filed
under — and it is often a real feature from elsewhere on the same course.

Measured in the MZB 2026 set (nine photographs, `sp`/`tp1`…`tp7`/`fp`):

| Photo | Distance to its nominal waypoint | Note |
|---|---|---|
| `tp1.JPG` | **16.52 NM** from TP 1 | 0.57 NM from **TP 5**, shot 13 s before `tp5.JPG` |
| `tp7.JPG` | **3.04 NM** from TP 7 | 1.13 NM from FP |
| `tp2`–`tp6`, `fp` | 0.18–0.60 NM | consistent with correct photographs |
| `sp.JPG` | no GPS in EXIF | — |

Two incorrect photographs in a set of nine is the task working exactly as
designed. Reading those distances as a data-entry mistake is the error this
document exists to prevent.

## Consequences for this repository

- **Never GPS-validate a TP photograph** against its waypoint, warn that one
  "looks wrong", or reorder TP photographs by proximity. Any of those hands the
  crew the answer and destroys the observation task.
- The positional `SP / TP1…TPn / FP` labelling in
  `frontend/photo-helper/src/utils/imageProcessing.ts` is **deliberate**: the
  label is the *claim* the crew must verify, not a measurement. The same
  reasoning is why `buildPdfSets.ts` leaves the turning-point branch positional
  while preserving handed-over letters for en-route photos.

## What the code does NOT currently guarantee

Stated plainly because a previous version of this note got it wrong, and an
unverified belief is worse than no belief:

`frontend/map-corridors/src/App.tsx` runs `matchPointsToCorridors` over the
**unfiltered** marker list. `pick-turning` is a flag set in place, not a
removal, so a TP photo marker **does** get a corridor match and an NM distance
computed, and can surface one on the answer sheet if it carries a letter
(`labelToMarker` is built over all markers; the label picker in
`MapProviderView` is not flag-gated).

That number is meaningless for a TP photograph, but nothing today prevents its
computation or display. If it should be excluded, that is a behaviour change —
filter by flag before matching, or gate the answer-sheet row — and it needs its
own regression test asserting a `pick-turning` marker never reaches the matcher.
Not done here; this document only records that the guarantee is absent.

## Related

- [`CORRIDOR_TP_SKIP.md`](./CORRIDOR_TP_SKIP.md) — the corridor investigation
  during which this rule was nearly violated.
- `frontend/map-corridors/src/corridors/matchPoints.ts` — en-route photo → leg
  attribution, and why `coveredLegs` is a tie-break rather than an exclusion.
