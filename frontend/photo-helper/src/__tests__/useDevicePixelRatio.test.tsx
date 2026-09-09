import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { useDevicePixelRatio } from '../hooks/useDevicePixelRatio';

function Harness() {
  const dpr = useDevicePixelRatio();
  return <div data-testid="dpr" data-value={String(dpr)} />;
}

function setDpr(value: unknown) {
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true, writable: true });
}

/** matchMedia stub that records every registered `change` listener. */
function stubMatchMedia() {
  const listeners: Array<() => void> = [];
  const queries: string[] = [];
  const matchMedia = vi.fn((query: string) => {
    queries.push(query);
    return {
      matches: true,
      media: query,
      addEventListener: (_type: string, listener: () => void) => { listeners.push(listener); },
      removeEventListener: (_type: string, listener: () => void) => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      },
    } as unknown as MediaQueryList;
  });
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true });
  return { listeners, queries, matchMedia };
}

afterEach(() => {
  cleanup();
  setDpr(1);
  // jsdom ships without matchMedia; restore that so the "missing" case below
  // stays honest for whichever test runs next.
  Reflect.deleteProperty(window, 'matchMedia');
  vi.restoreAllMocks();
});

describe('useDevicePixelRatio', () => {
  it('reads the current devicePixelRatio', () => {
    setDpr(1.5);
    const { getByTestId } = render(<Harness />);
    expect(getByTestId('dpr')).toHaveAttribute('data-value', '1.5');
  });

  it.each([0, undefined, Number.NaN, -2])('falls back to 1 for an insane value (%s)', value => {
    setDpr(value);
    const { getByTestId } = render(<Harness />);
    expect(getByTestId('dpr')).toHaveAttribute('data-value', '1');
  });

  it('re-renders on a DPR change and re-arms the query for the NEW ratio', () => {
    setDpr(1);
    const { listeners, queries } = stubMatchMedia();

    const { getByTestId } = render(<Harness />);
    expect(getByTestId('dpr')).toHaveAttribute('data-value', '1');
    expect(queries).toEqual(['(resolution: 1dppx)']);
    expect(listeners).toHaveLength(1);

    // Dragging the Electron window onto a 200% monitor.
    const captured = listeners[0];
    setDpr(2);
    act(() => { captured(); });

    expect(getByTestId('dpr')).toHaveAttribute('data-value', '2');
    // Re-armed: the old query is pinned to 1dppx and would never fire again.
    expect(queries).toEqual(['(resolution: 1dppx)', '(resolution: 2dppx)']);
    expect(listeners).toHaveLength(1);
  });

  it('removes its listener on unmount', () => {
    setDpr(1);
    const { listeners } = stubMatchMedia();

    const { unmount } = render(<Harness />);
    expect(listeners).toHaveLength(1);

    unmount();
    expect(listeners).toHaveLength(0);
  });

  it('renders without throwing where matchMedia is missing (jsdom)', () => {
    setDpr(1.25);
    expect(window.matchMedia).toBeUndefined();

    const { getByTestId } = render(<Harness />);
    expect(getByTestId('dpr')).toHaveAttribute('data-value', '1.25');
  });
});
