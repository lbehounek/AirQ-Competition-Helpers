/**
 * Hand the event loop back to the browser between heavy synchronous chunks.
 *
 * Resolves on the next macrotask, which gives the compositor a rendering
 * opportunity and lets React commit any state queued in the meantime (the PDF
 * export's progress indicator). Never rejects; takes no arguments.
 *
 * WHY a MessageChannel and not the obvious alternatives:
 * - `setTimeout(…, 0)` is a macrotask too, but a THROTTLED one. Each hop is
 *   scheduled from the previous timer's callback, so it pays the ≥4 ms nesting
 *   clamp — and, far worse, Chromium throttles chained timers in a hidden page
 *   to one wake-up per second (one per minute after five minutes of intensive
 *   throttling). The desktop shell does not set `backgroundThrottling: false`,
 *   so a minimised Electron window is throttled exactly like a background tab.
 *   The alt-tab-during-export case is precisely what this helper exists for, so
 *   the primitive must not degrade there: an 18-photo export used to gain ~18 s
 *   when minimised, and crawl at one photo per minute past the five-minute mark
 *   while the Generate button stayed disabled.
 * - `requestAnimationFrame` does not fire at all while the window is hidden or
 *   minimised, so such an export would stall forever.
 * - `scheduler.yield()` queues its continuation AHEAD of other tasks of the
 *   same priority (Prioritized Task Scheduling spec). React schedules its
 *   commit through a MessageChannel task, so the progress `setState` this
 *   yield exists to let through could be starved until the loop finishes —
 *   the exact opposite of the intent. (If a future change does adopt
 *   `scheduler.yield` here, the progress setter must be wrapped in
 *   `flushSync`.)
 *
 * A `MessageChannel` message is a plain macrotask with no clamp and no
 * hidden-page throttling — it is the same primitive React's own scheduler uses.
 * Our task is posted at yield time, so a React commit queued during the render
 * work that preceded us is already ahead of it in the queue and still gets to
 * run first. Ports are per-call and closed on delivery: one channel per photo is
 * noise next to a full-resolution render, and closing means no listener outlives
 * the export.
 */
export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      port2.close();
      resolve();
    };
    port2.postMessage(null);
  });
