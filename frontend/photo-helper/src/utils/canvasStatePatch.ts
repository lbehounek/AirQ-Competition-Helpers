import type { Photo } from '../types/index';

export type CanvasState = Photo['canvasState'];

/**
 * The closed set of settings `applySettingPatch` knows how to write.
 * Narrowing this to a union turns typos at call sites into compile errors.
 */
export type CanvasSetting =
  | 'scale'
  | 'brightness'
  | 'contrast'
  | 'sharpness'
  | 'whiteBalance.temperature'
  | 'whiteBalance.tint';

const makeDefaultCanvasState = (): CanvasState => ({
  position: { x: 0, y: 0 },
  scale: 1,
  brightness: 0,
  contrast: 1,
  sharpness: 0,
  whiteBalance: { temperature: 0, tint: 0, auto: false },
  labelPosition: 'bottom-left',
});

// Frozen at top level and nested so accidental in-place mutation throws
// (modules run in strict mode). Consumers still spread it to get a mutable copy.
export const DEFAULT_CANVAS_STATE: CanvasState = (() => {
  const s = makeDefaultCanvasState();
  Object.freeze(s.position);
  Object.freeze(s.whiteBalance);
  Object.freeze(s);
  return s;
})();

/**
 * Apply a single setting change to a canvasState, returning a new object with
 * independent nested objects (never aliasing DEFAULT_CANVAS_STATE or the input).
 * Non-finite values are ignored so NaN can never reach downstream canvas ops.
 */
export function applySettingPatch(
  canvasState: CanvasState | undefined | null,
  setting: CanvasSetting,
  value: number,
): CanvasState {
  const base = canvasState ?? undefined;
  const next: CanvasState = {
    ...makeDefaultCanvasState(),
    ...base,
    position: base?.position ? { ...base.position } : { x: 0, y: 0 },
    whiteBalance: base?.whiteBalance
      ? { ...base.whiteBalance }
      : { temperature: 0, tint: 0, auto: false },
  };

  if (!Number.isFinite(value)) {
    return next;
  }

  if (setting === 'scale') {
    next.scale = Math.max(1, value);
  } else if (setting === 'brightness') {
    next.brightness = value;
  } else if (setting === 'contrast') {
    next.contrast = value;
  } else if (setting === 'sharpness') {
    next.sharpness = value;
  } else if (setting === 'whiteBalance.temperature') {
    next.whiteBalance.temperature = value;
    next.whiteBalance.auto = false;
  } else if (setting === 'whiteBalance.tint') {
    next.whiteBalance.tint = value;
    next.whiteBalance.auto = false;
  }

  return next;
}

/**
 * Apply a setting to all photos in an array, optionally excluding one photo by ID.
 */
export function applySettingToAllPhotos<T extends { id: string; canvasState: CanvasState }>(
  photos: T[] | undefined | null,
  setting: CanvasSetting,
  value: number,
  excludePhotoId?: string,
): T[] {
  if (!photos) return [];
  return photos.map(p =>
    p.id === excludePhotoId
      ? p
      : { ...p, canvasState: applySettingPatch(p.canvasState, setting, value) }
  );
}

export interface PhotoSetShape<P extends { id: string; canvasState: CanvasState }> {
  title: string;
  photos: P[];
}

export interface PhotoSessionShape<P extends { id: string; canvasState: CanvasState }> {
  version: number;
  updatedAt: string;
  sets: { set1: PhotoSetShape<P>; set2: PhotoSetShape<P> };
}

/**
 * Session-level transformer used by every hook's `applySettingToAll` wiring.
 * Returns a new session with both sets patched, `version` bumped and
 * `updatedAt` refreshed. Shared helper + signature means a regression to a
 * silent no-op is immediately visible at the hook's single call site.
 */
export function applySettingToAllInSession<
  P extends { id: string; canvasState: CanvasState },
  S extends PhotoSessionShape<P>,
>(
  session: S,
  setting: CanvasSetting,
  value: number,
  excludePhotoId?: string,
): S {
  return {
    ...session,
    version: session.version + 1,
    updatedAt: new Date().toISOString(),
    sets: {
      ...session.sets,
      set1: {
        ...session.sets.set1,
        photos: applySettingToAllPhotos(session.sets.set1.photos, setting, value, excludePhotoId),
      },
      set2: {
        ...session.sets.set2,
        photos: applySettingToAllPhotos(session.sets.set2.photos, setting, value, excludePhotoId),
      },
    },
  };
}
