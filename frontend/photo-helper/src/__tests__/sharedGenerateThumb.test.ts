import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateThumb, fitWithin } from '@airq/shared-storage';
import { CANDIDATE_THUMB_OPTS } from '../utils/candidateThumbs';

// `generateThumb` moved from map-corridors into shared-storage so both apps
// share one synthesizer (photo-helper cannot import from map-corridors). These
// tests cover the shared copy from THIS side — in particular the two contracts
// that only exist because of the move:
//   1. the default createImageBitmap options object must stay EXACTLY
//      `{ imageOrientation: 'from-image' }` (map-corridors asserts that shape);
//   2. it must accept a plain Blob, because photo-helper feeds it bytes from
//      `fetch(blob:)` rather than a File.
//
// jsdom has neither `createImageBitmap` nor `OffscreenCanvas` (both are
// browser/Worker APIs), so they are stubbed globally — same approach as
// map-corridors/src/__tests__/generateThumb.test.ts. Real-pixel assertions
// need a browser runner and are out of scope here.

describe('fitWithin (shared copy)', () => {
  it('returns the source size unchanged when it already fits', () => {
    expect(fitWithin(100, 75, 200, 150)).toEqual({ width: 100, height: 75 });
    expect(fitWithin(200, 150, 200, 150)).toEqual({ width: 200, height: 150 });
  });

  it('caps wide images by width and tall images by height', () => {
    expect(fitWithin(1000, 500, 200, 150)).toEqual({ width: 200, height: 100 });
    expect(fitWithin(500, 1000, 200, 150)).toEqual({ width: 75, height: 150 });
  });

  it('caps square images by the smaller bound', () => {
    expect(fitWithin(1000, 1000, 200, 150)).toEqual({ width: 150, height: 150 });
  });

  it('never produces zero dimensions', () => {
    expect(fitWithin(1, 100000, 200, 150).width).toBeGreaterThanOrEqual(1);
    expect(fitWithin(100000, 1, 200, 150).height).toBeGreaterThanOrEqual(1);
  });

  it('floors instead of rounding so the bounds are never exceeded', () => {
    expect(fitWithin(333, 200, 200, 150)).toEqual({ width: 200, height: 120 });
  });

  it('fits candidate-tray bounds (320x240) for both orientations', () => {
    // 6000x4000 (3:2) → width-capped: 320 x 213.
    expect(fitWithin(6000, 4000, 320, 240)).toEqual({ width: 320, height: 213 });
    // 4000x6000 (2:3) → height-capped: 160 x 240.
    expect(fitWithin(4000, 6000, 320, 240)).toEqual({ width: 160, height: 240 });
  });
});

interface FakeBitmap {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
}

function fakeBitmap(width: number, height: number): FakeBitmap {
  return { width, height, close: vi.fn() };
}

interface CanvasCall {
  width: number;
  height: number;
  drawImage: ReturnType<typeof vi.fn>;
  convertToBlob: ReturnType<typeof vi.fn>;
}

