// A one-at-a-time task queue. Pure — no React, no domain types — so any
// package in the workspace can use it (map-corridors' photo-import queue and
// map-picks writer, photo-helper's competitionService).
//
// WHY this exists: `StorageInterface.writeJSON` gives NO ordering guarantee
// across overlapping calls. The OPFS backend opens a fresh writable per call
// and closes it when the bytes are through (shared-storage/src/opfsStorage.ts:
// 91-97) — nothing serializes two in-flight writers of the same file, so the
// one that finishes LAST wins regardless of who started first. The Electron
// backend happens to be ordered today (one IPC message per call, handled by a
// synchronous `fs.writeFileSync` — desktop/main.js:604-608), but that is an
// accident of one implementation, not a contract of the interface
// (shared-storage/src/types.ts promises nothing). Anything that writes a whole
// file as a snapshot — and must not roll backwards — therefore has to
// serialize its own writes.
//
// NOTE ON THROUGHPUT: this serializes, it does not coalesce — and that split is
// deliberate, because the callers that need coalescing want it on different
// terms. `mapPicksWriter` debounces on a timer above the queue (latest payload
// wins, with explicit flush points for pagehide and Send-to-editor), while
// photo-helper's `competitionService` keeps a per-competition map of the
// newest payload still owed, so a queued task writes the latest snapshot and
// the redundant ones behind it no-op. Baking either policy in here would
// impose it on the other.

/** Enqueue `task`; the returned promise carries THAT task's own outcome. */
export type SerialQueue = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Create an independent FIFO queue.
 *
 * Tasks start in the order they were enqueued and never overlap: task N+1 is
 * invoked only after task N has SETTLED. Returns a promise per call, so one
 * caller's failure is never reported to another caller.
 *
 * Error handling, deliberately:
 *  - a rejected task does NOT wedge the queue — the next task still runs. For
 *    whole-file snapshot writers (our case) that is also the recovery path:
 *    the next write supersedes whatever the failed one was trying to say.
 *  - the `.catch` is attached to the stored TAIL rather than to the head of
 *    the next link, so a rejection cannot surface as an *unhandled* rejection
 *    merely because no further task was ever enqueued. Each caller still sees
 *    the rejection on the promise it was handed and is expected to handle it.
 */
export function createSerialQueue(): SerialQueue {
  // Invariant: `tail` never rejects (see the note above), which is what makes
  // `tail.then(task)` safe to use without a guard on every link.
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}
