/**
 * Guards for the WebGL safety net that the PDF export now depends on.
 *
 * WHY these matter more than they used to: until WP2d the export forced the
 * CPU path, so a silently-black GPU result could never reach the printed
 * answer sheet. Now it can, and every failure mode `applyWebGLEffects` can
 * detect WITHOUT a GPU sync has to return null so the caller falls back to CPU.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyWebGLEffects, initWebGLContext, loseWebGLContext, type WebGLContext, type ImageAdjustments } from '../utils/webglUtils';

const ADJUSTMENTS: ImageAdjustments = {
  brightness: 10,
  contrast: 1.2,
  sharpness: 20,
  temperature: 5,
  tint: -3,
};

/**
 * Build a canvas of a given size without touching jsdom's unimplemented 2D
 * context — `applyWebGLEffects` only reads `width`/`height` off the source.
 */
const makeSource = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/**
 * A hand-built `WebGLContext` whose `gl` is a bag of spies.
 *
 * Returns `{ context, gl, canvas }`. `drawingBufferWidth/Height` mirror the
 * context canvas by default (the healthy case); `drawingBufferOverride` pins
 * them to a smaller value to simulate Chromium downsizing the buffer.
 */
const makeFakeContext = (opts: {
  maxTextureSize?: number;
  contextLost?: () => boolean;
  drawingBufferOverride?: { width: number; height: number };
} = {}) => {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;

  const isContextLost = opts.contextLost ?? (() => false);
  const cleanup = vi.fn();
  const loseContextExt = { loseContext: vi.fn() };

  const gl = {
    // Enum constants used by the implementation. Values are arbitrary but
    // distinct so a mixed-up argument would be visible in an assertion.
    TEXTURE_2D: 1,
    RGBA: 2,
    UNSIGNED_BYTE: 3,
    TEXTURE_MIN_FILTER: 4,
    TEXTURE_MAG_FILTER: 5,
    TEXTURE_WRAP_S: 6,
    TEXTURE_WRAP_T: 7,
    LINEAR: 8,
    CLAMP_TO_EDGE: 9,
    ARRAY_BUFFER: 10,
    FLOAT: 11,
    TRIANGLES: 12,
    MAX_TEXTURE_SIZE: 13,

    useProgram: vi.fn(),
    viewport: vi.fn(),
    createTexture: vi.fn(() => ({}) as WebGLTexture),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    bindBuffer: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn(() => ({}) as WebGLUniformLocation),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    drawArrays: vi.fn(),
    deleteTexture: vi.fn(),
    isContextLost: vi.fn(isContextLost),
    getExtension: vi.fn(() => loseContextExt),
    get drawingBufferWidth() {
      return opts.drawingBufferOverride?.width ?? canvas.width;
    },
    get drawingBufferHeight() {
      return opts.drawingBufferOverride?.height ?? canvas.height;
    },
  };

  const context = {
    gl: gl as unknown as WebGLRenderingContext,
    canvas,
    program: {} as WebGLProgram,
    positionBuffer: {} as WebGLBuffer,
    textureCoordBuffer: {} as WebGLBuffer,
    maxTextureSize: opts.maxTextureSize ?? 4096,
    cleanup,
  } satisfies WebGLContext;

  return { context, gl, canvas, cleanup, loseContextExt };
};

describe('webglUtils', () => {
  beforeEach(() => {
    // jsdom has no WebGL; stubbing getContext keeps `initWebGLContext` on its
    // "not supported" path without the noisy "not implemented" console output.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement['getContext'];
  });

  describe('initWebGLContext', () => {
    it('returns null (without throwing) when no GL context can be created', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = initWebGLContext(1, 1, 'precision mediump float; void main() {}');
      expect(result).toBeNull();
      // Both context ids are attempted before giving up.
      const getContext = HTMLCanvasElement.prototype.getContext as unknown as ReturnType<typeof vi.fn>;
      expect(getContext).toHaveBeenCalledWith('webgl');
      expect(getContext).toHaveBeenCalledWith('experimental-webgl');
      warn.mockRestore();
    });
  });

  describe('applyWebGLEffects', () => {
    it('returns null without an undefined context', () => {
      expect(applyWebGLEffects(makeSource(100, 100), ADJUSTMENTS, undefined)).toBeNull();
    });

    it('refuses a source larger than MAX_TEXTURE_SIZE before touching the GPU', () => {
      const { context, gl, canvas } = makeFakeContext({ maxTextureSize: 4096 });

      const result = applyWebGLEffects(makeSource(4800, 3600), ADJUSTMENTS, context);

      expect(result).toBeNull();
      expect(gl.useProgram).not.toHaveBeenCalled();
      expect(gl.texImage2D).not.toHaveBeenCalled();
      // The context canvas must NOT have been grown for a draw we abandoned.
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(600);
    });

    it('renders a within-limit source and returns the resized context canvas', () => {
      const { context, gl, canvas } = makeFakeContext({ maxTextureSize: 8192 });

      const result = applyWebGLEffects(makeSource(1600, 1200), ADJUSTMENTS, context);

      expect(result).toBe(canvas);
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBe(1200);
      expect(gl.useProgram).toHaveBeenCalledTimes(1);
      expect(gl.texImage2D).toHaveBeenCalledTimes(1);
      expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 6);
      expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    });

    it('returns null when the context is lost right after the resize', () => {
      const { context, gl } = makeFakeContext({ maxTextureSize: 8192, contextLost: () => true });

      expect(applyWebGLEffects(makeSource(1600, 1200), ADJUSTMENTS, context)).toBeNull();
      expect(gl.texImage2D).not.toHaveBeenCalled();
    });

    it('returns null when the drawing buffer came back smaller than requested', () => {
      const { context, gl } = makeFakeContext({
        maxTextureSize: 8192,
        drawingBufferOverride: { width: 2048, height: 1536 },
      });

      expect(applyWebGLEffects(makeSource(4096, 3072), ADJUSTMENTS, context)).toBeNull();
      expect(gl.texImage2D).not.toHaveBeenCalled();
    });

    it('returns null when the context is lost after the draw', () => {
      // Healthy through the guards, lost by the time we would hand back the
      // canvas: the first two `isContextLost` reads (post-resize guard) are
      // false, the final one true.
      let calls = 0;
      const { context, gl } = makeFakeContext({
        maxTextureSize: 8192,
        contextLost: () => {
          calls += 1;
          return calls > 1;
        },
      });

      expect(applyWebGLEffects(makeSource(1600, 1200), ADJUSTMENTS, context)).toBeNull();
      expect(gl.drawArrays).toHaveBeenCalledTimes(1);
    });
  });

  describe('loseWebGLContext', () => {
    it('cleans up and forcibly loses a healthy context', () => {
      const { context, gl, cleanup, loseContextExt } = makeFakeContext();

      loseWebGLContext(context);

      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(gl.getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
      expect(loseContextExt.loseContext).toHaveBeenCalledTimes(1);
    });

    it('is a no-op on an already-lost context', () => {
      const { context, cleanup, loseContextExt } = makeFakeContext({ contextLost: () => true });

      loseWebGLContext(context);

      expect(cleanup).not.toHaveBeenCalled();
      expect(loseContextExt.loseContext).not.toHaveBeenCalled();
    });

    it('still cleans up (and does not throw) when the extension is unavailable', () => {
      const { context, gl, cleanup } = makeFakeContext();
      gl.getExtension = vi.fn(() => null) as unknown as typeof gl.getExtension;

      expect(() => loseWebGLContext(context)).not.toThrow();
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });
});
