import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveCandidateThumb,
  peekCandidateThumb,
  invalidateCandidateThumb,
  resetCandidateThumbsForTests,
  THUMB_CACHE_MAX,
  type CandidateThumbDeps,
} from '../utils/candidateThumbs';
import type { DirectoryHandle } from '@airq/shared-storage';

// Pure orchestration tests: storage, the byte fetch and the thumbnail
// synthesizer are all injected, so nothing here touches OPFS, canvas or the
// network. What is under test is the decision table — cache, dedupe, the
// delete race, the concurrency limiter and the best-effort persist.

const photosDir: DirectoryHandle = { path: '/competitions/c1/photos' };

function jpeg(tag: string): Blob {
  return new Blob([tag], { type: 'image/jpeg' });
}

interface Harness {
  deps: CandidateThumbDeps;
  getPhotoThumb: ReturnType<typeof vi.fn>;
  savePhotoThumb: ReturnType<typeof vi.fn>;
  fetchBlob: ReturnType<typeof vi.fn>;
  generate: ReturnType<typeof vi.fn>;
}

/** Build injected deps whose storage misses and whose generate always succeeds. */
function harness(overrides: Partial<CandidateThumbDeps> = {}): Harness {
  const getPhotoThumb = vi.fn(async () => null);
  const savePhotoThumb = vi.fn(async () => {});
  const fetchBlob = vi.fn(async () => jpeg('source'));
  const generate = vi.fn(async () => jpeg('generated'));
  const deps: CandidateThumbDeps = {
    storage: { getPhotoThumb, savePhotoThumb } as unknown as CandidateThumbDeps['storage'],
    photosDir,
    fetchBlob,
    generate,
    ...overrides,
  };
  // Read the injectables back OFF `deps` so an override passed by the caller
  // (e.g. a gated `generate`) is the spy the test asserts on, not the default.
  return {
    deps,
    getPhotoThumb,
    savePhotoThumb,
    fetchBlob: deps.fetchBlob as ReturnType<typeof vi.fn>,
    generate: deps.generate as ReturnType<typeof vi.fn>,
  };
}

function photo(id: string, url = `blob:${id}`) {
  return { id, url };
}

