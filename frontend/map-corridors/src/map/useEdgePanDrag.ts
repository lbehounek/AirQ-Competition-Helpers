import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MapRef } from 'react-map-gl/mapbox'

/**
 * Edge-pan marker drag.
 *
 * react-map-gl's built-in `draggable` Marker is pointer-event driven: the
 * marker's lng/lat is recomputed only on `pointermove`. That makes it
 * impossible to auto-scroll the map while the user holds the cursor still near
 * a viewport edge — mapbox would re-project the dot at its last *geographic*
 * position and it would slide away from the cursor as the map moves.
 *
 * This hook replaces the native drag with a custom pointer drag that owns the
 * animation loop: while the cursor is within `EDGE_ZONE_PX` of an edge, the map
 * pans every frame and the marker's lng/lat is re-derived from the (stationary)
 * cursor each frame, so the dot stays glued to the cursor while new map area
 * scrolls into view. Lets the user drag a marker anywhere — including off the
 * current screen — in one continuous motion.
 *
 * Used by all four draggable marker types in `MapProviderView` (KML/click,
 * photo, ground, provisional) via the {@link MarkerDragHandle} wrapper.
 */

// How close (px) the cursor must get to an edge before auto-pan kicks in.
export const EDGE_ZONE_PX = 64
// Max pan speed at (or past) the very edge, in px per animation frame (~60fps).
export const MAX_PAN_PX_PER_FRAME = 18
// Below this many px of cursor travel a gesture is treated as a click, not a
// drag — mirrors the 8px threshold the native handlers used.
const DEFAULT_CLICK_THRESHOLD_PX = 8

export type DragHandleConfig = {
  id: string
  /** Marker's true anchor at drag start (not a fan-offset/override position). */
  lng: number
  lat: number
  /** Commit a real move (cursor travelled past the click threshold, or the map
   *  auto-panned during the gesture). */
  onCommit: (lng: number, lat: number) => void
  /** A tap that never crossed the threshold — open a popup, select, etc. */
  onClick?: () => void
  clickThresholdPx?: number
}

export type EdgePanDragController = {
  startDrag: (e: PointerEvent, cfg: DragHandleConfig) => void
}

type DragState = {
  cfg: DragHandleConfig
  pointerId: number
  /** Cursor-to-anchor pixel offset captured at grab time (keeps the grab point
   *  under the cursor as it moves). */
  offsetX: number
  offsetY: number
  startCx: number
  startCy: number
  lastCx: number
  lastCy: number
  vx: number
  vy: number
  raf: number | null
  /** A real move happened (threshold crossed or an auto-pan occurred). */
  moved: boolean
  curLng: number
  curLat: number
}

// Eased 0→1 ramp inside the edge zone; clamps so a cursor *past* the edge
// (negative px or beyond width/height) pins at full speed. Negative result =
// pan toward the low edge (left/top), positive = high edge (right/bottom), 0 =
// outside both zones. Exported for unit tests.
export function edgeVelocity(px: number, size: number): number {
  const ease = (d: number) => {
    const x = Math.min(Math.max(d, 0), 1)
    return x * x
  }
  if (px < EDGE_ZONE_PX) return -ease((EDGE_ZONE_PX - px) / EDGE_ZONE_PX) * MAX_PAN_PX_PER_FRAME
  if (px > size - EDGE_ZONE_PX) return ease((px - (size - EDGE_ZONE_PX)) / EDGE_ZONE_PX) * MAX_PAN_PX_PER_FRAME
  return 0
}

type ActiveDrag = { id: string; lng: number; lat: number } | null

