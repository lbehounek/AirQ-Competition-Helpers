/**
 * High-quality image resizing using Pica library
 * Provides superior resampling compared to browser's default bilinear interpolation
 */

import Pica from 'pica';

// Global Pica instance with optimized settings
let picaInstance: Pica.Pica | null = null;

/**
 * Unsharp-mask knobs, shared by every resize entry point in this file.
 * Split out because the three public helpers plus the cache all need the same
 * trio and they had drifted into four hand-copied inline literals.
 */
export interface ResizeSharpenOptions {
  unsharpAmount?: number;
  unsharpRadius?: number;
  unsharpThreshold?: number;
}

/**
 * Options accepted by the pica-backed single-pass resizers.
 *
 * `filter` lists pica 9's actual filter names. An earlier union
 * ('lanczos'/'catrom'/'mitchell') matched none of them; it stayed harmless
 * only because the legacy `quality: 3` option makes pica overwrite `filter`
 * with 'lanczos3' internally.
 */
export interface HighQualityResizeOptions extends ResizeSharpenOptions {
  filter?: 'box' | 'hamming' | 'lanczos2' | 'lanczos3' | 'mks2013';
  quality?: 0 | 1 | 2 | 3;
}

/**
 * Options for `intelligentResize`, which picks single- vs multi-pass itself.
 * `filter`/`quality` are absent on purpose — the strategy owns those — and
 * this whole object doubles as part of the resize cache key, so every field
 * has to be JSON-serializable.
 */
export interface IntelligentResizeOptions extends ResizeSharpenOptions {
  forceMultiPass?: boolean;
}

// Cache for high-quality resized images
interface ResizeCache {
  canvas: HTMLCanvasElement;
  timestamp: number;
  sourceImageKey: string;
  targetWidth: number;
  targetHeight: number;
  options: string; // serialized options for cache key
}

class HighQualityResizeCache {
  private cache = new Map<string, ResizeCache>();
  private maxAge = 10 * 60 * 1000; // 10 minutes cache lifetime
  private maxSize = 20; // Maximum number of cached resized images

  /**
   * Generate cache key from image and parameters
   */
  private getCacheKey(
    imageKey: string,
    targetWidth: number,
    targetHeight: number,
    // The cache is only ever driven by `intelligentResize`, so this is that
    // function's option bag verbatim — serialized into the key below.
    options: IntelligentResizeOptions
  ): string {
    const optionsKey = JSON.stringify(options);
    return `${imageKey}-${targetWidth}x${targetHeight}-${optionsKey}`;
  }

  /**
   * Get cached resized image if available
   */
  getCached(
    imageKey: string,
    targetWidth: number,
    targetHeight: number,
    options: IntelligentResizeOptions
  ): HTMLCanvasElement | null {
    const cacheKey = this.getCacheKey(imageKey, targetWidth, targetHeight, options);
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.maxAge) {
      console.log(`✨ Using cached high-quality resize: ${cacheKey}`);
      return cached.canvas;
    }

    // Remove expired entry
    if (cached) {
      this.cache.delete(cacheKey);
    }

    return null;
  }

  /**
   * Cache a resized image
   */
  setCached(
    imageKey: string,
    targetWidth: number,
    targetHeight: number,
    options: IntelligentResizeOptions,
    canvas: HTMLCanvasElement
  ): void {
    const cacheKey = this.getCacheKey(imageKey, targetWidth, targetHeight, options);
    
    // Clone the canvas to avoid issues with modifications
    const clonedCanvas = document.createElement('canvas');
    clonedCanvas.width = canvas.width;
    clonedCanvas.height = canvas.height;
    const ctx = clonedCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(canvas, 0, 0);
    }

    this.cache.set(cacheKey, {
      canvas: clonedCanvas,
      timestamp: Date.now(),
      sourceImageKey: imageKey,
      targetWidth,
      targetHeight,
      options: JSON.stringify(options)
    });

    console.log(`💾 Cached high-quality resize: ${cacheKey}`);
    this.cleanup();
  }

  /**
   * Generate a unique key for an image
   */
  getImageKey(image: HTMLImageElement): string {
    // Use src + dimensions as unique identifier
    return `${image.src}-${image.width}x${image.height}`;
  }

  /**
   * Clean up old cache entries
   */
  private cleanup(): void {
    if (this.cache.size <= this.maxSize) return;

    // Sort entries by timestamp and remove oldest
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, this.cache.size - this.maxSize);
    toRemove.forEach(([key]) => {
      console.log(`🗑️ Removing old cached resize: ${key}`);
      this.cache.delete(key);
    });
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    console.log('🗑️ High-quality resize cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      entries: Array.from(this.cache.keys())
    };
  }
}

