# Corridor bug — a turning point is skipped and two non-consecutive TPs are joined

**Status:** diagnosed, not fixed. Reported by Lukáš, investigated 2026-09-06.
**Fix handover:** [issue #117](https://github.com/lbehounek/AirQ-Competition-Helpers/issues/117)
carries the implementation brief as a numbered, checkable list (F1-F8).
**Reported symptom:** "sometimes one TP is skipped, and two non-consecutive TPs
are connected by a corridor." No failing KML was available, so every cause below
was reproduced by constructing input and running the real pipeline.

All line numbers refer to `main` at `d072a93`. Function names are the stable
anchor; prefer them if the file has moved on.

**Answer to the question that prompted this:** yes, scenic routes really are more
exposed, but not because of the `SC` points. They are ignored correctly, and
`RED_SC.kml` produces a perfect result. A scenic course simply has 3–4× more
waypoints and therefore much shorter hops between them, and it loops back on
itself around landmarks. Those two properties are what trip causes A and B below.

---

## How the pipeline works

Recorded here so the next person does not have to re-derive it.

**Parsing.** `parsers/detect.ts` → `parseTextToGeoJSON` hands the file to
`@tmcw/togeojson`, picking KML or GPX by root element and falling back to the
file extension. Everything downstream is GeoJSON, so KML and GPX share one path.

**Geometry classification** (`corridors/segments.ts`):

| Shape | Treated as |
|---|---|
| 3-coordinate LineString | gate candidate, never track |
| 2-point LineString shorter than 500 m | dashed connector, dropped from the main track |
| anything else | main track, concatenated in order |

`buildContinuousTrackWithSources` returns the welded `track` plus `sourceSegIdx`,
`gapAfterIndex` (true where it welded across a discontinuity) and
`mainSegmentIndexSet`.

**Turning point detection** happens in two independent steps, and both are
fragile.

1. *Name.* `findNamedPoints` (`preciseCorridor.ts:99`) keeps Points named `SP`,
   `FP`, and anything matching `/^(TP|CP)\s?\d+\b/i` (line 119). `SC nn` scenic
   points are deliberately not collected. The list is sorted by every digit in
   the name, via `parseInt(name.replace(/\D/g,''))`.
2. *Position.* The label Point in the KML is deliberately offset for
   readability, so it is not the turning point. `attachExact` picks the nearest
   gate candidate within `d2 <= 0.0004` raw squared degrees and intersects it
   with the track; that intersection is the exact turning point. With no
   qualifying gate it falls back to `nearestPointOnLine`.

**Corridors.** `generateSegmentedCorridors` (line 249) builds one leg per
consecutive pair: from the gate 1 NM after a turning point to the next turning
point (5 NM after SP for the first leg). A leg is therefore defined purely by
adjacency in the turning point list, which is why a single dropped or
mis-ordered entry produces exactly the reported symptom.

**Verified-good baseline.** Both shipped files are correct today:

| File | Waypoints | Result |
|---|---|---|
| `RED.kml` | SP, `TP 1`..`TP 5`, FP | 5 TPs, 6 gates, 6+6 corridor segments, monotonic |
| `RED_SC.kml` | SP, `SC 01`..`SC 14` interleaved with `TP1`..`TP5`, FP | same, correct |

`RED_SC.kml` carries 21 gate lines for its 21 waypoints, so scenic points do get
their own gates. That is what makes cause B and the ruled-out gate-stealing
mechanism structurally possible on scenic routes.

Note both naming styles are accepted, `TP 1` with a space and `TP1` without.

---

## Confirmed causes

Ranked by how likely they are to be what you actually hit. Each was reproduced
against the real code; an independent verifier re-built A, B and C from the
recipe and confirmed the symptom.

### A. Genuine short course legs are deleted as "dashed connectors"

**Severity: high. Most likely cause. Scenic-specific in practice.**

Any 2-point LineString under 500 m is dropped from the main track
(`segments.ts:23-26`). When one is a real piece of course, the concatenation
welds the survivors together with a straight chord and sets `gapAfterIndex`.

Two outcomes, both measured:

1. One short piece dropped → the corridor leg into the following turning point
   is silently omitted. Measured on both `RED` and real `RED_SC` geometry: 5 legs
   instead of 6, with `1NM-after-TP 3→TP 4` simply absent.
2. A *run* of short pieces dropped, so a turning point is no longer a vertex of
   any surviving segment → its exact point is dragged onto the chord (measured
   **14.7 km** off) and the corridor is drawn straight across the gap from TP1
   toward TP3, bypassing the real TP2 corner. This is the full reported symptom.

Outcome 2 is only possible because of a precise hole in `isSpanOnMain`
(`preciseCorridor.ts:176`): the `fromIdx === toIdx` early branch checks
`mainSegmentIndexSet` but **never consults `gapAfterIndex`**, so when both ends
of a leg land inside the same gap chord, the guard that exists to suppress
corridors across gaps returns true.

**Fix**

1. Close the hole. In the `fromIdx === toIdx` branch, reject when
   `gapAfterIndex[fromIdx]` is set, exactly as the multi-index loop does. This
   alone downgrades "two TPs joined" to an honest gap.
2. Make the dashed rule discriminating rather than flat. A decorative connector
   is an isolated short line whose endpoints touch nothing; a genuine short hop
   shares an endpoint with its neighbours. Endpoint adjacency within the 50 m
   tolerance already used in `buildContinuousTrackWithSources` would keep
   `RED.kml`'s two 200 m decorations excluded while keeping real hops.
3. Refuse to snap a waypoint into a gap. After snapping, if
   `gapAfterIndex[segmentIndex]` is set, the position is untrustworthy; surface
   it instead of silently using it. A 14.7 km displacement is currently invisible.

### B. The wrong gate intersection is chosen where the route passes near itself

**Severity: high. Also plausible on scenic routes, which loop around landmarks.**

A gate perpendicular reaches **926 m** to each side (measured: every 3-coordinate
line in both shipped files is exactly 926 m per half), so when another leg passes
within that, the gate crosses the track **twice**. `attachExact` then takes
`intersections.features[0]` (`preciseCorridor.ts:459`, with the gate-centre
filter `d2 > 0.0004` at line 449), which is turf's sweepline order and has no
relation to which crossing belongs to this turning point.

Measured: for TP 4 it took the crossing 109 m from the label and discarded the
correct one at 71 m. The exact point lands on the wrong leg, so
`nearestTrackIndex` and `snapPointToTrack` legitimately resolve to a segment on
that wrong leg, and then:

- `buildPreciseSlice` gets `start.segmentIndex > end.segmentIndex`, returns `[]`,
  and the leg `1NM-after-TP 3→TP 4` is **silently dropped**.
- The next leg starts 1 NM after TP **1**, passes `isSpanOnMain`, and draws a
  6-vertex corridor running TP1 → TP2 → TP3 → TP4 → TP5 while labelled
  `1NM-after-TP 4→TP 5`.

Observed output, six legs expected, five produced:

```
"5NM-after-SP→TP1"     5 verts  passes within: TP 1(140m) TP 2(271m) TP 3(199m) TP 4(169m)
"1NM-after-TP 1→TP 2"  3 verts
"1NM-after-TP 2→TP 3"  3 verts
"1NM-after-TP 4→TP 5"  6 verts  passes within: TP 1(123m) TP 2(271m) TP 3(199m) TP 4(300m) TP 5(300m)
"1NM-after-TP 5→FP"    2 verts
*** MISSING: "1NM-after-TP 3→TP 4" ***
```

**Fix**

1. Pick the intersection nearest to the label, not `features[0]`, and reject it
   beyond a sane distance (about 500 m), falling through to the existing
   `nearestPointOnLine` fallback. This alone restores the sixth leg.
2. Defence in depth: enforce monotonicity. SP, TP1..TPn, FP must resolve to
   non-decreasing track indices. Resolve in order and constrain each search to
   the sub-track after the previous waypoint. That structurally forbids a leg
   whose start precedes an earlier waypoint.
3. Never drop a leg silently. Both the empty-slice path and the `continue` in
   the leg loop discard a corridor with no signal; the map just shows a gap.

**Ruled out by measurement:** the missing `cos(latitude)` correction in
`nearestTrackIndex` is *not* the cause. Across 1680 waypoint resolutions the raw
and corrected metrics disagreed 19 times, and in all 19 the raw metric gave the
correct answer. The anisotropy is real (the `d2 <= 0.0004` filter is an ellipse
2.23 km north-south by 1.43 km east-west at 50°N, not the "~2 km" its comment
claims) but it is never the deciding step. Fix it for correctness, not as a fix
for this report.

### C. The turning point name is rejected or mis-sorted

**Severity: medium-high. Matches the "sometimes" intermittency best, since it
depends only on how one placemark was typed.**

*Mode A, dropped.* `/^(TP|CP)\s?\d+\b/i` rejects, silently:

```
TP-3   TP_3   TP.3   "TP  3" (double space — \s? matches at most one)
TP3A   TP 3B  (trailing \b cannot fire between a digit and a letter)
TP #3  OT 3   (Czech otočný bod)   PB 3   "SC TP 3"
```

Renaming exactly one middle TP in `RED.kml` to any of these gives:

```
legs: 5NM-after-SP→TP1 | 1NM-after-TP 1→TP 2 | 1NM-after-TP 2→TP 4 | ...
                                               ^^^^^^^^^^^^^^^^^^^ TP 3 skipped
```

and that merged leg passes **229 m** from the real TP 3, so it flies straight
through the turn. Gates drop 6 → 5.

Accepted variants, for contrast: `tp6`, `TP 06`, `TP 6 SC`, `TP 6 (scenic)`,
`TP 6 ` with trailing space.

*Mode B, mis-sorted.* The sort key concatenates every digit run, so `TP3 SC03`
becomes 303 and sorts to the end. Result: `1NM-after-TP 2→TP 4` (non-consecutive)
plus `1NM-after-TP3 SC03→FP` (the displaced TP wired to the finish), and the
`TP 5→…` leg vanishes because that span runs backward. Also affects `TP3/1`,
`TP 3-1`, `TP 3.1`.

This is the second, indirect way scenic routes are exposed: annotations like
`TP3 SC03` are exactly what an organiser adds on a scenic course.

**Fix**

1. Widen the pattern and take the sort key from the captured number, not a digit
   strip. Something like `/^(TP|CP)[\s\-_.\/#]*(\d+)(?:\D.*)?$/i`, sorting by the
   capture and then by suffix so `TP 3` < `TP 3A`. Whether to accept `OT`/`PB` is
   a product call: do Czech organiser files really use them?
2. De-duplicate the two identical sort blocks (lines 125-129 and 488-492) into
   one comparator. They are literal copies, and `buildPreciseCorridorsAndGates`
   pairs `named.tps[i]` with `tps[i]` positionally (line 523), so fixing one only
   would be a new alignment bug.
3. **Make the drop loud.** This is what turns "sometimes a TP is skipped" into
   something diagnosable. Collect Point names that matched neither SP/FP/SC nor
   the TP pattern and surface them ("2 placemarks were not recognised as turning
   points: 'TP-3', 'OT 4'"). Separately, before building leg *i*, assert that the
   numbers of `tps[i-1]` and `tps[i]` are consecutive and warn when they are not.

### D. The gate offset overshoots a short leg

**Severity: medium. Produces a dropped leg, not a merged one, so it is not the
reported symptom — but it is a real defect on the same code path.**

The gate sits a fixed 1 NM (1852 m) after each turning point, 5 NM after SP,
with no clamp against where the *next* waypoint is.

- One leg between 1800 m and 400 m: the gate lands past the next TP, both snap to
  the same segment index, and the leg becomes a two-point stub running
  **backwards**. All six legs still present, one of them nonsense.
- Two consecutive legs summing under 1 NM: `start.segmentIndex > end.segmentIndex`,
  the slice is empty, and **both** legs vanish. Four legs instead of six, with two
  TPs reached by no corridor at all.

The SP case is worse and more realistic: any first leg shorter than 5 NM does the
same thing.

**Fix:** clamp the walk to `min(offset, legLength - margin)` so a gate always
stays on the leg it belongs to, for both the SP and TP offsets. And never
silently drop a leg between consecutive TPs.

---

## Ruled out

Recorded so nobody re-investigates these.

- **Scenic gate stealing a turning point.** The mechanism is real: the
  `d2 <= 0.0004` window is 2.2 km north-south and can let a scenic gate win, and
  it can also disqualify the TP's *own* gate when the label is displaced far
  enough. But reproducing the reported symptom needed contrived input, and the
  verifier rated it contrived. Worth fixing as hygiene (measure in metres, select
  on the resulting intersection rather than the gate centre), not as the cause.
- **Gate/waypoint index desync.** Not reproducible, and the premise is false:
  `pointAtDistanceAlongTrack` declares `| null` but contains **no `return null`
  path**. It clamps to the last vertex. So the `if (spNmResult)` and
  `if (tpNmResult)` guards are always true and `gatePositions.length` is always
  `1 + tps.length`. Two cheap hardenings anyway: drop the lying `| null`, and
  guard `track.length < 2`, which today throws a TypeError via `track[-1]`.

---

## Unrelated bug found on the way

**GPX with multiple `<trkseg>` in one `<trk>` crashes the whole build.**
`@tmcw/togeojson` converts it to a `MultiLineString`; `extractAllSegments`
(`segments.ts:46`) only recognises `LineString`, so it returns zero segments
and `buildPreciseCorridorsAndGates` throws `coordinates must be an array of two
or more positions` out of turf. Nothing renders.

That is the normal shape emitted by any GPS that pauses recording, and by many
planners. Single-`<trkseg>` GPX, multiple `<trk>` elements, and `<rte>` all work
correctly, so this is specifically the multi-segment case.

**Fix:** handle `MultiLineString` in `extractAllSegments` by pushing one segment
per member line, in order (a two-line change, and it also makes KML
`<MultiGeometry>` work). Separately, have `buildPreciseCorridorsAndGates` return
an empty result with a diagnostic when `track.length < 2` instead of letting turf
throw something opaque.

---

## Suggested order of work

Tracked as F1-F8 in [issue #117](https://github.com/lbehounek/AirQ-Competition-Helpers/issues/117),
which restates each item with its acceptance test. The list below is the rationale
for the ordering.

1. **A.1** — the `isSpanOnMain` gap hole. One condition, turns the worst
   rendering into an honest gap.
2. **B.1** — nearest intersection instead of `features[0]`. Small, restores the
   missing leg in the repro.
3. **C.3 and B.3** — make dropped waypoints and dropped legs *loud*. Neither is a
   fix, but together they convert every remaining variant of this bug from
   "sometimes the map looks wrong" into a named warning. Highest diagnostic value
   per line changed.
4. **C.1/C.2** — widen the name pattern, fix the sort key, de-duplicate the
   comparator.
5. **D** — clamp the gate offset to its leg.
6. **GPX MultiLineString** — two lines, prevents a hard crash on common input.
7. **A.2** — discriminating dashed-connector rule. Most invasive; do it last and
   check `RED.kml` still excludes its two 200 m decorations.
8. Hygiene, not fixes: metres instead of raw degrees in the gate window,
   `cos(latitude)` in `nearestTrackIndex`, honest `pointAtDistanceAlongTrack`
   signature.

Every fix needs a regression test. The package has vitest with jsdom
(`pnpm --filter @airq/map-corridors test`), and 65 test files already.

## How to reproduce any of this locally

There is no fixture for these cases yet; each was built by mutating a shipped
file. The harness pattern:

```ts
import { parseTextToGeoJSON } from '../parsers/detect'
import { buildPreciseCorridorsAndGates, findNamedPoints } from '../corridors/preciseCorridor'

const kml = fs.readFileSync('RED.kml', 'utf8').replace('<name>TP 3</name>', '<name>TP-3</name>')
const gj = parseTextToGeoJSON(kml, 'probe.kml')
const built = buildPreciseCorridorsAndGates(gj)
console.log(built.leftSegments.map(s => s.properties?.segment))
```

The leg names in `properties.segment` are the fastest signal: a correct route
yields exactly `5NM-after-SP→TP1` followed by one `1NM-after-TP n→TP n+1` per
turning point and a final `→FP`. Anything naming a non-consecutive pair, or a
missing leg, is the bug.

`computeExactWaypoints` is **not** exported; go through
`buildPreciseCorridorsAndGates` and read its `exactPoints` instead.

## Related

- `doc/KML_PARSING.md` — the original as-built parsing reference. Still broadly
  accurate; it does not cover any of the failure modes above.
- `docs/TECH_DEBT.md` — for anything deferred out of the fix list.
