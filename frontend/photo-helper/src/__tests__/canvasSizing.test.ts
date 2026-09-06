import { describe, it, expect } from 'vitest';
import {
  canvasSizeFor,
  resolveGridBackingWidth,
  resolveCanvasWidth,
  GRID_CANVAS_MIN_WIDTH,
  GRID_CANVAS_MAX_WIDTH,
  GRID_CANVAS_QUANTUM,
  LARGE_CANVAS_WIDTH,
} from '../utils/canvasSizing';

// The sizing policy is the one place where "how many pixels does every mounted
// canvas redraw" is decided, so it is pinned exhaustively: the fallbacks (a
// cell that has not been measured yet, a `display:none` cell reporting 0, a
// bogus DPR) all have to land on the historical 300, and the result may never
// exceed the previous fixed 600 — that cap is what makes this WP monotonic.

describe('canvasSizeFor', () => {
  it('derives height from the aspect ratio with the same rounding as AspectRatioContext', () => {
    expect(canvasSizeFor(600, 4 / 3)).toEqual({ width: 600, height: 450 });
    expect(canvasSizeFor(600, 16 / 9)).toEqual({ width: 600, height: 338 });
    expect(canvasSizeFor(600, 3 / 2)).toEqual({ width: 600, height: 400 });
    expect(canvasSizeFor(240, 3 / 2)).toEqual({ width: 240, height: 160 });
  });
});

describe('resolveGridBackingWidth', () => {
  const cases: Array<[cssWidth: number | null, dpr: number, expected: number, why: string]> = [
    // [cssWidth, dpr, expected, why]
    [null, 1.25, GRID_CANVAS_MIN_WIDTH, 'not measured yet → historical 300'],
    [0, 1, GRID_CANVAS_MIN_WIDTH, 'display:none cell reports width 0'],
    [Number.NaN, 2, GRID_CANVAS_MIN_WIDTH, 'non-finite measurement'],
    [-50, 2, GRID_CANVAS_MIN_WIDTH, 'negative measurement'],
    [144, 1.25, GRID_CANVAS_MIN_WIDTH, 'tray thumb: 180 → 200 → clamped up to 300'],
    [380, 1.25, 500, '475 → ceil to the next 100 quantum'],
    [511, 1, 600, '511 → 600, exactly at the cap'],
    [700, 1.5, GRID_CANVAS_MAX_WIDTH, '1050 capped at 600'],
    [700, 0, GRID_CANVAS_MAX_WIDTH, 'dpr 0 falls back to 1 → 700 → capped'],
    [700, Number.NaN, GRID_CANVAS_MAX_WIDTH, 'dpr NaN falls back to 1 → capped'],
  ];

  it.each(cases)('resolveGridBackingWidth(%s, %s) === %s (%s)', (cssWidth, dpr, expected) => {
    expect(resolveGridBackingWidth(cssWidth, dpr)).toBe(expected);
  });

  it('is always quantized, clamped, monotonic and never upscales beyond 1×', () => {
    for (const dpr of [1, 1.25, 1.5, 2]) {
      let previous = 0;
      for (let cssWidth = 1; cssWidth <= 2000; cssWidth++) {
        const result = resolveGridBackingWidth(cssWidth, dpr);

        expect(result % GRID_CANVAS_QUANTUM).toBe(0);
        expect(result).toBeGreaterThanOrEqual(GRID_CANVAS_MIN_WIDTH);
        expect(result).toBeLessThanOrEqual(GRID_CANVAS_MAX_WIDTH);
        // Monotonic: a wider cell never gets a SMALLER buffer, or a slow window
        // resize would flip back and forth across a quantum boundary.
        expect(result).toBeGreaterThanOrEqual(previous);
        // The anti-pixelation guarantee: the buffer covers the displayed device
        // pixels, right up to the point where the cap takes over.
        expect(result).toBeGreaterThanOrEqual(Math.min(GRID_CANVAS_MAX_WIDTH, cssWidth * dpr));

        previous = result;
      }
    }
  });
});

describe('resolveCanvasWidth', () => {
  it('pins the modal at LARGE_CANVAS_WIDTH regardless of measurement or DPR', () => {
    // The modal's drag/wheel math divides CSS deltas by canvas.width/BASE_WIDTH,
    // so its backing width must equal its CSS width — measurement must not leak in.
    expect(resolveCanvasWidth('large', 5000, 3)).toBe(LARGE_CANVAS_WIDTH);
    expect(resolveCanvasWidth('large', null, 1)).toBe(LARGE_CANVAS_WIDTH);
    expect(resolveCanvasWidth('large', 120, 1)).toBe(LARGE_CANVAS_WIDTH);
  });

  it('delegates the grid to resolveGridBackingWidth', () => {
    expect(resolveCanvasWidth('grid', 380, 1.25)).toBe(500);
    expect(resolveCanvasWidth('grid', null, 1.25)).toBe(GRID_CANVAS_MIN_WIDTH);
  });
});
