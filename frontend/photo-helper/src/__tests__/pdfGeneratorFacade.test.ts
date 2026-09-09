/**
 * The lazy PDF facade (`utils/pdfGenerator`). Its whole job is to keep the
 * ≈1.6 MB `utils/pdfGeneratorImpl` module out of the eager bundle while looking
 * exactly like the old synchronous export to `AppApi`.
 *
 * `implEvaluated` is the regression guard: the mock factory flips it when the
 * implementation module is first evaluated, so "false right after importing the
 * facade" proves nothing static reaches the heavy tree. (`vite build` enforces
 * the same property on the real bundle — see frontend/vite.chunks.ts.)
 *
 * The chunk-load-failure branch lives in `pdfGeneratorFacadeLoadFailure.test.ts`
 * rather than here: vitest caches a `vi.mock` factory's result across
 * `vi.resetModules()`, so a factory cannot be made to start throwing part-way
 * through a file — it has to throw from its very first run.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ApiPhotoSet } from '../types/api';

const state = vi.hoisted(() => ({ implEvaluated: false }));

const implMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock('../utils/pdfGeneratorImpl', () => {
  state.implEvaluated = true;
  return { generatePDF: implMock };
});

const SET: ApiPhotoSet = { title: 'Set 1', photos: [] } as unknown as ApiPhotoSet;
const EMPTY: ApiPhotoSet = { title: '', photos: [] } as unknown as ApiPhotoSet;

/** Import the facade fresh after `vi.resetModules()`, so its own module-level
 *  code re-runs and the `import()` inside it is exercised again. */
const loadFacade = () => import('../utils/pdfGenerator');

describe('pdfGenerator facade', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    state.implEvaluated = false;
    implMock.mockImplementation(async () => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not evaluate the heavy implementation on import', async () => {
    await loadFacade();
    expect(state.implEvaluated).toBe(false);
  });

  it('forwards every positional argument verbatim and loads the impl on call', async () => {
    const facade = await loadFacade();
    const t = (k: string) => k;
    const options = { onProgress: vi.fn() };

    await expect(
      facade.generatePDF(SET, EMPTY, 'sid', 4 / 3, 'Comp', 'landscape', t, 'track', 'cid', options),
    ).resolves.toBeUndefined();

    expect(state.implEvaluated).toBe(true);
    expect(implMock).toHaveBeenCalledWith(
      SET,
      EMPTY,
      'sid',
      4 / 3,
      'Comp',
      'landscape',
      t,
      'track',
      'cid',
      options,
    );
  });

  it('accepts the three-argument call (the defaults live in the impl)', async () => {
    const facade = await loadFacade();

    await facade.generatePDF(SET, EMPTY, 'sid');

    expect(implMock).toHaveBeenCalledWith(SET, EMPTY, 'sid');
  });

  it('rejects with the impl error OBJECT so AppApi keeps seeing renderFailures', async () => {
    const err = Object.assign(new Error('render exploded'), { renderFailures: [{ photoId: 'p1' }] });
    implMock.mockRejectedValueOnce(err);
    const facade = await loadFacade();

    await expect(facade.generatePDF(SET, EMPTY, 'sid')).rejects.toBe(err);
  });

  it('reuses the loaded impl module across calls, so its in-flight guard still works', async () => {
    const facade = await loadFacade();

    await facade.generatePDF(SET, EMPTY, 'first');
    await facade.generatePDF(SET, EMPTY, 'second');

    // Two facade calls, ONE module instance: the `exportInFlight` coalescing
    // state inside the impl is therefore shared exactly as before the split.
    // (`implEvaluated` is not re-asserted here — vitest caches the factory
    // result, so it only flips on the file's FIRST impl import.)
    expect(implMock).toHaveBeenCalledTimes(2);
    expect(implMock.mock.calls.map((c) => c[2])).toEqual(['first', 'second']);
  });
});
