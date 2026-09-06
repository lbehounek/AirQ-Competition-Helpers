import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Identity-stable wrapper around a changing callback — the "useEvent" /
 * latest-ref pattern. The returned function never changes identity but always
 * invokes the most recent `fn`.
 *
 * WHY: parents this package does not always own (AppApi, TurningPointLayout)
 * pass freshly-created inline arrows on every render, which defeats
 * `React.memo` on every child below them. Wrapping once at the grid boundary
 * makes every per-slot prop stable without a custom memo comparator that could
 * hide a stale closure.
 *
 * The ref is updated in `useLayoutEffect`, never during render:
 * eslint-plugin-react-hooks 7 flags render-time ref writes (`react-hooks/refs`)
 * as an error, and a render-phase write is unsafe under concurrent rendering.
 * The corollary is that the wrapper is NOT safe to call during render — it is
 * for event handlers and effects only, where the layout effect has already run.
 *
 * @returns a stable function; calling it returns `fn`'s result, or `undefined`
 * when `fn` is undefined (so an optional handler stays safe to call).
 */
export function useStableCallback<A extends unknown[], R>(
  fn: ((...args: A) => R) | undefined,
): (...args: A) => R | undefined {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current?.(...args), []);
}
