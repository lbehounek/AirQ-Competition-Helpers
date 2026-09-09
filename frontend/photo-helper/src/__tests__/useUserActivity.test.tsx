import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import {
  useIsUserIdle,
  __resetUserActivityForTests,
  USER_IDLE_DELAY_MS,
  USER_ACTIVITY_THROTTLE_MS,
} from '../hooks/useUserActivity';

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'pointerup', 'keydown', 'wheel'] as const;

function Consumer({ name, enabled = true }: { name: string; enabled?: boolean }) {
  const idle = useIsUserIdle(enabled);
  return <div data-testid={name} data-idle={String(idle)} />;
}

/** A spy whose recorded calls start with the event name — both listener APIs. */
type ListenerSpy = { mock: { calls: unknown[][] } };

/** Count add/remove registrations per event type on a spied window. */
function countRegistrations(addSpy: ListenerSpy, removeSpy: ListenerSpy, event: string) {
  const added = addSpy.mock.calls.filter(call => call[0] === event).length;
  const removed = removeSpy.mock.calls.filter(call => call[0] === event).length;
  return { added, removed, live: added - removed };
}

beforeEach(() => {
  vi.useFakeTimers();
  // A concrete epoch, so the module's `lastMoveMark = 0` sentinel is genuinely
  // "long ago" and the first pointermove is not swallowed by the throttle.
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  __resetUserActivityForTests();
});

afterEach(() => {
  cleanup();
  __resetUserActivityForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useUserActivity', () => {
  it('shares one idle flag across every subscriber', () => {
    const { getByTestId } = render(
      <StrictMode>
        <Consumer name="a" />
        <Consumer name="b" />
      </StrictMode>,
    );

    expect(getByTestId('a')).toHaveAttribute('data-idle', 'false');
    expect(getByTestId('b')).toHaveAttribute('data-idle', 'false');

    act(() => { vi.advanceTimersByTime(USER_IDLE_DELAY_MS); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'true');
    expect(getByTestId('b')).toHaveAttribute('data-idle', 'true');

    act(() => { fireEvent.pointerMove(window); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'false');
    expect(getByTestId('b')).toHaveAttribute('data-idle', 'false');

    act(() => { vi.advanceTimersByTime(USER_IDLE_DELAY_MS); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'true');
  });

  it('keeps exactly ONE live window listener per event no matter how many subscribers, and leaks none', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(
      <StrictMode>
        <Consumer name="a" />
        <Consumer name="b" />
        <Consumer name="c" />
      </StrictMode>,
    );

    // NB: StrictMode deliberately runs mount → cleanup → mount for the whole
    // tree, so the raw `addEventListener` COUNT is 2 per event, not 1. The
    // property that actually matters (and that a per-editor listener set
    // violated) is that only one registration is live at a time for any number
    // of subscribers — hence the add-minus-remove assertion.
    for (const event of ACTIVITY_EVENTS) {
      expect(countRegistrations(addSpy, removeSpy, event).live).toBe(1);
    }

    unmount();

    for (const event of ACTIVITY_EVENTS) {
      const { added, removed } = countRegistrations(addSpy, removeSpy, event);
      expect(removed).toBe(added);
    }
  });

  it('resets to "not idle" once the last subscriber leaves', () => {
    const { unmount, getByTestId } = render(<Consumer name="a" />);
    act(() => { vi.advanceTimersByTime(USER_IDLE_DELAY_MS); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'true');

    unmount();

    const second = render(<Consumer name="b" />);
    expect(second.getByTestId('b')).toHaveAttribute('data-idle', 'false');
  });

  it('never subscribes and never goes idle when disabled', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    const { getByTestId } = render(<Consumer name="grid" enabled={false} />);

    const ours = addSpy.mock.calls.filter(call => (ACTIVITY_EVENTS as readonly string[]).includes(call[0] as string));
    expect(ours).toHaveLength(0);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(getByTestId('grid')).toHaveAttribute('data-idle', 'false');
  });

  it('throttles pointermove: bursts inside the window do not restart the countdown', () => {
    const { getByTestId } = render(<Consumer name="a" />);

    // t=0 accepted; t=100 and t=200 fall inside the 250 ms throttle and are dropped,
    // so the countdown still expires 3000 ms after t=0.
    act(() => { fireEvent.pointerMove(window); });
    act(() => { vi.advanceTimersByTime(100); fireEvent.pointerMove(window); });
    act(() => { vi.advanceTimersByTime(100); fireEvent.pointerMove(window); });

    act(() => { vi.advanceTimersByTime(USER_IDLE_DELAY_MS - 200 - 1); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'false');

    act(() => { vi.advanceTimersByTime(1); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'true');
  });

  it('a continuous pointermove stream keeps the user active, and idle lands after the LAST accepted mark', () => {
    const { getByTestId } = render(<Consumer name="a" />);

    // Moves every 100 ms up to t=1000 → accepted at 0, 300, 600, 900.
    act(() => { fireEvent.pointerMove(window); });
    for (let t = 100; t <= 1000; t += 100) {
      act(() => { vi.advanceTimersByTime(100); fireEvent.pointerMove(window); });
    }
    expect(USER_ACTIVITY_THROTTLE_MS).toBe(250); // the arithmetic above assumes it

    // t=3000: still active, because the last accepted mark was at t=900.
    act(() => { vi.advanceTimersByTime(USER_IDLE_DELAY_MS - 1000); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'false');

    // t=3900 = 900 + 3000.
    act(() => { vi.advanceTimersByTime(900); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'true');
  });

  it.each([
    ['keydown', () => fireEvent.keyDown(window, { key: 'a' })],
    ['wheel', () => fireEvent.wheel(window)],
    ['pointerdown', () => fireEvent.pointerDown(window)],
    ['pointerup', () => fireEvent.pointerUp(window)],
  ])('%s flips an idle store back to active and restarts the countdown', (_name, fire) => {
    const { getByTestId } = render(<Consumer name="a" />);

    act(() => { vi.advanceTimersByTime(USER_IDLE_DELAY_MS); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'true');

    act(() => { fire(); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'false');

    act(() => { vi.advanceTimersByTime(USER_IDLE_DELAY_MS - 1); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'false');
    act(() => { vi.advanceTimersByTime(1); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'true');
  });

  it('discrete events are NOT throttled — two 50 ms apart both restart the countdown', () => {
    const { getByTestId } = render(<Consumer name="a" />);

    act(() => { fireEvent.pointerDown(window); });
    act(() => { vi.advanceTimersByTime(50); fireEvent.pointerDown(window); });

    // If the second had been swallowed, idle would land at t=3000 rather than t=3050.
    act(() => { vi.advanceTimersByTime(USER_IDLE_DELAY_MS - 50); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'false');

    act(() => { vi.advanceTimersByTime(50); });
    expect(getByTestId('a')).toHaveAttribute('data-idle', 'true');
  });
});
