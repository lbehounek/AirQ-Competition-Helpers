/**
 * The one branch of the lazy PDF facade that needs the implementation module to
 * be UNLOADABLE: a `import('./pdfGeneratorImpl')` that rejects.
 *
 * It lives in its own file because vitest caches a `vi.mock` factory's result
 * across `vi.resetModules()` — a factory therefore cannot be flipped into
 * throwing part-way through a file, it has to throw from its first run.
 *
 * The real-world trigger is web-only: the deploy scripts rsync `--delete`, so a
 * tab left open across a release can no longer fetch the old hashed chunk. The
 * facade must turn that into a tagged, logged error rather than a mystery
 * failure — desktop serves local files and cannot hit it.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ApiPhotoSet } from '../types/api';

vi.mock('../utils/pdfGeneratorImpl', () => {
  throw new Error('chunk 404');
});

const SET: ApiPhotoSet = { title: 'Set 1', photos: [] } as unknown as ApiPhotoSet;
const EMPTY: ApiPhotoSet = { title: '', photos: [] } as unknown as ApiPhotoSet;

describe('pdfGenerator facade — chunk load failure', () => {
  it('tags the rejection, keeps the cause, and logs a reload hint', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const facade = await import('../utils/pdfGenerator');

    const rejection = await facade.generatePDF(SET, EMPTY, 'sid').catch((e: unknown) => e);

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe('PDF export module failed to load');
    // AppApi can branch on this tag to offer "reload" instead of the generic
    // export error; the cause keeps the original failure diagnosable.
    expect((rejection as { chunkLoadFailed?: boolean }).chunkLoadFailed).toBe(true);
    // The cause is whatever the failed import threw, forwarded unchanged.
    // (Under vitest that is the runner's own wrapper around the throwing mock
    // factory, not our literal 'chunk 404' — the point is only that the
    // original failure survives on `.cause` for the console.)
    expect((rejection as { cause?: unknown }).cause).toBeInstanceOf(Error);

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('[pdf]');
    expect(error.mock.calls[0][1]).toBe((rejection as { cause?: unknown }).cause);
    error.mockRestore();
  });
});