/** A promise plus its resolve/reject handles — lets a test control timing. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let debugSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetCandidateThumbsForTests();
  debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  debugSpy.mockRestore();
  warnSpy.mockRestore();
});

describe('resolveCandidateThumb — storage hit', () => {
  it('returns the stored thumb without generating, and caches it', async () => {
    const h = harness();
    const stored = jpeg('stored');
    h.getPhotoThumb.mockResolvedValueOnce(stored);

    await expect(resolveCandidateThumb(photo('a'), h.deps)).resolves.toBe(stored);
    expect(h.generate).not.toHaveBeenCalled();

    // Second call is served from memory — storage is not touched again.
    h.getPhotoThumb.mockClear();
    await expect(resolveCandidateThumb(photo('a'), h.deps)).resolves.toBe(stored);
    expect(h.getPhotoThumb).not.toHaveBeenCalled();
    expect(peekCandidateThumb('a')).toBe(stored);
  });
});

describe('resolveCandidateThumb — generation on miss', () => {
  it('fetches the source bytes once, generates once and persists once', async () => {
    const h = harness();
    const result = await resolveCandidateThumb(photo('a'), h.deps);

    expect(h.fetchBlob).toHaveBeenCalledTimes(1);
    expect(h.fetchBlob).toHaveBeenCalledWith('blob:a');
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(result).toBeInstanceOf(Blob);
    expect(h.savePhotoThumb).toHaveBeenCalledTimes(1);
    expect(h.savePhotoThumb).toHaveBeenCalledWith(photosDir, 'a', result);
  });

  it('treats a REJECTING getPhotoThumb (legacy Electron miss shape) as a miss', async () => {
    const h = harness();
    h.getPhotoThumb.mockRejectedValueOnce(new Error('Photo not found: a'));

    const result = await resolveCandidateThumb(photo('a'), h.deps);
    expect(result).toBeInstanceOf(Blob);
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.savePhotoThumb).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns null without generating when the photo has no blob: url', async () => {
    const h = harness();
    await expect(resolveCandidateThumb(photo('a', ''), h.deps)).resolves.toBeNull();
    expect(h.fetchBlob).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
    expect(peekCandidateThumb('a')).toBeUndefined();
  });

  it('returns null and warns ONCE per session when generation fails', async () => {
    const h = harness();
    h.generate.mockRejectedValue(new Error('CSP blocked blob: fetch'));

    await expect(resolveCandidateThumb(photo('a'), h.deps)).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // A second failure is demoted to debug level — 40 identical warnings would
    // bury the first, which is the one that carries the signal.
    await expect(resolveCandidateThumb(photo('b'), h.deps)).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(h.savePhotoThumb).not.toHaveBeenCalled();
  });
});

describe('resolveCandidateThumb — persistence failures', () => {
  it('still returns the thumb and retries the write on a later resolve', async () => {
    const h = harness();
    h.savePhotoThumb.mockRejectedValueOnce(new Error('quota exceeded'));

    const first = await resolveCandidateThumb(photo('a'), h.deps);
    expect(first).toBeInstanceOf(Blob);
    // The rejection is handled asynchronously — let the catch run.
    await Promise.resolve();
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // The cached entry is flagged unpersisted, so the next resolve writes again
    // (without regenerating).
    await resolveCandidateThumb(photo('a'), h.deps);
    expect(h.savePhotoThumb).toHaveBeenCalledTimes(2);
    expect(h.generate).toHaveBeenCalledTimes(1);
  });
});

describe('resolveCandidateThumb — concurrency and dedupe', () => {
  it('never runs more than 2 generations at once and drains the queue FIFO', async () => {
    const gates = [0, 1, 2, 3, 4].map(() => deferred<Blob>());
    let started = 0;
    let maxConcurrent = 0;
    let inProgress = 0;
    const h = harness({
      generate: vi.fn(() => {
        const gate = gates[started++];
        inProgress++;
        maxConcurrent = Math.max(maxConcurrent, inProgress);
        return gate.promise.finally(() => { inProgress--; });
      }) as unknown as CandidateThumbDeps['generate'],
    });

    const pending = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      resolveCandidateThumb(photo(id), h.deps),
    );

    // Storage reads are unlimited but still async; let them settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toBe(2);
    expect(maxConcurrent).toBe(2);

    // Releasing one slot admits exactly one more.
    for (let i = 0; i < gates.length; i++) {
      gates[i].resolve(jpeg(`thumb-${i}`));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    const results = await Promise.all(pending);
    expect(results.every((r) => r instanceof Blob)).toBe(true);
    expect(started).toBe(5);
    expect(maxConcurrent).toBe(2);
  });

  it('a caller arriving during the slot handover cannot jump the limit', async () => {
    // The test above only ever releases a slot with nobody NEW arriving. The
    // realistic tray shape is the opposite: 40 candidates resolve at once, so
    // another candidate's `storage.getPhotoThumb` continuation is always
    // somewhere in the same microtask drain as the waiter being woken. A
    // limiter that decrements the counter and only THEN wakes the waiter leaves
    // the count below the limit for one microtask; a caller landing there sees
    // room, enters, and a third full-resolution decode + JPEG encode runs.
    //
    // Where that one-microtask window falls depends on how many hops the
    // arriving caller's own chain has already taken, so sweep the depth rather
    // than hard-coding it: the limit must hold at EVERY arrival offset.
    for (let delay = 0; delay <= 8; delay++) {
      resetCandidateThumbsForTests();
      const gates = [0, 1, 2, 3].map(() => deferred<Blob>());
      let started = 0;
      let maxConcurrent = 0;
      let inProgress = 0;
      const h = harness({
        generate: vi.fn(() => {
          const gate = gates[started++];
          inProgress++;
          maxConcurrent = Math.max(maxConcurrent, inProgress);
          return gate.promise.finally(() => { inProgress--; });
        }) as unknown as CandidateThumbDeps['generate'],
      });

      // a, b occupy both slots; c queues behind the limiter.
      const pending = ['a', 'b', 'c'].map((id) => resolveCandidateThumb(photo(id), h.deps));
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(started).toBe(2);

      // Release a, then let d arrive `delay` microtasks later.
      gates[0].resolve(jpeg('thumb-0'));
      for (let i = 0; i < delay; i++) await Promise.resolve();
      pending.push(resolveCandidateThumb(photo('d'), h.deps));

      // Drain, releasing the rest so nothing is left hanging between sweeps.
      for (const gate of gates.slice(1)) {
        for (let i = 0; i < 8; i++) await Promise.resolve();
        gate.resolve(jpeg('thumb'));
      }
      await Promise.all(pending);
      expect(maxConcurrent, `arrival delay ${delay} microtasks`).toBe(2);
      expect(started, `arrival delay ${delay} microtasks`).toBe(4);
    }
  });

  it('shares one in-flight promise between concurrent callers for the same id', async () => {
    const gate = deferred<Blob>();
    const h = harness({
      generate: vi.fn(() => gate.promise) as unknown as CandidateThumbDeps['generate'],
    });

    const first = resolveCandidateThumb(photo('a'), h.deps);
    const second = resolveCandidateThumb(photo('a'), h.deps);
    const made = jpeg('once');
    gate.resolve(made);

    expect(await first).toBe(made);
    expect(await second).toBe(made);
    expect(h.generate).toHaveBeenCalledTimes(1);
  });
});

describe('resolveCandidateThumb — the delete race', () => {
  it('drops a generation invalidated while it was in flight', async () => {
    const gate = deferred<Blob>();
    const h = harness({
      generate: vi.fn(() => gate.promise) as unknown as CandidateThumbDeps['generate'],
    });

    const pending = resolveCandidateThumb(photo('a'), h.deps);
    invalidateCandidateThumb('a');
    gate.resolve(jpeg('too late'));

    await expect(pending).resolves.toBeNull();
    expect(h.savePhotoThumb).not.toHaveBeenCalled();
    expect(peekCandidateThumb('a')).toBeUndefined();
  });

  it('drops a storage read invalidated while it was in flight', async () => {
    const gate = deferred<Blob | null>();
    const h = harness();
    h.getPhotoThumb.mockImplementationOnce(() => gate.promise);

    const pending = resolveCandidateThumb(photo('a'), h.deps);
    invalidateCandidateThumb('a');
    gate.resolve(jpeg('stored'));

    await expect(pending).resolves.toBeNull();
    expect(peekCandidateThumb('a')).toBeUndefined();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it('re-reads storage after a completed entry is invalidated', async () => {
    const h = harness();
    const stored = jpeg('stored');
    h.getPhotoThumb.mockResolvedValue(stored);

    await resolveCandidateThumb(photo('a'), h.deps);
    expect(h.getPhotoThumb).toHaveBeenCalledTimes(1);

    invalidateCandidateThumb('a');
    await resolveCandidateThumb(photo('a'), h.deps);
    expect(h.getPhotoThumb).toHaveBeenCalledTimes(2);
  });
});

describe('resolveCandidateThumb — in-memory mode (no photos dir yet)', () => {
  it('generates without reading or writing storage, then persists when the dir arrives', async () => {
    const h = harness({ photosDir: null });

    const made = await resolveCandidateThumb(photo('a'), h.deps);
    expect(made).toBeInstanceOf(Blob);
    expect(h.getPhotoThumb).not.toHaveBeenCalled();
    expect(h.savePhotoThumb).not.toHaveBeenCalled();

    // The dir resolves later (AppApi's async effect finishing, or a competition
    // switch settling). The cached-but-unpersisted entry is written out then —
    // without regenerating it.
    await resolveCandidateThumb(photo('a'), { ...h.deps, photosDir });
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.savePhotoThumb).toHaveBeenCalledTimes(1);
    expect(h.savePhotoThumb).toHaveBeenCalledWith(photosDir, 'a', made);

    // Idempotent: a third resolve does not write a second time.
    await resolveCandidateThumb(photo('a'), { ...h.deps, photosDir });
    expect(h.savePhotoThumb).toHaveBeenCalledTimes(1);
  });
});

describe('cache bound', () => {
  it('evicts the least recently used entry beyond THUMB_CACHE_MAX', async () => {
    const h = harness();
    for (let i = 0; i < THUMB_CACHE_MAX; i++) {
      await resolveCandidateThumb(photo(`p${i}`), h.deps);
    }
    expect(peekCandidateThumb('p0')).toBeDefined();

    // Peeking p0 makes it the most recent, so the NEXT insert must evict p1.
    peekCandidateThumb('p0');
    await resolveCandidateThumb(photo('overflow'), h.deps);

    expect(peekCandidateThumb('p0')).toBeDefined();
    expect(peekCandidateThumb('p1')).toBeUndefined();
    expect(peekCandidateThumb('overflow')).toBeDefined();
  });

  it('peekCandidateThumb returns undefined for an unknown id', () => {
    expect(peekCandidateThumb('never-seen')).toBeUndefined();
  });
});
