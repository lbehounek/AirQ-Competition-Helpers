// WebGL Context Manager - Handles context pooling and resource management
// Prevents browser WebGL context exhaustion by sharing contexts

import {
  initWebGLContext,
  getFragmentShaderForEffects,
  isWebGLSupported,
  loseWebGLContext,
  type WebGLContext,
} from './webglUtils';
import { debugLog } from './debugLog';

export interface WebGLContextManager {
  requestContext(): WebGLContext | null;
  releaseContext(context: WebGLContext): void;
  getAvailableContextCount(): number;
  getTotalContextCount(): number;
  cleanup(): void;
}

class WebGLContextPool implements WebGLContextManager {
  private activeContexts = new Set<WebGLContext>();
  private availableContexts: WebGLContext[] = [];
  private readonly maxContexts = 8; // Increased slightly but still safe
  private readonly contextWidth = 800;  // Standard processing size
  private readonly contextHeight = 600; // Standard processing size
  
  constructor() {
    // Pre-warm the pool with multiple contexts for immediate availability
    // This prevents the initial rush of context creation when photos first load
    const prewarmCount = 3;
    for (let i = 0; i < prewarmCount; i++) {
      const context = this.createContext();
      if (context) {
        this.availableContexts.push(context);
      }
    }
    debugLog(`WebGL context pool initialized with ${this.availableContexts.length} pre-warmed contexts`);
  }

  private createContext(): WebGLContext | null {
    if (this.getTotalContextCount() >= this.maxContexts) {
      console.warn(`WebGL context pool exhausted (${this.maxContexts} contexts active)`);
      return null;
    }

    try {
      // Create context with combined effects shader (most flexible)
      const fragmentShader = getFragmentShaderForEffects(true);
      const context = initWebGLContext(this.contextWidth, this.contextHeight, fragmentShader);
      
      if (!context) {
        console.warn('Failed to create WebGL context - WebGL may not be supported');
        return null;
      }

      // Add cleanup handler for when context is released
      const originalCleanup = context.cleanup;
      context.cleanup = () => {
        this.activeContexts.delete(context);
        originalCleanup();
      };

      return context;
    } catch (error) {
      console.error('Error creating WebGL context:', error);
      return null;
    }
  }

  requestContext(): WebGLContext | null {
    // Try to reuse an available context first
    if (this.availableContexts.length > 0) {
      const context = this.availableContexts.pop()!;
      this.activeContexts.add(context);
      // console.log(`Reusing WebGL context. Active: ${this.activeContexts.size}, Available: ${this.availableContexts.length}`);
      return context;
    }

    // Create a new context if under the limit
    const newContext = this.createContext();
    if (newContext) {
      this.activeContexts.add(newContext);
      // console.log(`Created new WebGL context. Active: ${this.activeContexts.size}, Available: ${this.availableContexts.length}`);
      return newContext;
    }

    // No contexts available
    console.warn(`No WebGL contexts available. Active: ${this.activeContexts.size}, Pool limit: ${this.maxContexts}`);
    return null;
  }

  releaseContext(context: WebGLContext): void {
    if (!this.activeContexts.has(context)) {
      console.warn('Attempted to release context that is not tracked by the pool');
      return;
    }

    this.activeContexts.delete(context);
    
    // Keep context available for reuse rather than destroying it immediately
    // This reduces context creation/destruction cycles
    if (this.availableContexts.length < 4) { // Keep more contexts in reserve for quick reuse
      this.availableContexts.push(context);
    } else {
      // If we have enough in reserve, clean up this one
      context.cleanup();
    }
  }

  getAvailableContextCount(): number {
    return this.maxContexts - this.activeContexts.size;
  }

  getTotalContextCount(): number {
    return this.activeContexts.size + this.availableContexts.length;
  }

  cleanup(): void {
    // Clean up all contexts
    this.activeContexts.forEach(context => context.cleanup());
    this.availableContexts.forEach(context => context.cleanup());
    
    this.activeContexts.clear();
    this.availableContexts.length = 0;
  }
}

// Singleton instance
let contextManager: WebGLContextPool | null = null;

export function getWebGLContextManager(): WebGLContextManager {
  if (!contextManager) {
    contextManager = new WebGLContextPool();
    
    // Clean up on page unload and make globally available. The `window` cast
    // names exactly this one debug property instead of widening to `any` —
    // nothing in the app reads it back, it exists for devtools inspection of
    // the pool (`webglManager.getAvailableContextCount()`).
    if (typeof window !== 'undefined') {
      (window as Window & { webglManager?: WebGLContextManager }).webglManager = contextManager;
      
      window.addEventListener('beforeunload', () => {
        contextManager?.cleanup();
      });
    }
  }
  return contextManager;
}

/**
 * A WebGL context owned by exactly one caller, with an idempotent teardown.
 * `dispose()` releases the GL objects AND the drawing buffer (see
 * `loseWebGLContext`), so calling it twice — eagerly plus from a `finally` —
 * is safe and free.
 */
export interface DedicatedWebGLContext {
  context: WebGLContext;
  dispose: () => void;
}

/**
 * Create a private WebGL context for one long, one-shot job (today: the PDF
 * export). Returns `null` when WebGL is unavailable or the context is born
 * lost — callers are expected to fall back to their CPU path.
 *
 * WHY not borrow from the shared pool:
 * (i)  `applyWebGLEffects` resizes the context's canvas to the source size, so
 *      a pooled 800x600 context borrowed for one 4800x3600 photo would return
 *      to the editor grid carrying a ~69 MB drawing buffer for the rest of the
 *      session. A private 1x1 context grows only for the export and is lost in
 *      `dispose()`.
 * (ii) `isWebGLSupported()` is the CACHED probe, so a machine without WebGL
 *      does not emit `initWebGLContext`'s `console.warn` on every export.
 * (iii) Same shader source as the pool (`getFragmentShaderForEffects(true)`) —
 *      that identity is what makes the printed sheet match the live preview on
 *      the same GPU.
 */
export function acquireDedicatedWebGLContext(): DedicatedWebGLContext | null {
  if (!isWebGLSupported()) return null;

  const context = initWebGLContext(1, 1, getFragmentShaderForEffects(true));
  if (!context) return null;

  // A context can be handed back already lost when the browser is at its
  // per-page context cap and evicted this one immediately. Losing it properly
  // (rather than dropping the reference) frees the slot for the editor pool.
  if (context.gl.isContextLost()) {
    loseWebGLContext(context);
    return null;
  }

  let disposed = false;
  return {
    context,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      loseWebGLContext(context);
    },
  };
}

// NB: there is deliberately no `useWebGLContext()` hook here any more. It
// returned a fresh object literal (with an `isAvailable` snapshot taken at
// render time) on every render, which changed `renderCanvas`'s identity in
// PhotoEditorApi and redrew every mounted canvas on every React render.
// Consumers build their own `useMemo`'d handle around `getWebGLContextManager()`
// with `isAvailable` as a getter, so the availability is read when the draw
// actually happens rather than when the component last rendered.
