import { useRef } from 'react'
import { createSerialQueue, type SerialQueue } from '../utils/serialQueue'

export type { SerialQueue } from '../utils/serialQueue'

/**
 * React binding: one queue per hook instance, stable for the component's whole
 * lifetime — safe to put in dependency arrays, so callbacks built on it stay
 * stable too (the session hook's setters MUST stay stable; see the note above
 * `setMapStyleId` in useCorridorSessionOPFS and useEditorPicksSync.ts:84-88).
 *
 * Created lazily rather than as `useRef(createSerialQueue())` because useRef
 * evaluates its argument on EVERY render and keeps only the first value — the
 * rest would be pure garbage.
 *
 * Intentionally NOT drained or reset on unmount: work already handed to the
 * queue should still complete when the user closes the window or switches
 * competitions. Callers that touch React state afterwards must guard that
 * themselves.
 */
export function useSerialQueue(): SerialQueue {
  const ref = useRef<SerialQueue | null>(null)
  if (!ref.current) ref.current = createSerialQueue()
  return ref.current
}
