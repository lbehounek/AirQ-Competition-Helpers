import { describe, it, expect, vi, afterEach } from 'vitest';

// `DEBUG_RENDER` is read once at module evaluation (so the bundler can drop the
// call bodies in production), which means every case has to re-import the
// module after stubbing the env var. `vi.resetModules()` is what makes the
// dynamic import re-evaluate instead of handing back the cached instance.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

async function loadDebugLog(value?: string) {
  vi.resetModules();
  if (value === undefined) {
    vi.stubEnv('VITE_DEBUG_RENDER', '');
  } else {
    vi.stubEnv('VITE_DEBUG_RENDER', value);
  }
  return import('../utils/debugLog');
}

describe('debugLog', () => {
  it('forwards to console.log with every argument when VITE_DEBUG_RENDER is "true"', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { debugLog, DEBUG_RENDER } = await loadDebugLog('true');

    expect(DEBUG_RENDER).toBe(true);
    debugLog('🎨 render', 42, { a: 1 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('🎨 render', 42, { a: 1 });
  });

  it('is silent when the flag is unset', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { debugLog, DEBUG_RENDER } = await loadDebugLog();

    expect(DEBUG_RENDER).toBe(false);
    debugLog('should not appear');

    expect(spy).not.toHaveBeenCalled();
  });

  it('is silent for any value other than the exact string "true"', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // '1' / 'TRUE' deliberately do NOT enable it — one spelling keeps the
    // production dead-code elimination predictable.
    for (const value of ['false', '1', 'TRUE', 'yes']) {
      const { debugLog, DEBUG_RENDER } = await loadDebugLog(value);
      expect(DEBUG_RENDER).toBe(false);
      debugLog('nope', value);
    }

    expect(spy).not.toHaveBeenCalled();
  });
});
