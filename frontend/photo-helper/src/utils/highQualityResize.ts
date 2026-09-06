/**
 * High-quality image resizing using Pica library
 * Provides superior resampling compared to browser's default bilinear interpolation
 */

import Pica from 'pica';
import { debugLog } from './debugLog';

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
  /**
   * Bypass the resize cache for THIS call — no read, no write.
   *
   * The PDF export sets it: it asks for sizes (1600 px × the photo's zoom) the
   * editor never requests, so caching them buys nothing and evicts exactly the
   * large-modal entries the cache exists to serve, at the price of a full-size
   * canvas clone per photo.
   *
   * Deliberately per-call rather than a process-wide "suspend" flag: the export
   * yields between photos, so the editor stays interactive while it runs, and a
   * global bypass also disabled caching for any modal redraw the user triggered
   * in that window. Excluded from the cache key by `getCacheKey`: it selects
   * behaviour rather than describing the output, so a caller that omits it must
   * still find what a caller that passed `false` stored.
   */
  skipCache?: boolean;
}

/**
 * Options shared by both intermediate (non-final) multi-pass steps.
 * Extracted because the first pass and the loop passes must stay identical —
 * they were two hand-copied literals, and sharpening applied on an
 * intermediate step compounds through the remaining passes.
 */
const INTERMEDIATE_PASS_OPTIONS: HighQualityResizeOptions = {
  filter: 'lanczos3',
  quality: 3,
  unsharpAmount: 0, // No sharpening on intermediate steps
  unsharpRadius: 0.6,
  unsharpThreshold: 2,
};

// Cache for high-quality resized images
interface ResizeCache {
  canvas: HTMLCanvasElement;
  timestamp: number;
  sourceImageKey: string;
  targetWidth: number;
  targetHeight: number;
  options: string; // serialized options for cache key
  /** Pixel count of the cached canvas — the unit the cache budget is spent in. */
  pixels: number;
}