// Singleton cache instance
let resizeCacheInstance: HighQualityResizeCache | null = null;

const getResizeCache = (): HighQualityResizeCache => {
  if (!resizeCacheInstance) {
    resizeCacheInstance = new HighQualityResizeCache();
    
    // Make it available globally for debugging. Cast to a `window` view that
    // names exactly this one extra property instead of `any`: it is a devtools
    // convenience, and nothing in the app reads it back.
    if (typeof window !== 'undefined') {
      (window as Window & { resizeCache?: HighQualityResizeCache }).resizeCache = resizeCacheInstance;
    }
  }
  return resizeCacheInstance;
};

const getPicaInstance = (): Pica.Pica => {
  if (!picaInstance) {
    // Constructor options are pool/feature settings ONLY. pica merges its own
    // DEFAULT_RESIZE_OPTS with the per-call options inside `resize()` and never
    // consults `this.options` for filter/unsharp/quality — so the sharpening and
    // filter settings that used to sit here were silently ignored. They live
    // (unchanged) on every `pica.resize()` call in this file instead.
    picaInstance = new Pica({
      // Enable all available optimizations: JavaScript, WebAssembly, Web Workers
      features: ['js', 'wasm', 'ww'],
    });
  }
  return picaInstance;
};

/**
 * High-quality canvas resizing using Pica
 * Significantly better quality than browser's default drawImage()
 */
export const resizeCanvasHighQuality = async (
  sourceCanvas: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  options: HighQualityResizeOptions = {}
): Promise<HTMLCanvasElement> => {
  const pica = getPicaInstance();
  
  // Create target canvas
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = targetWidth;
  targetCanvas.height = targetHeight;
  
  try {
    // Use Pica for high-quality resizing
    await pica.resize(sourceCanvas, targetCanvas, {
      filter: options.filter || 'lanczos3',
      unsharpAmount: options.unsharpAmount ?? 80,
      unsharpRadius: options.unsharpRadius ?? 0.6,
      unsharpThreshold: options.unsharpThreshold ?? 2,
      quality: options.quality ?? 3
    });
    
    return targetCanvas;
  } catch (error) {
    console.warn('Pica high-quality resize failed, falling back to browser resize:', error);
    
    // Fallback to browser's default resizing
    const ctx = targetCanvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
    }
    
    return targetCanvas;
  }
};

/**
 * High-quality image-to-canvas resizing
 * Direct resizing from HTMLImageElement with Pica quality
 */
export const resizeImageHighQuality = async (
  sourceImage: HTMLImageElement,
  targetWidth: number,
  targetHeight: number,
  options: HighQualityResizeOptions = {}
): Promise<HTMLCanvasElement> => {
  // First, draw image to a source canvas at original size
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = sourceImage.width;
  sourceCanvas.height = sourceImage.height;
  
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) {
    throw new Error('Failed to get source canvas context');
  }
  
  // Draw original image to source canvas
  sourceCtx.drawImage(sourceImage, 0, 0);
  
  // Use high-quality resize
  return resizeCanvasHighQuality(sourceCanvas, targetWidth, targetHeight, options);
};

/**
 * Multi-pass downsampling for extreme size reductions
 * For very large images (>4x reduction), use multiple steps for best quality
 */
