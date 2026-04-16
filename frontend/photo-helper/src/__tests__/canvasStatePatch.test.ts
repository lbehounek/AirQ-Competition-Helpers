import { describe, it, expect } from 'vitest';
import { applySettingPatch, applySettingToAllPhotos, DEFAULT_CANVAS_STATE } from '../utils/canvasStatePatch';
import type { CanvasState } from '../utils/canvasStatePatch';

// Helper to create a photo-like object
function makePhoto(id: string, overrides: Partial<CanvasState> = {}) {
  return {
    id,
    canvasState: { ...DEFAULT_CANVAS_STATE, ...overrides },
  };
}

// ---------------------------------------------------------------------------
// applySettingPatch — single canvasState
// ---------------------------------------------------------------------------
describe('applySettingPatch', () => {
  it('applies brightness', () => {
    const result = applySettingPatch(DEFAULT_CANVAS_STATE, 'brightness', 50);
    expect(result.brightness).toBe(50);
  });

  it('applies contrast', () => {
    const result = applySettingPatch(DEFAULT_CANVAS_STATE, 'contrast', 1.5);
    expect(result.contrast).toBe(1.5);
  });

  it('applies sharpness', () => {
    const result = applySettingPatch(DEFAULT_CANVAS_STATE, 'sharpness', 75);
    expect(result.sharpness).toBe(75);
  });

  it('applies scale', () => {
    const result = applySettingPatch(DEFAULT_CANVAS_STATE, 'scale', 2);
    expect(result.scale).toBe(2);
  });

  it('floors scale at 1', () => {
    const result = applySettingPatch(DEFAULT_CANVAS_STATE, 'scale', 0.5);
    expect(result.scale).toBe(1);
  });

  it('applies whiteBalance.temperature and disables auto', () => {
    const input: CanvasState = { ...DEFAULT_CANVAS_STATE, whiteBalance: { temperature: 0, tint: 0, auto: true } };
    const result = applySettingPatch(input, 'whiteBalance.temperature', 25);
    expect(result.whiteBalance.temperature).toBe(25);
    expect(result.whiteBalance.auto).toBe(false);
  });

  it('applies whiteBalance.tint and disables auto', () => {
    const input: CanvasState = { ...DEFAULT_CANVAS_STATE, whiteBalance: { temperature: 10, tint: 0, auto: true } };
    const result = applySettingPatch(input, 'whiteBalance.tint', -10);
    expect(result.whiteBalance.tint).toBe(-10);
    expect(result.whiteBalance.auto).toBe(false);
    // temperature should be preserved
    expect(result.whiteBalance.temperature).toBe(10);
  });

  it('handles undefined canvasState by using defaults', () => {
    const result = applySettingPatch(undefined, 'brightness', 50);
    expect(result.brightness).toBe(50);
    expect(result.scale).toBe(DEFAULT_CANVAS_STATE.scale);
    expect(result.contrast).toBe(DEFAULT_CANVAS_STATE.contrast);
  });

  it('handles null canvasState by using defaults', () => {
    const result = applySettingPatch(null, 'sharpness', 30);
    expect(result.sharpness).toBe(30);
    expect(result.scale).toBe(1);
  });

  it('preserves existing fields not targeted by the setting', () => {
    const input: CanvasState = {
      ...DEFAULT_CANVAS_STATE,
      position: { x: 100, y: 200 },
      scale: 2.5,
      labelPosition: 'top-right',
    };
    const result = applySettingPatch(input, 'brightness', 42);
    expect(result.position).toEqual({ x: 100, y: 200 });
    expect(result.scale).toBe(2.5);
    expect(result.labelPosition).toBe('top-right');
  });

  it('coerces string values to numbers', () => {
    const result = applySettingPatch(DEFAULT_CANVAS_STATE, 'brightness', '50');
    expect(result.brightness).toBe(50);
  });

  it('does not mutate the input canvasState', () => {
    const input: CanvasState = { ...DEFAULT_CANVAS_STATE };
    applySettingPatch(input, 'brightness', 99);
    expect(input.brightness).toBe(0);
  });

  it('returns defaults unchanged for unknown setting', () => {
    const result = applySettingPatch(DEFAULT_CANVAS_STATE, 'nonexistent', 42);
    expect(result).toEqual(DEFAULT_CANVAS_STATE);
  });
});

// ---------------------------------------------------------------------------
// applySettingToAllPhotos — array of photos
// ---------------------------------------------------------------------------
describe('applySettingToAllPhotos', () => {
  it('applies setting to all photos', () => {
    const photos = [makePhoto('a'), makePhoto('b'), makePhoto('c')];
    const result = applySettingToAllPhotos(photos, 'brightness', 50);
    for (const p of result) {
      expect(p.canvasState.brightness).toBe(50);
    }
  });

  it('skips the excluded photo', () => {
    const photos = [
      makePhoto('a', { brightness: 10 }),
      makePhoto('b', { brightness: 20 }),
    ];
    const result = applySettingToAllPhotos(photos, 'brightness', 99, 'a');
    expect(result[0].canvasState.brightness).toBe(10); // excluded, unchanged
    expect(result[1].canvasState.brightness).toBe(99); // patched
  });

  it('handles empty array', () => {
    const result = applySettingToAllPhotos([], 'brightness', 50);
    expect(result).toEqual([]);
  });

  it('does not mutate original photos array', () => {
    const photos = [makePhoto('a')];
    const result = applySettingToAllPhotos(photos, 'brightness', 50);
    expect(photos[0].canvasState.brightness).toBe(0);
    expect(result[0].canvasState.brightness).toBe(50);
  });

  it('preserves extra photo fields', () => {
    const photos = [{ id: 'x', canvasState: { ...DEFAULT_CANVAS_STATE }, label: 'test', url: '/img.jpg' }];
    const result = applySettingToAllPhotos(photos, 'scale', 2);
    expect(result[0].label).toBe('test');
    expect(result[0].url).toBe('/img.jpg');
    expect(result[0].canvasState.scale).toBe(2);
  });
});
