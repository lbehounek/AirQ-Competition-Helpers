import React, { useEffect, useRef } from 'react'
import type { DragHandleConfig, EdgePanDragController } from './useEdgePanDrag'

/**
 * Props are the drag config the controller needs ({@link DragHandleConfig})
 * plus the controller itself and the marker's visual children. Reusing
 * `DragHandleConfig` keeps this in lock-step with the controller's input — a
 * new config field flows here automatically instead of needing a hand-mirrored
 * copy.
 */
export type MarkerDragHandleProps = DragHandleConfig & {
  controller: EdgePanDragController
  children: React.ReactNode
}

/**
 * Wraps a marker's visual children and routes their pointer gestures through an
 * {@link EdgePanDragController} (see useEdgePanDrag). Renders a `display: contents`
 * element (no box, so it never affects the marker's layout or label offset) and
 * attaches *native* listeners: `pointerdown` starts the custom drag;
 * `mousedown`/`touchstart`/`click`/`dblclick`/`dragstart` are stopped so they
 * never reach mapbox's canvas-container handlers (which would otherwise pan/zoom
 * the map or fire a map click underneath the marker).
 */
export function MarkerDragHandle(props: MarkerDragHandleProps): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  // Latest props for the once-attached native listener to read at fire time.
  // Updated in an effect (not during render) so the ref is only written outside
  // render. Safe: pointerdown can only fire after mount + commit.
  const latest = useRef(props)
  useEffect(() => { latest.current = props })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onPointerDown = (e: PointerEvent) => {
      // Primary, left-button only; let secondary buttons/touches fall through.
      if (!e.isPrimary || e.button !== 0) return
      e.stopPropagation()
      // Strip the wrapper-only props; the rest IS a DragHandleConfig.
      const { controller, children, ...cfg } = latest.current
      void children // rendered separately below, not part of the drag config
      controller.startDrag(e, cfg)
    }
    const block = (e: Event) => e.stopPropagation()
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('mousedown', block)
    el.addEventListener('touchstart', block, { passive: true })
    el.addEventListener('click', block)
    el.addEventListener('dblclick', block)
    el.addEventListener('dragstart', block)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('mousedown', block)
      el.removeEventListener('touchstart', block)
      el.removeEventListener('click', block)
      el.removeEventListener('dblclick', block)
      el.removeEventListener('dragstart', block)
    }
  }, [])

  return <div ref={ref} style={{ display: 'contents' }}>{props.children}</div>
}
