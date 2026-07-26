/**
 * Google-Earth-style keyboard navigation for the corridors map
 * (client request 2026-07: "replicate Google Earth controls — arrow keys,
 * Page Up / Page Down, …").
 *
 * Key map (mirrors Google Earth Pro, with step sizes borrowed from
 * mapbox-gl's built-in KeyboardHandler so the feel matches other GL maps):
 *
 *   Arrows                    pan 100 px
 *   Shift|Ctrl + Left/Right   rotate bearing ∓15° (counter-clockwise / clockwise)
 *   Shift|Ctrl + Up/Down      tilt pitch +10° / −10°
 *   PageUp / PageDown         zoom in / out by 1 level
 *   + / −                     zoom in / out by 1 level
 *   N                         face north (bearing → 0)
 *   U                         look top-down (pitch → 0)
 *   R                         reset view (north + top-down)
 *
 * Ctrl+arrows are an alias for Shift+arrows (client request 2026-07-23:
 * "Ctrl + arrow for rotating the map does not work"). Google Earth documents
 * Shift+arrows for keyboard rotate/tilt — which is what we shipped — but it
 * also uses Ctrl+drag as the mouse look-around gesture, so organizers reach
 * for Ctrl first. Both work now. Shift stays the primary binding because
 * macOS swallows Ctrl+←/→ for Mission Control space switching.
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
 * The only keys Ctrl may modify (Ctrl+arrows = rotate/tilt). Every other Ctrl
 * combo stays reserved for the browser/Electron — Ctrl+R reload, Ctrl+N new
 * window, Ctrl+U view-source, Ctrl+PageUp/PageDown tab switching, Ctrl +/−/0
 * zoom — several of which collide with our own single-letter map keys.
 */
const CTRL_ELIGIBLE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

/**
 * True when a keydown must NOT drive the map. Checked before interpretMapKey
 * so the map never steals keys that belong to another interaction (PR #111
 * review findings F1/F2):
 *
 * - `defaultPrevented` — some component already claimed the key (MUI Select/
 *   MenuList call preventDefault on arrows/Enter/Space but do NOT stop
 *   propagation, so the event still reaches our window listener);
 * - Cmd/Alt combos — browser & system shortcuts (Alt+arrows are the app's own
 *   back/forward menu accelerators). Alt is checked unconditionally on
 *   purpose: AltGr reports ctrlKey+altKey together on Czech/EU layouts, so
 *   typing an AltGr character must never rotate the map;
 * - Ctrl combos other than Ctrl+arrows — see CTRL_ELIGIBLE_KEYS;
 * - typing targets — inputs, textareas, selects, contentEditable (this is what
 *   keeps Ctrl+←/→ working as word-wise caret movement while renaming a photo);
 * - open MUI popups — Select dropdowns, menus, and dialogs render as
 *   divs/lis with ARIA roles (never native <select>/<dialog> elements), and
 *   their type-ahead letters (n/u/r would re-orient the map!) and
 *   focus-trapped arrow keys must win over map navigation while open.
 */
export function shouldIgnoreMapKey(
  e: Pick<KeyboardEvent, 'defaultPrevented' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>,
): boolean {
  if (e.defaultPrevented) return true
  if (e.metaKey || e.altKey) return true
  if (e.ctrlKey && !CTRL_ELIGIBLE_KEYS.has(e.key)) return true
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
  ctrlKey: boolean
}

/**
 * Map a key press to a camera action, or null when the key isn't ours.
 * Returns null (never throws) for unknown keys so the caller can fall through
 * without preventDefault-ing keys that belong to the browser or other UI.
 * Modifier gating (Cmd/Alt combos, non-arrow Ctrl combos, typing in inputs) is
 * the caller's job via shouldIgnoreMapKey — this function only sees keys that
 * are already eligible.
 */
export function interpretMapKey(input: MapKeyInput): MapKeyAction | null {
  const { key, shiftKey, ctrlKey } = input
  // Either modifier turns an arrow from "pan" into "rotate/tilt" — Shift is the
  // Google Earth keyboard convention, Ctrl is the alias organizers expect from
  // Google Earth's Ctrl+drag look-around gesture.
  const orbits = shiftKey || ctrlKey

  switch (key) {
    // Modified arrows rotate/tilt; plain arrows pan.
    // Screen-space pan: dy < 0 moves the view north.
    case 'ArrowUp':
      return orbits ? { type: 'pitch', delta: PITCH_STEP_DEG } : { type: 'pan', dx: 0, dy: -PAN_STEP_PX }
    case 'ArrowDown':
      return orbits ? { type: 'pitch', delta: -PITCH_STEP_DEG } : { type: 'pan', dx: 0, dy: PAN_STEP_PX }
    case 'ArrowLeft':
      return orbits ? { type: 'rotate', delta: -BEARING_STEP_DEG } : { type: 'pan', dx: -PAN_STEP_PX, dy: 0 }
    case 'ArrowRight':
      return orbits ? { type: 'rotate', delta: BEARING_STEP_DEG } : { type: 'pan', dx: PAN_STEP_PX, dy: 0 }

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
