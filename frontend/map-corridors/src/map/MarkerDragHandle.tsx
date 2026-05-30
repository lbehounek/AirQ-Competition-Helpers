import React, { useEffect, useRef } from 'react'
import type { EdgePanDragController } from './useEdgePanDrag'

/**
 * Wraps a marker's visual children and routes their pointer gestures through an
 * {@link EdgePanDragController} (see useEdgePanDrag). Renders a `display: contents`
 * element (no box, so it never affects the marker's layout or label offset) and
 * attaches *native* listeners: `pointerdown` starts the custom drag;
 * `mousedown`/`touchstart`/`click`/`dblclick`/`dragstart` are stopped so they
 * never reach mapbox's canvas-container handlers (which would otherwise pan/zoom
 * the map or fire a map click underneath the marker).
 */
export function MarkerDragHandle(props: {
  controller: EdgePanDragController
  id: string
  lng: number
  lat: number
  onCommit: (lng: number, lat: number) => void
  onClick?: () => void
  clickThresholdPx?: number
  children: React.ReactNode
}): React.ReactElement {
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
      const p = latest.current
      p.controller.startDrag(e, {
        id: p.id,
        lng: p.lng,
        lat: p.lat,
        onCommit: p.onCommit,
        onClick: p.onClick,
        clickThresholdPx: p.clickThresholdPx,
      })
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