describe('generateThumb (shared copy)', () => {
  let createImageBitmapMock: ReturnType<typeof vi.fn>;
  let canvasInstances: CanvasCall[];
  let mockBlob: Blob;

  beforeEach(() => {
    canvasInstances = [];
    mockBlob = new Blob([new Uint8Array(2048)], { type: 'image/jpeg' });
    createImageBitmapMock = vi.fn(async () => fakeBitmap(6000, 4000));

    const OffscreenCanvasMock = vi.fn(function (this: CanvasCall, w: number, h: number) {
      this.width = w;
      this.height = h;
      this.drawImage = vi.fn();
      this.convertToBlob = vi.fn(async () => mockBlob);
      const ctx = { drawImage: this.drawImage };
      (this as unknown as { getContext: (id: string) => unknown }).getContext = vi.fn(() => ctx);
      canvasInstances.push(this);
    }) as unknown as typeof OffscreenCanvas;

    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function dummyBlob(): Blob {
    return new Blob([new Uint8Array(8)], { type: 'image/jpeg' });
  }

  it('passes EXACTLY { imageOrientation: "from-image" } when decodeResizeWidth is unset', async () => {
    // Guards map-corridors' existing contract: no resize members may leak into
    // the default call shape.
    const source = dummyBlob();
    await generateThumb(source);
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
    expect(createImageBitmapMock).toHaveBeenCalledWith(source, { imageOrientation: 'from-image' });
    expect(Object.keys(createImageBitmapMock.mock.calls[0][1] as object)).toEqual([
      'imageOrientation',
    ]);
  });

  it('forwards decodeResizeWidth as resizeWidth + resizeQuality:"high"', async () => {
    const source = dummyBlob();
    await generateThumb(source, { decodeResizeWidth: 640 });
    expect(createImageBitmapMock).toHaveBeenCalledWith(source, {
      imageOrientation: 'from-image',
      resizeWidth: 640,
      resizeQuality: 'high',
    });
  });

  it('accepts a plain Blob (not only a File)', async () => {
    const blob = dummyBlob();
    expect(blob).not.toBeInstanceOf(File);
    const result = await generateThumb(blob);
    expect(result).toBeInstanceOf(Blob);
  });

  it('applies the default 200x150 contain-fit bounds', async () => {
    createImageBitmapMock.mockResolvedValueOnce(fakeBitmap(1000, 750));
    await generateThumb(dummyBlob());
    expect(canvasInstances[0].width).toBe(200);
    expect(canvasInstances[0].height).toBe(150);
  });

  it('applies CANDIDATE_THUMB_OPTS bounds (320x240) for both orientations', async () => {
    createImageBitmapMock.mockResolvedValueOnce(fakeBitmap(6000, 4000));
    await generateThumb(dummyBlob(), CANDIDATE_THUMB_OPTS);
    expect(canvasInstances[0].width).toBe(320);
    expect(canvasInstances[0].height).toBe(213);

    createImageBitmapMock.mockResolvedValueOnce(fakeBitmap(4000, 6000));
    await generateThumb(dummyBlob(), CANDIDATE_THUMB_OPTS);
    expect(canvasInstances[1].width).toBe(160);
    expect(canvasInstances[1].height).toBe(240);
  });

  it('calls convertToBlob with { type: "image/jpeg", quality }', async () => {
    await generateThumb(dummyBlob(), { quality: 0.75 });
    expect(canvasInstances[0].convertToBlob).toHaveBeenCalledWith({
      type: 'image/jpeg',
      quality: 0.75,
    });
    await generateThumb(dummyBlob());
    expect(canvasInstances[1].convertToBlob).toHaveBeenCalledWith({
      type: 'image/jpeg',
      quality: 0.7,
    });
  });

  it('closes the bitmap after a successful encode', async () => {
    const bm = fakeBitmap(1000, 750);
    createImageBitmapMock.mockResolvedValueOnce(bm);
    await generateThumb(dummyBlob());
    expect(bm.close).toHaveBeenCalledTimes(1);
  });

  it('closes the bitmap even when the encode throws', async () => {
    const bm = fakeBitmap(1000, 750);
    createImageBitmapMock.mockResolvedValueOnce(bm);
    const OffscreenCanvasMock = vi.fn(function (this: {
      getContext: () => unknown;
      convertToBlob: () => Promise<Blob>;
    }) {
      this.getContext = () => ({ drawImage: () => {} });
      this.convertToBlob = () => Promise.reject(new Error('encode boom'));
    }) as unknown as typeof OffscreenCanvas;
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock);

    await expect(generateThumb(dummyBlob())).rejects.toThrow('encode boom');
    expect(bm.close).toHaveBeenCalledTimes(1);
  });

  it('propagates a createImageBitmap rejection (corrupt input)', async () => {
    createImageBitmapMock.mockRejectedValueOnce(new Error('decode failed'));
    await expect(generateThumb(dummyBlob())).rejects.toThrow('decode failed');
    expect(canvasInstances).toHaveLength(0);
  });

  it('throws when the decoded bitmap has a zero dimension', async () => {
    createImageBitmapMock.mockResolvedValueOnce(fakeBitmap(0, 100));
    await expect(generateThumb(dummyBlob())).rejects.toThrow(/zero dimension/);
  });

  it('throws when the OffscreenCanvas 2D context is unavailable', async () => {
    const OffscreenCanvasMock = vi.fn(function (this: { getContext: () => null }) {
      this.getContext = () => null;
    }) as unknown as typeof OffscreenCanvas;
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock);
    await expect(generateThumb(dummyBlob())).rejects.toThrow(/2D context unavailable/);
  });

  it('rejects invalid bounds before decoding anything', async () => {
    await expect(generateThumb(dummyBlob(), { maxWidth: 0 })).rejects.toThrow(/invalid bounds/);
    await expect(generateThumb(dummyBlob(), { maxHeight: -1 })).rejects.toThrow(/invalid bounds/);
    expect(createImageBitmapMock).not.toHaveBeenCalled();
  });
});