// Builds the stable drag controller once. Every handler closes over the same
// `state` + `mapRef`, so add/removeEventListener stays symmetric. The mutable
// drag state is a plain closure variable (not a React ref) so it's never read
// during render.
function createEdgePanController(
  mapRef: React.RefObject<MapRef | null>,
  setActiveDrag: (d: ActiveDrag) => void,
): EdgePanDragController & { destroy: () => void } {
    let state: DragState | null = null
    const getMap = () => mapRef.current?.getMap() ?? null
    type MapboxMap = NonNullable<ReturnType<typeof getMap>>

    // Re-derive the marker's lng/lat from the current cursor position and the
    // grab offset, then publish it so the marker re-renders under the cursor.
    const syncMarker = (map: MapboxMap, st: DragState) => {
      const rect = map.getCanvas().getBoundingClientRect()
      const px = st.lastCx - rect.left - st.offsetX
      const py = st.lastCy - rect.top - st.offsetY
      const ll = map.unproject([px, py])
      st.curLng = ll.lng
      st.curLat = ll.lat
      setActiveDrag({ id: st.cfg.id, lng: ll.lng, lat: ll.lat })
    }

    const updateVelocity = (map: MapboxMap, st: DragState) => {
      const rect = map.getCanvas().getBoundingClientRect()
      st.vx = edgeVelocity(st.lastCx - rect.left, rect.width)
      st.vy = edgeVelocity(st.lastCy - rect.top, rect.height)
    }

    const tick = () => {
      const st = state
      if (!st) return
      st.raf = null
      const map = getMap()
      if (!map) return
      if (!st.vx && !st.vy) return // idle out; a later pointermove restarts it
      map.panBy([st.vx, st.vy], { duration: 0 })
      st.moved = true // an auto-pan is, by definition, a real move
      syncMarker(map, st) // keep the dot under the (stationary) cursor
      st.raf = requestAnimationFrame(tick)
    }

    const ensureRaf = (st: DragState) => {
      if (st.raf == null && (st.vx || st.vy)) st.raf = requestAnimationFrame(tick)
    }

    const onPointerMove = (e: PointerEvent) => {
      const st = state
      if (!st || e.pointerId !== st.pointerId) return
      const map = getMap()
      if (!map) return
      st.lastCx = e.clientX
      st.lastCy = e.clientY
      syncMarker(map, st)
      const threshold = st.cfg.clickThresholdPx ?? DEFAULT_CLICK_THRESHOLD_PX
      const ddx = e.clientX - st.startCx
      const ddy = e.clientY - st.startCy
      if (!st.moved && ddx * ddx + ddy * ddy >= threshold * threshold) st.moved = true
      updateVelocity(map, st)
      ensureRaf(st)
    }

    const removeWindowListeners = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKeyDown)
    }

    const endDrag = (commit: boolean) => {
      const st = state
      removeWindowListeners()
      if (!st) {
        setActiveDrag(null)
        return
      }
      if (st.raf != null) cancelAnimationFrame(st.raf)
      state = null
      if (commit) {
        if (st.moved) st.cfg.onCommit(st.curLng, st.curLat)
        else st.cfg.onClick?.()
      }
      // On cancel (Escape / blur / pointercancel) we simply drop the override;
      // the marker snaps back to its prop-driven (original) position.
      setActiveDrag(null)
    }

    function onPointerUp(e: PointerEvent) {
      const st = state
      if (st && e.pointerId !== st.pointerId) return
      endDrag(true)
    }
    function onPointerCancel() {
      endDrag(false)
    }
    function onBlur() {
      endDrag(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') endDrag(false)
    }

    const startDrag = (e: PointerEvent, cfg: DragHandleConfig) => {
      const map = getMap()
      if (!map) return
      // Defensively end any prior drag (no stray RAF/listeners).
      if (state) endDrag(false)
      const rect = map.getCanvas().getBoundingClientRect()
      const anchor = map.project([cfg.lng, cfg.lat])
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      state = {
        cfg,
        pointerId: e.pointerId,
        offsetX: cursorX - anchor.x,
        offsetY: cursorY - anchor.y,
        startCx: e.clientX,
        startCy: e.clientY,
        lastCx: e.clientX,
        lastCy: e.clientY,
        vx: 0,
        vy: 0,
        raf: null,
        moved: false,
        curLng: cfg.lng,
        curLat: cfg.lat,
      }
      setActiveDrag({ id: cfg.id, lng: cfg.lng, lat: cfg.lat })
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerCancel)
      window.addEventListener('blur', onBlur)
      window.addEventListener('keydown', onKeyDown)
    }

    return { startDrag, destroy: () => endDrag(false) }
}

export function useEdgePanDrag(mapRef: React.RefObject<MapRef | null>): {
  activeDrag: ActiveDrag
  controller: EdgePanDragController
} {
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null)
  // The controller is built lazily on first use *inside* a callback (never
  // during render), so the ref is only ever touched outside render — keeping
  // the react-hooks/refs rule happy while staying a stable singleton.
  const ctrlRef = useRef<(EdgePanDragController & { destroy: () => void }) | null>(null)
  const getController = useCallback(() => {
    if (!ctrlRef.current) ctrlRef.current = createEdgePanController(mapRef, setActiveDrag)
    return ctrlRef.current
  }, [mapRef, setActiveDrag])

  // Tear down a drag in flight if the map unmounts mid-gesture.
  useEffect(() => () => { ctrlRef.current?.destroy() }, [])

  const controller = useMemo<EdgePanDragController>(
    () => ({ startDrag: (e, cfg) => getController().startDrag(e, cfg) }),
    [getController],
  )
  return { activeDrag, controller }
}
