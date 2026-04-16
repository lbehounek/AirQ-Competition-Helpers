import { describe, it, expect } from 'vitest';
import {
  applySettingPatch,
  applySettingToAllPhotos,
  applySettingToAllInSession,
  DEFAULT_CANVAS_STATE,
} from '../utils/canvasStatePatch';
import type { CanvasState, PhotoSessionShape } from '../utils/canvasStatePatch';

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
    const input: CanvasState = {
      ...DEFAULT_CANVAS_STATE,
      whiteBalance: { temperature: 0, tint: 0, auto: true },
    };
    const result = applySettingPatch(input, 'whiteBalance.temperature', 25);
    expect(result.whiteBalance.temperature).toBe(25);
    expect(result.whiteBalance.auto).toBe(false);
  });

  it('applies whiteBalance.tint and disables auto, preserving temperature', () => {
    const input: CanvasState = {
      ...DEFAULT_CANVAS_STATE,
      whiteBalance: { temperature: 10, tint: 0, auto: true },
    };
    const result = applySettingPatch(input, 'whiteBalance.tint', -10);
    expect(result.whiteBalance.tint).toBe(-10);
    expect(result.whiteBalance.auto).toBe(false);
    expect(result.whiteBalance.temperature).toBe(10);
  });

  it('handles undefined canvasState by using defaults', () => {
    const result = applySettingPatch(undefined, 'brightness', 50);
    expect(result.brightness).toBe(50);
    expect(result.scale).toBe(1);
    expect(result.contrast).toBe(1);
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

  it('does not mutate the input canvasState', () => {
    const input: CanvasState = { ...DEFAULT_CANVAS_STATE };
    applySettingPatch(input, 'brightness', 99);
    expect(input.brightness).toBe(0);
  });

  // ---- NaN / non-finite value guards ----
  it('ignores NaN values instead of writing them into state', () => {
    const input: CanvasState = { ...DEFAULT_CANVAS_STATE, brightness: 25 };
    const result = applySettingPatch(input, 'brightness', Number.NaN);
    expect(result.brightness).toBe(25);
  });

  it('ignores Infinity values', () => {
    const input: CanvasState = { ...DEFAULT_CANVAS_STATE, scale: 2 };
    const result = applySettingPatch(input, 'scale', Number.POSITIVE_INFINITY);
    expect(result.scale).toBe(2);
  });

  it('ignores NaN for whiteBalance.temperature without flipping auto', () => {
    const input: CanvasState = {
      ...DEFAULT_CANVAS_STATE,
      whiteBalance: { temperature: 5, tint: 0, auto: true },
    };
    const result = applySettingPatch(input, 'whiteBalance.temperature', Number.NaN);
    expect(result.whiteBalance.temperature).toBe(5);
    expect(result.whiteBalance.auto).toBe(true);
  });

  // ---- Nested-reference independence (guards against shared-default leak) ----
  it('returned nested objects are independent of DEFAULT_CANVAS_STATE', () => {
    const result = applySettingPatch(undefined, 'brightness', 10);
    expect(result.whiteBalance).not.toBe(DEFAULT_CANVAS_STATE.whiteBalance);
    expect(result.position).not.toBe(DEFAULT_CANVAS_STATE.position);
  });

  it('returned nested objects are independent of the input canvasState', () => {
    const input: CanvasState = {
      ...DEFAULT_CANVAS_STATE,
      position: { x: 5, y: 5 },
      whiteBalance: { temperature: 3, tint: 4, auto: false },
    };
    const result = applySettingPatch(input, 'brightness', 10);
    expect(result.position).not.toBe(input.position);
    expect(result.whiteBalance).not.toBe(input.whiteBalance);
    result.position.x = 999;
    result.whiteBalance.temperature = 999;
    expect(input.position.x).toBe(5);
    expect(input.whiteBalance.temperature).toBe(3);
  });

  it('DEFAULT_CANVAS_STATE is frozen', () => {
    expect(Object.isFrozen(DEFAULT_CANVAS_STATE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CANVAS_STATE.position)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CANVAS_STATE.whiteBalance)).toBe(true);
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
    expect(result[0].canvasState.brightness).toBe(10);
    expect(result[1].canvasState.brightness).toBe(99);
  });

  it('handles empty array', () => {
    const result = applySettingToAllPhotos([], 'brightness', 50);
    expect(result).toEqual([]);
  });

  it('handles undefined photos', () => {
    const result = applySettingToAllPhotos(undefined, 'brightness', 50);
    expect(result).toEqual([]);
  });

  it('handles null photos', () => {
    const result = applySettingToAllPhotos(null, 'brightness', 50);
    expect(result).toEqual([]);
  });

  it('does not mutate original photos array or their canvasStates', () => {
    const photos = [makePhoto('a')];
    const result = applySettingToAllPhotos(photos, 'brightness', 50);
    expect(photos[0].canvasState.brightness).toBe(0);
    expect(result[0]).not.toBe(photos[0]);
    expect(result[0].canvasState).not.toBe(photos[0].canvasState);
  });

  it('preserves extra photo fields', () => {
    const photos = [
      { id: 'x', canvasState: { ...DEFAULT_CANVAS_STATE }, label: 'test', url: '/img.jpg' },
    ];
    const result = applySettingToAllPhotos(photos, 'scale', 2);
    expect(result[0].label).toBe('test');
    expect(result[0].url).toBe('/img.jpg');
    expect(result[0].canvasState.scale).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// applySettingToAllInSession — session-level transformer (the shared wiring
// used by every hook; protects against a hook regressing to a silent no-op).
// ---------------------------------------------------------------------------
describe('applySettingToAllInSession', () => {
  type TestPhoto = { id: string; canvasState: CanvasState; label?: string };
  type TestSession = PhotoSessionShape<TestPhoto> & { id: string; mode: 'track' };

  const makeSession = (): TestSession => ({
    id: 'session-1',
    mode: 'track',
    version: 3,
    updatedAt: '2020-01-01T00:00:00.000Z',
    sets: {
      set1: {
        title: 'SP - TP1',
        photos: [makePhoto('a'), makePhoto('b', { brightness: 5 })],
      },
      set2: {
        title: 'TP1 - FP',
        photos: [makePhoto('c')],
      },
    },
  });

  it('bumps version', () => {
    const session = makeSession();
    const result = applySettingToAllInSession(session, 'brightness', 42);
    expect(result.version).toBe(session.version + 1);
  });

  it('refreshes updatedAt to a new ISO string', () => {
    const session = makeSession();
    const result = applySettingToAllInSession(session, 'brightness', 42);
    expect(result.updatedAt).not.toBe(session.updatedAt);
    expect(new Date(result.updatedAt).toString()).not.toBe('Invalid Date');
  });

  it('patches photos in both sets', () => {
    const session = makeSession();
    const result = applySettingToAllInSession(session, 'brightness', 42);
    expect(result.sets.set1.photos.every(p => p.canvasState.brightness === 42)).toBe(true);
    expect(result.sets.set2.photos.every(p => p.canvasState.brightness === 42)).toBe(true);
  });

  it('preserves set titles and extra photo fields', () => {
    const session = makeSession();
    session.sets.set1.photos[0].label = 'A';
    const result = applySettingToAllInSession(session, 'scale', 2);
    expect(result.sets.set1.title).toBe('SP - TP1');
    expect(result.sets.set2.title).toBe('TP1 - FP');
    expect(result.sets.set1.photos[0].label).toBe('A');
  });

  it('respects excludePhotoId across both sets', () => {
    const session = makeSession();
    const result = applySettingToAllInSession(session, 'brightness', 99, 'b');
    expect(result.sets.set1.photos[0].canvasState.brightness).toBe(99);
    expect(result.sets.set1.photos[1].canvasState.brightness).toBe(5);
    expect(result.sets.set2.photos[0].canvasState.brightness).toBe(99);
  });

  it('preserves non-sets session fields', () => {
    const session = makeSession();
    const result = applySettingToAllInSession(session, 'brightness', 7);
    expect(result.id).toBe('session-1');
    expect(result.mode).toBe('track');
  });

  it('does not mutate the input session', () => {
    const session = makeSession();
    const originalVersion = session.version;
    const originalUpdatedAt = session.updatedAt;
    const originalBrightness = session.sets.set1.photos[0].canvasState.brightness;
    applySettingToAllInSession(session, 'brightness', 77);
    expect(session.version).toBe(originalVersion);
    expect(session.updatedAt).toBe(originalUpdatedAt);
    expect(session.sets.set1.photos[0].canvasState.brightness).toBe(originalBrightness);
  });

  it('ignores NaN value (version still bumps, no brightness change)', () => {
    const session = makeSession();
    session.sets.set1.photos[0].canvasState.brightness = 25;
    const result = applySettingToAllInSession(session, 'brightness', Number.NaN);
    expect(result.version).toBe(session.version + 1);
    expect(result.sets.set1.photos[0].canvasState.brightness).toBe(25);
  });
});
