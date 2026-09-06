/**
 * `acquireDedicatedWebGLContext` — the private context the PDF export uses so
 * it never grows (and never keeps) one of the editor pool's contexts.
 *
 * Every case re-imports the module after `vi.resetModules()` because the pool
 * lives in a module-level singleton; a shared instance would leak pre-warm
 * `initWebGLContext` calls between cases and break the call-count assertions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WebGLContext } from '../utils/webglUtils';

vi.mock('../utils/webglUtils', () => ({
  initWebGLContext: vi.fn(),
  getFragmentShaderForEffects: vi.fn(() => 'FRAGMENT_SHADER_SOURCE'),
  isWebGLSupported: vi.fn(() => true),
  loseWebGLContext: vi.fn(),
}));

const webglUtils = await import('../utils/webglUtils');
const initWebGLContext = vi.mocked(webglUtils.initWebGLContext);
const isWebGLSupported = vi.mocked(webglUtils.isWebGLSupported);
const loseWebGLContext = vi.mocked(webglUtils.loseWebGLContext);

/** Minimal `WebGLContext` stand-in; only `gl.isContextLost` is ever read here. */
const makeContext = (contextLost = false): WebGLContext =>
  ({
    gl: { isContextLost: () => contextLost } as unknown as WebGLRenderingContext,
    canvas: document.createElement('canvas'),
    program: {} as WebGLProgram,
    positionBuffer: {} as WebGLBuffer,
    textureCoordBuffer: {} as WebGLBuffer,
    maxTextureSize: 8192,
    cleanup: vi.fn(),
  }) satisfies WebGLContext;

/** Fresh module instance per case so the pool singleton starts empty. */
const loadModule = async () => {
  vi.resetModules();
  return import('../utils/webglContextManager');
};

describe('acquireDedicatedWebGLContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isWebGLSupported.mockReturnValue(true);
  });

  it('returns null without creating a context when WebGL is unsupported', async () => {
    isWebGLSupported.mockReturnValue(false);
    const { acquireDedicatedWebGLContext } = await loadModule();

    expect(acquireDedicatedWebGLContext()).toBeNull();
    expect(initWebGLContext).not.toHaveBeenCalled();
  });

  it('returns null when context creation fails', async () => {
    initWebGLContext.mockReturnValue(null);
    const { acquireDedicatedWebGLContext } = await loadModule();

    expect(acquireDedicatedWebGLContext()).toBeNull();
  });

  it('creates a 1x1 context with the pool shader source', async () => {
    const context = makeContext();
    initWebGLContext.mockReturnValue(context);
    const { acquireDedicatedWebGLContext } = await loadModule();

    const handle = acquireDedicatedWebGLContext();

    expect(handle?.context).toBe(context);
    expect(initWebGLContext).toHaveBeenCalledWith(1, 1, 'FRAGMENT_SHADER_SOURCE');
  });

  it('rejects (and releases) a context that is born lost', async () => {
    const context = makeContext(true);
    initWebGLContext.mockReturnValue(context);
    const { acquireDedicatedWebGLContext } = await loadModule();

    expect(acquireDedicatedWebGLContext()).toBeNull();
    expect(loseWebGLContext).toHaveBeenCalledTimes(1);
    expect(loseWebGLContext).toHaveBeenCalledWith(context);
  });

  it('disposes exactly once even when called twice', async () => {
    const context = makeContext();
    initWebGLContext.mockReturnValue(context);
    const { acquireDedicatedWebGLContext } = await loadModule();

    const handle = acquireDedicatedWebGLContext()!;
    handle.dispose();
    handle.dispose();

    expect(loseWebGLContext).toHaveBeenCalledTimes(1);
    expect(loseWebGLContext).toHaveBeenCalledWith(context);
  });

  it('does not touch the shared pool', async () => {
    initWebGLContext.mockImplementation(() => makeContext());
    const { acquireDedicatedWebGLContext, getWebGLContextManager } = await loadModule();

    acquireDedicatedWebGLContext()!.dispose();
    // Exactly one context created: the private one. The pool's 3-context
    // pre-warm has not run.
    expect(initWebGLContext).toHaveBeenCalledTimes(1);

    // …and the pool still pre-warms independently afterwards.
    getWebGLContextManager();
    expect(initWebGLContext.mock.calls.length).toBeGreaterThan(1);
  });
});
