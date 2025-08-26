// WebGL Context Manager - Handles context pooling and resource management
// Prevents browser WebGL context exhaustion by sharing contexts

import { initWebGLContext, getFragmentShaderForEffects, type WebGLContext } from './webglUtils';

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
    console.log(`WebGL context pool initialized with ${this.availableContexts.length} pre-warmed contexts`);
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
    
    // Clean up on page unload and make globally available
    if (typeof window !== 'undefined') {
      (window as any).webglManager = contextManager;
      
      window.addEventListener('beforeunload', () => {
        contextManager?.cleanup();
      });
    }
  }
  return contextManager;
}

// Hook for React components to use managed WebGL contexts
export function useWebGLContext(): {
  requestContext: () => WebGLContext | null;
  releaseContext: (context: WebGLContext) => void;
  isAvailable: boolean;
} {
  const manager = getWebGLContextManager();
  
  return {
    requestContext: () => manager.requestContext(),
    releaseContext: (context: WebGLContext) => manager.releaseContext(context),
    isAvailable: manager.getAvailableContextCount() > 0
  };
}