export const resizeImageMultiPass = async (
  sourceImage: HTMLImageElement,
  targetWidth: number,
  targetHeight: number,
  options: ResizeSharpenOptions = {}
): Promise<HTMLCanvasElement> => {
  const sourceWidth = sourceImage.width;
  const sourceHeight = sourceImage.height;
  
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  const scale = Math.min(scaleX, scaleY);
  
  // If reduction is small (<50%), use single pass
  if (scale >= 0.5) {
    return resizeImageHighQuality(sourceImage, targetWidth, targetHeight, {
      filter: 'lanczos3',
      quality: 3,
      ...options
    });
  }
  
  // For large reductions, use multi-pass approach
  let currentCanvas = document.createElement('canvas');
  currentCanvas.width = sourceWidth;
  currentCanvas.height = sourceHeight;
  
  const ctx = currentCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context for multi-pass resize');
  }
  
  // Draw original image
  ctx.drawImage(sourceImage, 0, 0);
  
  let currentWidth = sourceWidth;
  let currentHeight = sourceHeight;
  
  // Iteratively downscale by max 50% each step until we reach target size
  while (currentWidth > targetWidth * 1.1 || currentHeight > targetHeight * 1.1) {
    const nextWidth = Math.max(targetWidth, Math.floor(currentWidth * 0.5));
    const nextHeight = Math.max(targetHeight, Math.floor(currentHeight * 0.5));
    
    const nextCanvas = await resizeCanvasHighQuality(currentCanvas, nextWidth, nextHeight, {
      filter: 'lanczos3',
      quality: 3,
      unsharpAmount: 0, // No sharpening on intermediate steps
      unsharpRadius: 0.6,
      unsharpThreshold: 2
    });
    
    currentCanvas = nextCanvas;
    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }
  
  // Final resize to exact target size with sharpening
  if (currentWidth !== targetWidth || currentHeight !== targetHeight) {
    currentCanvas = await resizeCanvasHighQuality(currentCanvas, targetWidth, targetHeight, {
      filter: 'lanczos3',
      quality: 3,
      ...options // Apply final sharpening
    });
  }
  
  return currentCanvas;
};

/**
 * Intelligent resize that chooses the best strategy based on size reduction
 * Includes caching for performance optimization
 */
export const intelligentResize = async (
  sourceImage: HTMLImageElement,
  targetWidth: number,
  targetHeight: number,
  options: IntelligentResizeOptions = {}
): Promise<HTMLCanvasElement> => {
  const cache = getResizeCache();
  const imageKey = cache.getImageKey(sourceImage);
  
  // Check cache first
  const cached = cache.getCached(imageKey, targetWidth, targetHeight, options);
  if (cached) {
    // Return a copy of the cached canvas to avoid modifications
    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = cached.width;
    resultCanvas.height = cached.height;
    const ctx = resultCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(cached, 0, 0);
    }
    return resultCanvas;
  }

  const sourceWidth = sourceImage.width;
  const sourceHeight = sourceImage.height;
  
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  const scale = Math.min(scaleX, scaleY);
  
  let resultCanvas: HTMLCanvasElement;
  
  // Use multi-pass for large reductions or when forced
  if (scale < 0.25 || options.forceMultiPass) {
    console.log(`📐 Using multi-pass resize for ${sourceWidth}x${sourceHeight} → ${targetWidth}x${targetHeight} (scale: ${scale.toFixed(3)})`);
    resultCanvas = await resizeImageMultiPass(sourceImage, targetWidth, targetHeight, options);
  } else {
    console.log(`📐 Using single-pass resize for ${sourceWidth}x${sourceHeight} → ${targetWidth}x${targetHeight} (scale: ${scale.toFixed(3)})`);
    resultCanvas = await resizeImageHighQuality(sourceImage, targetWidth, targetHeight, {
      filter: 'lanczos3',
      quality: 3,
      ...options
    });
  }
  
  // Cache the result
  cache.setCached(imageKey, targetWidth, targetHeight, options, resultCanvas);
  
  return resultCanvas;
};

/**
 * Check if Pica WebAssembly is available
 */
export const isPicaWasmAvailable = (): boolean => {
  try {
    return typeof WebAssembly !== 'undefined' && typeof WebAssembly.validate === 'function';
  } catch {
    return false;
  }
};

/**
 * Get Pica capabilities and performance info
 */
export const getPicaInfo = () => {
  const pica = getPicaInstance();
  return {
    hasWasm: isPicaWasmAvailable(),
    hasWebWorkers: typeof Worker !== 'undefined',
    // pica's *instance* carries a detected-capability map
    // (`{ js, wasm, cib, ww }`) that `@types/pica` never declares — its
    // `features` entry models the constructor *option*, which is an array of
    // names. Read it through a structural view of just that member. The old
    // `|| []` fallback was dead code and misdescribed the value as an array:
    // pica creates the map in its constructor, so it is always an object.
    features: (pica as unknown as { features?: Partial<Record<'js' | 'wasm' | 'cib' | 'ww', boolean>> }).features ?? {},
    version: 'pica-js'
  };
};

/**
 * Get resize cache for debugging and management
 */
export const getHighQualityResizeCache = () => getResizeCache();

/**
 * Clear all cached resized images
 */
export const clearResizeCache = () => {
  getResizeCache().clear();
};
