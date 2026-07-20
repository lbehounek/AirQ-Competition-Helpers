/**
 * Google-Earth-style keyboard navigation for the corridors map
 * (client request 2026-07: "replicate Google Earth controls — arrow keys,
 * Page Up / Page Down, …").
 *
 * Key map (mirrors Google Earth Pro, with step sizes borrowed from
 * mapbox-gl's built-in KeyboardHandler so the feel matches other GL maps):
 *
 *   Arrows              pan 100 px
 *   Shift + Left/Right  rotate bearing ∓15° (counter-clockwise / clockwise)
 *   Shift + Up/Down     tilt pitch +10° / −10°
 *   PageUp / PageDown   zoom in / out by 1 level
 *   + / −               zoom in / out by 1 level
 *   N                   face north (bearing → 0)
 *   U                   look top-down (pitch → 0)
 *   R                   reset view (north + top-down)
 *
 * Split into a pure `interpretMapKey` (key event → action) and
 * `applyMapKeyAction` (action → camera call) so the key map is unit-testable
 * without a real mapbox-gl Map. The window-level listener lives in
 * MapProviderView — mapbox-gl's own KeyboardHandler only works while the
 * canvas has focus, which it almost never has in this app (users click side
 * panels constantly), so the built-in handler is disabled and this module
 * owns all map keys.
 */

// Step sizes = mapbox-gl KeyboardHandler defaults (100 px / 15° / 10° / 1 zoom).
const PAN_STEP_PX = 100
const BEARING_STEP_DEG = 15
const PITCH_STEP_DEG = 10
const ZOOM_STEP = 1

/**
 * True when a keydown must NOT drive the map. Checked before interpretMapKey
 * so the map never steals keys that belong to another interaction (PR #111
 * review findings F1/F2):
 *
 * - `defaultPrevented` — some component already claimed the key (MUI Select/
 *   MenuList call preventDefault on arrows/Enter/Space but do NOT stop
 *   propagation, so the event still reaches our window listener);
 * - Ctrl/Cmd/Alt combos — browser & system shortcuts (Ctrl+N, Alt+arrows, …);
 * - typing targets — inputs, textareas, selects, contentEditable;
 * - open MUI popups — Select dropdowns, menus, and dialogs render as
 *   divs/lis with ARIA roles (never native <select>/<dialog> elements), and
 *   their type-ahead letters (n/u/r would re-orient the map!) and
 *   focus-trapped arrow keys must win over map navigation while open.
 */
export function shouldIgnoreMapKey(
  e: Pick<KeyboardEvent, 'defaultPrevented' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>,
): boolean {
  if (e.defaultPrevented) return true
  if (e.ctrlKey || e.metaKey || e.altKey) return true
  const el = e.target instanceof HTMLElement ? e.target : null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true
  if (el.closest('[role="dialog"], [role="menu"], [role="listbox"], [role="combobox"]')) return true
  return false
}

export type MapKeyAction =
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'zoom'; delta: number }
  | { type: 'rotate'; delta: number }
  | { type: 'pitch'; delta: number }
  | { type: 'north' }
  | { type: 'topDown' }
  | { type: 'reset' }

/** The subset of KeyboardEvent the key map needs — keeps tests dependency-free. */
export type MapKeyInput = {
  key: string
  shiftKey: boolean
}

/**
 * Map a key press to a camera action, or null when the key isn't ours.
 * Returns null (never throws) for unknown keys so the caller can fall through
 * without preventDefault-ing keys that belong to the browser or other UI.
 * Modifier gating (Ctrl/Cmd/Alt combos, typing in inputs) is the caller's
 * job — this function only sees keys that are already eligible.
 */
export function interpretMapKey(input: MapKeyInput): MapKeyAction | null {
  const { key, shiftKey } = input

  switch (key) {
    // Shift+arrows rotate/tilt (Google Earth & mapbox-gl convention);
    // plain arrows pan. Screen-space pan: dy < 0 moves the view north.
    case 'ArrowUp':
      return shiftKey ? { type: 'pitch', delta: PITCH_STEP_DEG } : { type: 'pan', dx: 0, dy: -PAN_STEP_PX }
    case 'ArrowDown':
      return shiftKey ? { type: 'pitch', delta: -PITCH_STEP_DEG } : { type: 'pan', dx: 0, dy: PAN_STEP_PX }
    case 'ArrowLeft':
      return shiftKey ? { type: 'rotate', delta: -BEARING_STEP_DEG } : { type: 'pan', dx: -PAN_STEP_PX, dy: 0 }
    case 'ArrowRight':
      return shiftKey ? { type: 'rotate', delta: BEARING_STEP_DEG } : { type: 'pan', dx: PAN_STEP_PX, dy: 0 }

    case 'PageUp':
      return { type: 'zoom', delta: ZOOM_STEP }
    case 'PageDown':
      return { type: 'zoom', delta: -ZOOM_STEP }

    // '=' is the physical '+' key unshifted on most layouts — Google Earth
    // (and mapbox-gl) accept it so users don't have to press Shift to zoom.
    case '+':
    case '=':
      return { type: 'zoom', delta: ZOOM_STEP }
    case '-':
    case '_':
      return { type: 'zoom', delta: -ZOOM_STEP }

    case 'n':
    case 'N':
      return { type: 'north' }
    case 'u':
    case 'U':
      return { type: 'topDown' }
    case 'r':
    case 'R':
      return { type: 'reset' }

    default:
      return null
  }
}

/**
 * The camera surface `applyMapKeyAction` drives — structurally satisfied by
 * a real mapbox-gl Map, and trivially mockable in tests.
 */
export type MapCamera = {
  panBy: (offset: [number, number], options?: { duration?: number }) => unknown
  easeTo: (options: { zoom?: number; bearing?: number; pitch?: number; duration?: number }) => unknown
  getZoom: () => number
  getBearing: () => number
  getPitch: () => number
}

/**
 * Apply a key action to the map camera. Returns nothing.
 * Short ease durations keep held-key auto-repeat feeling continuous (each
 * repeat retargets the in-flight ease) instead of stuttering step-by-step.
 * Out-of-range zoom/pitch targets are safe — easeTo clamps to the map's
 * min/max internally, so no clamping here.
 */
export function applyMapKeyAction(map: MapCamera, action: MapKeyAction): void {
  switch (action.type) {
    case 'pan':
      map.panBy([action.dx, action.dy], { duration: 100 })
      break
    case 'zoom':
      map.easeTo({ zoom: map.getZoom() + action.delta, duration: 300 })
      break
    case 'rotate':
      map.easeTo({ bearing: map.getBearing() + action.delta, duration: 300 })
      break
    case 'pitch':
      map.easeTo({ pitch: map.getPitch() + action.delta, duration: 300 })
      break
    case 'north':
      // Same 400 ms ease the compass button uses; easeTo picks the shortest
      // rotation path automatically.
      map.easeTo({ bearing: 0, duration: 400 })
      break
    case 'topDown':
      map.easeTo({ pitch: 0, duration: 400 })
      break
    case 'reset':
      map.easeTo({ bearing: 0, pitch: 0, duration: 400 })
      break
  }
}
