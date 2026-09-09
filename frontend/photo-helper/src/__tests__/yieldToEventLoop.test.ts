/**
 * The yield helper is three lines, but WHICH three lines is a decision the PDF
 * export depends on — these cases pin the two rejected alternatives so a
 * future "optimisation" to `scheduler.yield` / `requestAnimationFrame` fails
 * loudly instead of silently starving the progress UI.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { yieldToEventLoop } from '../utils/yieldToEventLoop';

describe('yieldToEventLoop', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves on the next macrotask, not synchronously', async () => {
    let resolved = false;
    const promise = yieldToEventLoop().then(() => {
      resolved = true;
    });

    // Nothing has run yet: a microtask drain must not be enough, or the
    // compositor and React's commit never get their turn.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    await promise;
    expect(resolved).toBe(true);
  });

  it('does not use a timer (chained timers are throttled to 1/s in a hidden page)', async () => {
    // The alt-tab-during-export case is the whole reason this helper exists, so
    // the primitive must survive it. Chromium clamps chained `setTimeout` hops
    // in a hidden page to one per second — and a minimised Electron window is
    // throttled the same way, because the shell does not disable background
    // throttling.
    const timer = vi.spyOn(globalThis, 'setTimeout');

    await yieldToEventLoop();

    expect(timer).not.toHaveBeenCalled();
  });

  it('does not use scheduler.yield (it would queue ahead of React\'s commit task)', async () => {
    const schedulerYield = vi.fn(() => Promise.resolve());
    vi.stubGlobal('scheduler', { yield: schedulerYield });

    await yieldToEventLoop();

    expect(schedulerYield).not.toHaveBeenCalled();
  });

  it('does not use requestAnimationFrame (it never fires for a hidden window)', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');

    await yieldToEventLoop();

    expect(raf).not.toHaveBeenCalled();
  });
});
