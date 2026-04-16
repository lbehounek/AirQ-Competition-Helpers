import type { Photo } from '../types/index';

export type CanvasState = Photo['canvasState'];

export const DEFAULT_CANVAS_STATE: CanvasState = {
  position: { x: 0, y: 0 },
  scale: 1,
  brightness: 0,
  contrast: 1,
  sharpness: 0,
  whiteBalance: { temperature: 0, tint: 0, auto: false },
  labelPosition: 'bottom-left',
};

/**
 * Apply a single setting change to a canvasState, returning a new object.
 * Accepts undefined/null input (falls back to defaults).
 */
export function applySettingPatch(
  canvasState: CanvasState | undefined | null,
  setting: string,
  value: unknown,
): CanvasState {
  const next: CanvasState = { ...DEFAULT_CANVAS_STATE, ...canvasState };

  if (setting === 'scale') {
    next.scale = Math.max(1, Number(value));
  } else if (setting === 'brightness') {
    next.brightness = Number(value);
  } else if (setting === 'contrast') {
    next.contrast = Number(value);
  } else if (setting === 'sharpness') {
    next.sharpness = Number(value);
  } else if (setting === 'whiteBalance.temperature') {
    const wb = { ...(next.whiteBalance || DEFAULT_CANVAS_STATE.whiteBalance) };
    wb.temperature = Number(value);
    wb.auto = false;
    next.whiteBalance = wb;
  } else if (setting === 'whiteBalance.tint') {
    const wb = { ...(next.whiteBalance || DEFAULT_CANVAS_STATE.whiteBalance) };
    wb.tint = Number(value);
    wb.auto = false;
    next.whiteBalance = wb;
  }

  return next;
}

/**
 * Apply a setting to all photos in an array, optionally excluding one photo by ID.
 */
export function applySettingToAllPhotos<T extends { id: string; canvasState: CanvasState }>(
  photos: T[],
  setting: string,
  value: unknown,
  excludePhotoId?: string,
): T[] {
  return photos.map(p =>
    p.id === excludePhotoId ? p : { ...p, canvasState: applySettingPatch(p.canvasState, setting, value) }
  );
}
