// Single source of truth for the set1/set2 split at a user-chosen ROUTE
// turning point.
//
// The break is a route turning point (e.g. "TP4"), not a photo: "Set 2 starts at
// TP4" means every pick whose position ALONG THE ROUTE is at or after TP4 goes
// to set2, everything before it to set1 — for both track and turning-point
// photos. Each pick is projected onto the route line (turf) to find its
// distance-along-route (chainage), compared against the break TP's chainage.
//
// Both the handoff writer (buildMapPicks → MapPickEntry.set, which the editor
// obeys) and the right-side panel's set1│set2 divider compute membership from
// THIS helper, so the file the editor receives and the boundary the user sees
// in the panel can never disagree. (Route-TP reframe 2026-06-29 — see
// docs/photo-map-culling/set-split-suggestion-plan.md.)

import { isPickFlag } from '@airq/shared-handoff'
import { lineString, nearestPointOnLine, point as turfPoint, length as turfLength } from '@turf/turf'
import type { PhotoMarker } from '../types/markers'
import type { RouteWaypoint } from '../corridors/matchPoints'

export type SetKey = 'set1' | 'set2'

/**
 * Resolve the effective break waypoint name, applying the rally-only rule in
 * ONE place: precision is single-sheet, so it never has a break (→ `null`, i.e.
 * default fill on the wire and no divider in the panel). Both `buildMapPicks`
 * write sites and the `PhotoListPanel` prop go through this so the "no break
 * under precision" rule can't drift between the call sites in App.tsx.
 */
export function resolveSetBreakName(
  effectiveDiscipline: string | null | undefined,
  setBreakWaypointName: string | null | undefined,
): string | null {
  if (effectiveDiscipline === 'precision') return null
  return setBreakWaypointName ?? null
}

/** One option in the "Set 2 starts at …" selector — a route turning point. */
export interface RouteTpOption {
  /** Waypoint name as authored in the KML (e.g. "TP4"). Also the stored break. */
  name: string
}

/**
 * The route turning points the user can split at, in route order. Excludes SP
 * (would put everything in set2 — same as no split) and FP (would leave set2
 * empty). Pure + exported for the panel + tests.
 */
export function listRouteTpOptions(waypoints: readonly RouteWaypoint[]): RouteTpOption[] {
  return waypoints
    .filter(w => w.name !== 'SP' && w.name !== 'FP')
    .map(w => ({ name: w.name }))
}

/** Cumulative distance (km) along the route to each waypoint vertex. */
function waypointChainages(coords: readonly [number, number][]): number[] {
  const ch: number[] = [0]
  for (let i = 1; i < coords.length; i++) {
    ch.push(ch[i - 1] + turfLength(lineString([coords[i - 1], coords[i]])))
  }
  return ch
}

/**
 * Map each pick's photoId to its target sheet, given the chosen break TP.
 *
 * A pick is `set2` when its distance along the route (its GPS projected onto the
 * waypoint line) is at or after the break TP's distance, else `set1`. Track and
 * turning picks share the single geographic cut — the editor routes each into
 * its discipline's set1/set2 by flag, so one global partition is correct for
 * both disciplines.
 *
 * Returns an EMPTY map when there's no break, the route has fewer than two
 * waypoints, or the break name isn't a current waypoint (a stale break) — or
 * names SP/the first vertex (no meaningful split). Callers then fall back to
 * default behavior: the writer emits no `set`, the panel draws no divider.
 *
 * A pick with non-finite coordinates (can't be projected) is kept in `set1`.
 */
export function partitionPicksByRouteTP(
  markers: readonly PhotoMarker[],
  waypoints: readonly RouteWaypoint[],
  breakWaypointName: string | null | undefined,
): Map<string, SetKey> {
  const out = new Map<string, SetKey>()
  if (!breakWaypointName || waypoints.length < 2) return out
  const breakIdx = waypoints.findIndex(w => w.name === breakWaypointName)
  if (breakIdx <= 0) return out // SP (everything set2) or unknown → no split

  const coords = waypoints.map(w => w.coord)
  const line = lineString(coords as [number, number][])
  const breakChainage = waypointChainages(coords)[breakIdx]

  for (const m of markers) {
    if (!m.photoId || !isPickFlag(m.flag)) continue
    if (!Number.isFinite(m.lng) || !Number.isFinite(m.lat)) {
      // Can't project → "no info". Omit it (no `set` emitted) so the editor uses
      // its default fill, rather than silently pinning it to a guessed sheet.
      console.warn('[partitionPicksByRouteTP] pick has non-finite coords; left to default fill:', m.photoId)
      continue
    }
    const projected = nearestPointOnLine(line, turfPoint([m.lng, m.lat])).properties.location
    if (projected == null) {
      console.warn('[partitionPicksByRouteTP] projection yielded no location; left to default fill:', m.photoId)
      continue
    }
    out.set(m.photoId, projected < breakChainage ? 'set1' : 'set2')
  }
  return out
}

/**
 * Index in `orderedPhotoIds` at which to render the "set 2 begins" divider, or
 * -1 for none. The divider sits before the first `set2` photo, but only when at
 * least one `set1` photo precedes it in the SAME list — a group that is wholly
 * set1 or wholly set2 has no within-group boundary and shows no divider.
 *
 * Note: with route-TP membership the panel's filename order need not match route
 * order exactly (a route that doubles back can interleave), so the divider is a
 * best-effort indicator that's exact when filename order tracks route order (the
 * common case). Pure + exported so the boundary rule is unit-tested.
 */
export function setBreakDividerIndex(
  orderedPhotoIds: readonly string[],
  setByPhotoId: ReadonlyMap<string, SetKey>,
): number {
  let sawSet1 = false
  for (let i = 0; i < orderedPhotoIds.length; i++) {
    const set = setByPhotoId.get(orderedPhotoIds[i])
    if (set === 'set1') sawSet1 = true
    else if (set === 'set2' && sawSet1) return i
  }
  return -1
}
