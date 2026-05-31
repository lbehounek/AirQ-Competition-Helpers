// Resolve the pixel offset handed to a react-map-gl <Marker>/<Popup>.
//
// WHY THIS EXISTS — a subtle wrapper bug we must defend against:
// The `@vis.gl/react-mapbox` <Marker> and <Popup> components guard their
// imperative `setOffset` call behind a truthiness check:
//
//     if (offset && !arePointsEqual(marker.getOffset(), offset)) marker.setOffset(offset)
//
// So a FALSY offset (`undefined`/`null`) is silently ignored — it never resets
// a previously-applied offset. The auto-fan only emits an offset for markers
// that are currently part of an overlapping cluster; an un-clustered marker has
// no entry in the offsets map (`.get` → undefined). Passing that undefined
// straight through means a marker that was briefly fanned at low zoom (where
// far-apart photos collide in screen pixels) stays stuck at its last fan offset
// once it un-fans — drifted off its true lng/lat, with no leader line to
// explain it. That was the "I placed a photo precisely and it moves vs. the map
// on zoom-out" bug.
//
// Returning an explicit [0,0] makes the offset a real, comparable value: the
// wrapper's `arePointsEqual([0,0], <stale Point>)` is false, so `setOffset`
// fires and snaps the marker back to its anchor.

/** Fan offset for a marker, or [0,0] when it isn't fanned. Never returns
 *  undefined — see the module note for why a falsy offset is a bug. */
export function resolveFanOffset(
  offset: readonly [number, number] | undefined,
): [number, number] {
  return offset ? [offset[0], offset[1]] : [0, 0]
}
