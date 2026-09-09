// One photo marker on the map: the draggable, clickable dot (+ optional label
// chip) that used to be inline JSX inside MapProviderView's marker loop.
//
// WHY it is its own memoized component: the photo pins are the only O(N)
// subtree in the map view. Inline, every MapProviderView render rebuilt N pin
// subtrees (dot + hit halo + label + MarkerDragHandle) — and MapProviderView
// re-renders on every drag frame of a SINGLE pin, every zoom frame that
// recomputes the fan, and (before WP2f) on every App state change. With
// value-comparable props the memo actually hits, so those renders touch only
// the pins whose own values changed.

import { memo, useMemo } from 'react'
import { Marker } from 'react-map-gl/mapbox'
import type { PhotoFlag, PhotoLabel } from '../types/markers'
import type { ClickMods, EdgePanDragController } from './useEdgePanDrag'
import { MarkerDragHandle } from './MarkerDragHandle'
import {
  HIT_HALO_STYLE,
  PHOTO_LABEL_STYLE,
  RAISED_MARKER_STYLE,
  photoMarkerDotStyle,
  photoMarkerRingColor,
} from './photoLayers/photoMarkerStyle'

export type PhotoMarkerPinProps = {
  id: string
  /** True anchor (the marker's committed lng/lat) — what MarkerDragHandle
   *  projects from at grab time. Must NOT be the live drag override, or the dot
   *  jumps by the grab delta the moment the gesture starts. */
  lng: number
  lat: number
  /** Position to DRAW at: the live drag override while this pin is being
   *  dragged, else the same as lng/lat. Passed as primitives so an unrelated
   *  pin's props never change while another one is mid-drag. */
  liveLng: number
  liveLat: number
  label?: PhotoLabel
  flag?: PhotoFlag
  /** Subject coords differ from the EXIF capture point (`isPhotoMoved`) →
   *  solid fill. Computed by the parent so this component stays value-only. */
  moved: boolean
  isActive: boolean
  isSelected: boolean
  /** THIS pin is mid-drag → the fan offset is forced to [0,0] so the dot tracks
   *  the cursor instead of sitting at its fanned position. */
  isDragging: boolean
  /** Auto-fan pixel offset, as two numbers rather than a tuple — memo compares
   *  props by value, and a fresh `[dx,dy]` array would never compare equal.
   *  0/0 when this pin is not part of a fanned cluster. */
  fanDx: number
  fanDy: number
  controller: EdgePanDragController
  onDragEnd?: (id: string, lng: number, lat: number) => void
  onClick: (id: string, mods: ClickMods) => void
}

/**
 * A single photo pin. Every prop is either a primitive or a reference the
 * parent keeps stable, so `memo` skips this whole subtree whenever the parent
 * re-renders for a reason that does not concern this marker.
 *
 * The inner <Marker> still re-renders whenever the pin does (its `children`
 * element is freshly created each time) — that is fine and unavoidable: Marker
 * diffs lngLat and `offset` by value, and `style` by identity, so a re-render
 * with unchanged values performs no imperative map work.
 *
 * Returns the react-map-gl <Marker> element for this photo.
 */
export const PhotoMarkerPin = memo(function PhotoMarkerPin(p: PhotoMarkerPinProps) {
  const ringColor = photoMarkerRingColor(p)
  // Memoized on the four primitives that feed it so the dot div's `style` prop
  // keeps its identity across renders that changed something else (a fan
  // offset, the drag position).
  const dotStyle = useMemo(
    () => photoMarkerDotStyle({ moved: p.moved, ringColor, isActive: p.isActive, isSelected: p.isSelected }),
    [p.moved, ringColor, p.isActive, p.isSelected],
  )
  // ALWAYS a defined tuple. react-map-gl's Marker guards its imperative
  // `setOffset` behind a truthiness check, so a falsy offset is silently
  // ignored and NEVER resets a previously-applied one: a pin that was briefly
  // fanned at low zoom would stay stuck at that offset once it un-fans — the
  // "I placed a photo precisely and it drifts off on zoom-out" bug (see
  // photoLayers/markerOffset.ts for the full write-up). Suppressed to [0,0]
  // while THIS pin is dragged so its dot tracks the cursor without a jump.
  const offset: [number, number] = p.isDragging ? [0, 0] : [p.fanDx, p.fanDy]
  return (
    <Marker
      longitude={p.liveLng}
      latitude={p.liveLat}
      offset={offset}
      // `undefined` (not `{}`) when un-raised: react-map-gl's applyReactStyle
      // returns early on a falsy style and never resets keys it isn't given, so
      // a pin that was once active keeps zIndex:2 in the DOM until unmount.
      // That is today's behaviour and this extraction must stay pixel-identical.
      style={p.isActive || p.isSelected ? RAISED_MARKER_STYLE : undefined}
    >
      {/* MarkerDragHandle attaches its native listeners once and reads its props
          through a `latest` ref at fire time, so these per-render closures are
          both correct and cheap — they are only re-created when this pin itself
          re-renders. NOTE the parent MUST key pins by marker id alone: a changed
          key remounts this handle mid-drag and drops its pointerdown listener. */}
      <MarkerDragHandle
        controller={p.controller}
        id={p.id}
        lng={p.lng}
        lat={p.lat}
        // Real drag → commit the new subject coords; intentionally do NOT
        // auto-open the popup afterwards, so it doesn't interrupt the user who
        // has just placed the subject.
        onCommit={(lng, lat) => p.onDragEnd?.(p.id, lng, lat)}
        // Tap → the parent decides (plain click opens the popup, modifier click
        // toggles the compare selection); the mods are forwarded untouched.
        onClick={(mods) => p.onClick(p.id, mods)}
      >
        <div style={dotStyle}>
          <div style={HIT_HALO_STYLE} />
        </div>
        {p.label && <div style={PHOTO_LABEL_STYLE}>{p.label}</div>}
      </MarkerDragHandle>
    </Marker>
  )
})
