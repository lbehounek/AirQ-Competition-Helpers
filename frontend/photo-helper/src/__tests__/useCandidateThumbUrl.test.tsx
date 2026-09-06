import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';
import { useCandidateThumbUrl, type CandidateThumbView } from '../hooks/useCandidateThumbUrl';
import { peekCandidateThumb, resolveCandidateThumb } from '../utils/candidateThumbs';
import type { DirectoryHandle } from '@airq/shared-storage';
import type { ApiPhoto } from '../types/api';

// The resolver is mocked: this file is about the REACT half — object-URL
// ownership, the tri-state photosDir gate, and the "never flash a skeleton
// over something already painted" rule.
vi.mock('../utils/candidateThumbs', () => ({
  resolveCandidateThumb: vi.fn(async () => null),
  peekCandidateThumb: vi.fn(() => undefined),
}));

// `getStorage()` throws until `initStorage()` has run; the hook must swallow
// that and fall back to in-memory mode. Overridden per-test where relevant.
const getStorageMock = vi.fn(() => ({ tag: 'storage' }));
vi.mock('@airq/shared-storage', () => ({
  getStorage: () => getStorageMock(),
}));

const resolveMock = vi.mocked(resolveCandidateThumb);
const peekMock = vi.mocked(peekCandidateThumb);

const photosDir: DirectoryHandle = { path: '/competitions/c1/photos' };

function makePhoto(overrides: Partial<ApiPhoto> = {}): ApiPhoto {
  return {
    id: 'photo-a',
    sessionId: 'sess-1',
    url: 'blob:photo-a',
    filename: 'photo-a.jpg',
    canvasState: {} as ApiPhoto['canvasState'],
    label: '',
    ...overrides,
  };
}

/**
 * Render the hook and record EVERY committed view, so a test can assert on the
 * transition history (e.g. "never went back to 'loading'"), not just the last
 * value. RTL's renderHook exposes only the current result.
 */
function renderThumbHook(photo: ApiPhoto, dir: DirectoryHandle | null | undefined) {
  const history: CandidateThumbView[] = [];
  const Probe: React.FC<{ photo: ApiPhoto; dir: DirectoryHandle | null | undefined }> = (props) => {
    const view = useCandidateThumbUrl(props.photo, props.dir);
    history.push(view);
    return null;
  };
  const utils = render(<Probe photo={photo} dir={dir} />);
  return {
    history,
    current: () => history[history.length - 1],
    rerender: (nextPhoto: ApiPhoto, nextDir: DirectoryHandle | null | undefined) =>
      utils.rerender(<Probe photo={nextPhoto} dir={nextDir} />),
    unmount: utils.unmount,
  };
}

/** Let the mocked resolver's promise chain settle inside act(). */
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;

beforeEach(() => {
  vi.clearAllMocks();
  resolveMock.mockResolvedValue(null);
  peekMock.mockReturnValue(undefined);
  getStorageMock.mockReturnValue({ tag: 'storage' });

  // jsdom's object-URL implementation is unusable here (opaque, non-fetchable),
  // so both halves are replaced with counters we can assert on.
  let counter = 0;
  originalCreate = globalThis.URL.createObjectURL;
  originalRevoke = globalThis.URL.revokeObjectURL;
  createObjectURL = vi.fn(() => `blob:thumb/${++counter}`);
  revokeObjectURL = vi.fn();
  globalThis.URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  globalThis.URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
});

afterEach(() => {
  cleanup();
  globalThis.URL.createObjectURL = originalCreate;
  globalThis.URL.revokeObjectURL = originalRevoke;
});

describe('useCandidateThumbUrl — resolution states', () => {
  it('starts in the loading state', () => {
    resolveMock.mockReturnValue(new Promise(() => {}));
    const h = renderThumbHook(makePhoto(), photosDir);
    expect(h.current()).toEqual({ url: null, state: 'loading' });
  });

  it('mints an object URL for a resolved thumb blob', async () => {
    const blob = new Blob(['thumb'], { type: 'image/jpeg' });
    resolveMock.mockResolvedValue(blob);
    const h = renderThumbHook(makePhoto(), photosDir);
    await flush();

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(h.current()).toEqual({ url: 'blob:thumb/1', state: 'ready' });
  });

  it('falls back to the source photo URL when no thumb can be made', async () => {
    resolveMock.mockResolvedValue(null);
    const h = renderThumbHook(makePhoto(), photosDir);
    await flush();

    expect(h.current()).toEqual({ url: 'blob:photo-a', state: 'fallback' });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('reports missing when there are no source bytes either', async () => {
    resolveMock.mockResolvedValue(null);
    const h = renderThumbHook(makePhoto({ url: '' }), photosDir);
    await flush();
    expect(h.current()).toEqual({ url: null, state: 'missing' });
  });

  it('reports missing for a placeholder without touching the resolver', async () => {
    const h = renderThumbHook(makePhoto({ isPlaceholder: true }), photosDir);
    await flush();
    expect(h.current()).toEqual({ url: null, state: 'missing' });
    expect(resolveMock).not.toHaveBeenCalled();
  });
});

describe('useCandidateThumbUrl — tri-state photosDir', () => {
  it('does NO I/O while the dir is still resolving (undefined)', async () => {
    const h = renderThumbHook(makePhoto(), undefined);
    await flush();
    expect(resolveMock).not.toHaveBeenCalled();
    expect(h.current()).toEqual({ url: null, state: 'loading' });

    // Once AppApi resolves the dir, exactly one resolve runs — with that dir.
    const blob = new Blob(['thumb'], { type: 'image/jpeg' });
    resolveMock.mockResolvedValue(blob);
    await act(async () => { h.rerender(makePhoto(), photosDir); });
    await flush();

    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock.mock.calls[0][1].photosDir).toBe(photosDir);
    expect(h.current().state).toBe('ready');
  });

  it('resolves in in-memory mode when the dir is unavailable (null)', async () => {
    renderThumbHook(makePhoto(), null);
    await flush();
    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock.mock.calls[0][1].photosDir).toBeNull();
  });

  it('passes storage: null when getStorage() throws (before initStorage)', async () => {
    getStorageMock.mockImplementation(() => { throw new Error('Storage not initialized.'); });
    renderThumbHook(makePhoto(), photosDir);
    await flush();
    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock.mock.calls[0][1].storage).toBeNull();
  });
});

