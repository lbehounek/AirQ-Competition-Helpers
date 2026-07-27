import { useState } from 'react'
import { createSerialQueue, type SerialQueue } from '../utils/serialQueue'

export type { SerialQueue } from '../utils/serialQueue'

/**
 * React binding: one queue per hook instance, stable for the component's whole
 * lifetime — safe to put in dependency arrays, so callbacks built on it stay
 * stable too (the session hook's setters MUST stay stable; see the note above
 * `setMapStyleId` in useCorridorSessionOPFS and useEditorPicksSync.ts:84-88).
 *
 * `useState` with a lazy initializer rather than a ref. The queue must be built
 * exactly once, which rules out `useState(createSerialQueue())` (evaluates every
 * render, discarding all but the first) — and the `useRef` + "assign on first
 * render" form, while sanctioned by the React docs for expensive objects, reads
 * `ref.current` during render and so trips `react-hooks`'s "Cannot access refs
 * during render" rule. The state value is never set again, so this is a
 * write-once slot with none of that ambiguity. Same shape as `importQueue` in
 * App.tsx.
 *
 * Intentionally NOT drained or reset on unmount: work already handed to the
 * queue should still complete when the user closes the window or switches
 * competitions. Callers that touch React state afterwards must guard that
 * themselves.
 */
export function useSerialQueue(): SerialQueue {
  const [queue] = useState(createSerialQueue)
  return queue
}
