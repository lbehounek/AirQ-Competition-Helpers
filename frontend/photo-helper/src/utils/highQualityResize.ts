/**
 * High-quality image resizing using Pica library
 * Provides superior resampling compared to browser's default bilinear interpolation
 */

import Pica from 'pica';

// Global Pica instance with optimized settings
let picaInstance: Pica | null = null;

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
    options: any
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
    options: any
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
    options: any,
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
    
    // Make it available globally for debugging
    if (typeof window !== 'undefined') {
      (window as any).resizeCache = resizeCacheInstance;
    }
  }
  return resizeCacheInstance;
};

const getPicaInstance = (): Pica => {
  if (!picaInstance) {
    picaInstance = new Pica({
      // Enable all available optimizations
      features: ['js', 'wasm', 'ww'], // JavaScript, WebAssembly, Web Workers
      
      // Use high-quality settings for static rendering
      filter: 'lanczos',  // Best quality filter for downsampling
      
      // Enable unsharp masking for post-sharpening
      unsharpAmount: 80,      // Sharpening strength (0-500, default 0)
      unsharpRadius: 0.6,     // Sharpening radius (0.5-2.0, default 0.6)
      unsharpThreshold: 2,    // Threshold to avoid noise (0-255, default 2)
      
      // Quality vs performance balance for static rendering
      quality: 3,  // 0-3, higher = better quality, slower processing
      
      // Alpha handling
      alpha: true
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
  options: {
    unsharpAmount?: number;
    unsharpRadius?: number;
    unsharpThreshold?: number;
    filter?: 'lanczos' | 'box' | 'hamming' | 'catrom' | 'mitchell';
    quality?: 0 | 1 | 2 | 3;
  } = {}
): Promise<HTMLCanvasElement> => {
  const pica = getPicaInstance();
  
  // Create target canvas
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = targetWidth;
  targetCanvas.height = targetHeight;
  
  try {
    // Use Pica for high-quality resizing
    await pica.resize(sourceCanvas, targetCanvas, {
      filter: options.filter || 'lanczos',
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
  options: {
    unsharpAmount?: number;
    unsharpRadius?: number;
    unsharpThreshold?: number;
    filter?: 'lanczos' | 'box' | 'hamming' | 'catrom' | 'mitchell';
    quality?: 0 | 1 | 2 | 3;
  } = {}
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
  options: {
    unsharpAmount?: number;
    unsharpRadius?: number;
    unsharpThreshold?: number;
  } = {}
): Promise<HTMLCanvasElement> => {
  const sourceWidth = sourceImage.width;
  const sourceHeight = sourceImage.height;
  
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  const scale = Math.min(scaleX, scaleY);
  
  // If reduction is small (<50%), use single pass
  if (scale >= 0.5) {
    return resizeImageHighQuality(sourceImage, targetWidth, targetHeight, {
      filter: 'lanczos',
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
      filter: 'lanczos',
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
      filter: 'lanczos',
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
  options: {
    unsharpAmount?: number;
    unsharpRadius?: number;
    unsharpThreshold?: number;
    forceMultiPass?: boolean;
  } = {}
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
      filter: 'lanczos',
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
    features: (pica as any).features || [],
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