describe('useCandidateThumbUrl — object URL lifetime', () => {
  it('revokes the thumb URL on unmount', async () => {
    resolveMock.mockResolvedValue(new Blob(['thumb'], { type: 'image/jpeg' }));
    const h = renderThumbHook(makePhoto(), photosDir);
    await flush();

    act(() => { h.unmount(); });
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumb/1');
  });

  it('never revokes a fallback URL — the session owns that one', async () => {
    resolveMock.mockResolvedValue(null);
    const h = renderThumbHook(makePhoto(), photosDir);
    await flush();
    expect(h.current().state).toBe('fallback');

    act(() => { h.unmount(); });
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('revokes the old URL and mints a new one when the photo id changes', async () => {
    resolveMock.mockResolvedValue(new Blob(['a'], { type: 'image/jpeg' }));
    const h = renderThumbHook(makePhoto(), photosDir);
    await flush();
    expect(h.current().url).toBe('blob:thumb/1');

    resolveMock.mockResolvedValue(new Blob(['b'], { type: 'image/jpeg' }));
    await act(async () => { h.rerender(makePhoto({ id: 'photo-b', url: 'blob:photo-b' }), photosDir); });
    await flush();

    expect(h.current().url).toBe('blob:thumb/2');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumb/1');
  });

  it('does not touch state or mint a URL when the result arrives after unmount', async () => {
    let settle!: (blob: Blob) => void;
    resolveMock.mockReturnValue(new Promise((res) => { settle = res; }));
    const h = renderThumbHook(makePhoto(), photosDir);
    const renderCount = h.history.length;

    act(() => { h.unmount(); });
    await act(async () => { settle(new Blob(['late'], { type: 'image/jpeg' })); await Promise.resolve(); });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(h.history.length).toBe(renderCount);
  });
});

describe('useCandidateThumbUrl — flicker guard', () => {
  it('paints a cached thumb without a skeleton and still gives the resolver a persist chance', async () => {
    const cached = new Blob(['cached'], { type: 'image/jpeg' });
    peekMock.mockReturnValue(cached);
    const h = renderThumbHook(makePhoto(), photosDir);
    await flush();

    // Only the pre-effect initial render is 'loading'; the first committed
    // state after mount is 'ready' — no skeleton over a cache hit.
    expect(h.history.map((v) => v.state)).toEqual(['loading', 'ready']);
    expect(resolveMock).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when a re-run peeks the SAME blob (new source url, dir arrival)', async () => {
    const cached = new Blob(['cached'], { type: 'image/jpeg' });
    peekMock.mockReturnValue(cached);
    const h = renderThumbHook(makePhoto(), photosDir);
    await flush();
    const urlAfterMount = h.current().url;
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    // A competition reload mints a fresh source blob: URL for the same photo id.
    await act(async () => { h.rerender(makePhoto({ url: 'blob:photo-a-v2' }), photosDir); });
    await flush();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(h.current()).toEqual({ url: urlAfterMount, state: 'ready' });
    expect(h.history.every((v, i) => i === 0 || v.state === 'ready')).toBe(true);
  });

  it('swaps to a new URL — never via loading — when peek returns a different blob', async () => {
    peekMock.mockReturnValue(new Blob(['v1'], { type: 'image/jpeg' }));
    const h = renderThumbHook(makePhoto(), photosDir);
    await flush();
    expect(h.current().url).toBe('blob:thumb/1');

    peekMock.mockReturnValue(new Blob(['v2'], { type: 'image/jpeg' }));
    await act(async () => { h.rerender(makePhoto({ url: 'blob:photo-a-v2' }), photosDir); });
    await flush();

    expect(h.current()).toEqual({ url: 'blob:thumb/2', state: 'ready' });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumb/1');
    expect(h.history.slice(1).every((v) => v.state === 'ready')).toBe(true);
  });
});
