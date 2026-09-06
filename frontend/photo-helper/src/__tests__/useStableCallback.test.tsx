import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { useStableCallback } from '../hooks/useStableCallback';

afterEach(cleanup);

/**
 * Module-level recorder rather than a prop: the react-compiler lint rules
 * reject writing to a value that arrived as a prop, and keeping it out of the
 * props also keeps `MemoChild`'s prop set down to the one thing under test.
 */
let seen = {
  identities: new Set<unknown>(),
  renders: 0,
  latest: null as ((value: number) => number | undefined) | null,
};

/** Records every wrapper identity it is handed, plus its own render count. */
const MemoChild = React.memo(function MemoChild({
  onAction,
}: {
  onAction: (value: number) => number | undefined;
}) {
  // From an effect, not the render body — an effect with no dep array runs once
  // per render of this component, which is exactly the count we want.
  React.useEffect(() => {
    seen.identities.add(onAction);
    seen.renders += 1;
    seen.latest = onAction;
  });
  return <div data-testid="child" />;
});

function Parent({ fn }: { fn: ((value: number) => number) | undefined }) {
  const stable = useStableCallback(fn);
  return <MemoChild onAction={stable} />;
}

beforeEach(() => {
  seen = { identities: new Set<unknown>(), renders: 0, latest: null };
});

describe('useStableCallback', () => {
  it('keeps one identity across re-renders with a different fn, and does not re-render a memoized child', () => {
    const first = vi.fn((value: number) => value * 2);
    const second = vi.fn((value: number) => value * 3);

    const { rerender } = render(<Parent fn={first} />);
    rerender(<Parent fn={second} />);
    rerender(<Parent fn={undefined} />);

    expect(seen.identities.size).toBe(1);
    // The memo child never re-rendered, which is the whole point: this is what
    // lets PhotoGridSlot/PhotoEditorApi skip when only the parent's closures changed.
    expect(seen.renders).toBe(1);
  });

  it('invokes the LATEST fn and returns its value', () => {
    const first = vi.fn((value: number) => value * 2);
    const second = vi.fn((value: number) => value * 3);

    const { rerender } = render(<Parent fn={first} />);
    expect(seen.latest?.(5)).toBe(10);

    rerender(<Parent fn={second} />);
    // Same wrapper object as before — and yet it now calls `second`.
    expect(seen.latest?.(5)).toBe(15);
    expect(second).toHaveBeenCalledWith(5);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('returns undefined without throwing when fn is undefined', () => {
    render(<Parent fn={undefined} />);

    expect(() => seen.latest?.(1)).not.toThrow();
    expect(seen.latest?.(1)).toBeUndefined();
  });

  it('forwards every argument', () => {
    const spy = vi.fn();
    function Multi() {
      const stable = useStableCallback(spy);
      // Called from an effect, i.e. after the layout effect has stored the ref —
      // the wrapper is explicitly not for use during render.
      React.useEffect(() => { stable('a', 2, { c: true }); }, [stable]);
      return null;
    }
    render(<Multi />);

    expect(spy).toHaveBeenCalledWith('a', 2, { c: true });
  });
});