class HighQualityResizeCache {
  private cache = new Map<string, ResizeCache>();
  private maxAge = 10 * 60 * 1000; // 10 minutes cache lifetime
  /**
   * Memory budget in PIXELS, not entries. ≈64 MB of RGBA backing store, i.e.
   * ~6 large-modal entries at zoom 3 (600x450x3 ≈ 2.4 MP each).
   *
   * WHY the change from `maxSize = 20`: entry count says nothing about memory.
   * Twenty unbounded entries could hold well over a gigabyte after a single
   * PDF export (each export canvas is up to 4800x3600), which is fatal on the
   * 4 GB competition laptops this app targets.
   */
  private readonly maxTotalPixels = 16_000_000;
  /** Running sum of `pixels` over `cache`; kept in step with every mutation. */
  private totalPixels = 0;

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
    // `skipCache` says whether to USE the cache, not what the output looks
    // like, so it must not vary the key: including it would file an entry
    // under `"skipCache":false` that a caller omitting the option could never
    // find, silently fragmenting the cache in two.
    const identityOptions: Omit<IntelligentResizeOptions, 'skipCache'> = { ...options };
    delete (identityOptions as IntelligentResizeOptions).skipCache;
    const optionsKey = JSON.stringify(identityOptions);
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
      debugLog(`✨ Using cached high-quality resize: ${cacheKey}`);
      return cached.canvas;
    }

    // Remove expired entry (and give its pixels back to the budget)
    if (cached) {
      this.cache.delete(cacheKey);
      this.totalPixels -= cached.pixels;
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
    const pixels = canvas.width * canvas.height;

    // Skip an entry that could never fit the budget — BEFORE cloning. The
    // clone is a full-size `drawImage` (up to ~69 MB for a PDF-sized canvas),
    // so cloning first and evicting afterwards would pay the whole cost for
    // nothing. Only oversize single entries are dropped here; ordinary
    // overflow is handled by eviction in `cleanup()`.
    if (pixels > this.maxTotalPixels) {
      debugLog(`⏭️ Skipping oversize resize cache entry (${pixels} px): ${cacheKey}`);
      return;
    }

    // Replacing an existing key: reclaim the old entry's pixels first so the
    // running total cannot drift upward on repeated writes to the same key.
    const previous = this.cache.get(cacheKey);
    if (previous) {
      this.totalPixels -= previous.pixels;
    }

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
      options: JSON.stringify(options),
      pixels,
    });
    this.totalPixels += pixels;

    debugLog(`💾 Cached high-quality resize: ${cacheKey}`);
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
   * Evict oldest-first until the total pixel budget is respected.
   * Returns nothing. A single entry larger than the whole budget can never
   * reach here — `setCached` refuses it before cloning — so the loop always
   * terminates while entries remain.
   */
  private cleanup(): void {
    if (this.totalPixels <= this.maxTotalPixels) return;

    // Oldest first; `timestamp` is set on insert, so this is insertion order
    // in practice, but sorting keeps it correct if entries are ever refreshed.
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    for (const [key, entry] of entries) {
      if (this.totalPixels <= this.maxTotalPixels) break;
      debugLog(`🗑️ Removing old cached resize: ${key}`);
      this.cache.delete(key);
      this.totalPixels -= entry.pixels;
    }
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    this.totalPixels = 0;
    debugLog('🗑️ High-quality resize cache cleared');
  }

  /**
   * Get cache statistics (devtools only — exposed on `window.resizeCache`).
   * Returns the entry count, the pixel budget and its current usage, and the
   * live cache keys.
   */
  getStats() {
    return {
      size: this.cache.size,
      totalPixels: this.totalPixels,
      maxTotalPixels: this.maxTotalPixels,
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
 * High-quality resize of a canvas OR a decoded image using Pica.
 * Returns a freshly created target canvas of exactly `targetWidth` ×
 * `targetHeight`; never rejects — a pica failure falls back to the browser's
 * own `drawImage` scaling so callers always get a usable canvas.
 *
 * WHY it accepts an `HTMLImageElement` directly: pica pre-decodes an image
 * source once via `createImageBitmap` (off the main thread) and crops its
 * tiles from that bitmap. The intermediate full-resolution canvas this module
 * used to draw first was a ~48 MB allocation plus a full-size `drawImage` on
 * the main thread per resize — twice over for the multi-pass path — and bought
 * nothing: pica reads the same pixels either way.
 */
export const resizeCanvasHighQuality = async (
  source: HTMLCanvasElement | HTMLImageElement,
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
    await pica.resize(source, targetCanvas, {
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
      ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    }

    return targetCanvas;
  }
};

/**
 * High-quality image-to-canvas resizing.
 * Returns a canvas of exactly the requested size.
 *
 * Now a thin alias for {@link resizeCanvasHighQuality}: the image goes to pica
 * untouched instead of being copied into a full-resolution intermediate canvas
 * first. Kept as a named entry point because the strategy helpers below read
 * better with the image/canvas distinction spelled out at the call site.
 */
export const resizeImageHighQuality = async (
  sourceImage: HTMLImageElement,
  targetWidth: number,
  targetHeight: number,
  options: HighQualityResizeOptions = {}
): Promise<HTMLCanvasElement> => {
  return resizeCanvasHighQuality(sourceImage, targetWidth, targetHeight, options);
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
  
  // For large reductions, use a multi-pass approach. The FIRST pass reads the
  // image directly — previously the image was copied into a full-resolution
  // canvas (a 12 MP source = a 48 MB allocation plus a full drawImage on the
  // main thread) purely to have something canvas-shaped to hand pica.
  let currentWidth = Math.max(targetWidth, Math.floor(sourceWidth * 0.5));
  let currentHeight = Math.max(targetHeight, Math.floor(sourceHeight * 0.5));
  let currentCanvas = await resizeCanvasHighQuality(
    sourceImage,
    currentWidth,
    currentHeight,
    INTERMEDIATE_PASS_OPTIONS,
  );

  // Iteratively downscale by max 50% each step until we reach target size
  while (currentWidth > targetWidth * 1.1 || currentHeight > targetHeight * 1.1) {
    const nextWidth = Math.max(targetWidth, Math.floor(currentWidth * 0.5));
    const nextHeight = Math.max(targetHeight, Math.floor(currentHeight * 0.5));

    const nextCanvas = await resizeCanvasHighQuality(
      currentCanvas,
      nextWidth,
      nextHeight,
      INTERMEDIATE_PASS_OPTIONS,
    );

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

  // Check cache first (skipped entirely for a bypassing caller — see
  // `IntelligentResizeOptions.skipCache`)
  const cached = options.skipCache
    ? null
    : cache.getCached(imageKey, targetWidth, targetHeight, options);
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
    debugLog(`📐 Using multi-pass resize for ${sourceWidth}x${sourceHeight} → ${targetWidth}x${targetHeight} (scale: ${scale.toFixed(3)})`);
    resultCanvas = await resizeImageMultiPass(sourceImage, targetWidth, targetHeight, options);
  } else {
    debugLog(`📐 Using single-pass resize for ${sourceWidth}x${sourceHeight} → ${targetWidth}x${targetHeight} (scale: ${scale.toFixed(3)})`);
    resultCanvas = await resizeImageHighQuality(sourceImage, targetWidth, targetHeight, {
      filter: 'lanczos3',
      quality: 3,
      ...options
    });
  }
  
  // Cache the result (skipped for a bypassing caller)
  if (!options.skipCache) {
    cache.setCached(imageKey, targetWidth, targetHeight, options, resultCanvas);
  }

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
