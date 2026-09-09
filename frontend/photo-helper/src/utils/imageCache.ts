/**
 * Global image cache to prevent reloading images when photos are moved around
 */

import { debugLog } from './debugLog';

interface CachedImage {
  image: HTMLImageElement;
  url: string;
  timestamp: number;
}

class ImageCacheManager {
  private cache = new Map<string, CachedImage>();
  /** Loads started but not yet settled, keyed exactly like `cache` — see getImageByUrl. */
  private inflight = new Map<string, Promise<HTMLImageElement>>();
  private maxAge = 5 * 60 * 1000; // 5 minutes cache lifetime
  private maxSize = 50; // Maximum number of cached images

  /**
   * Get a cached image or load it if not cached
   */
  async getImage(photoId: string, sessionId: string): Promise<HTMLImageElement> {
    const cacheKey = `${sessionId}-${photoId}`;
    
    // Check if we have a valid cached image
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.maxAge) {
      debugLog(`✨ Using cached image for ${photoId}`);
      return cached.image;
    }

    // Load the image
    debugLog(`📥 Loading image for ${photoId}`);
    // `vite/client` types `import.meta.env` with a permissive index signature,
    // so reading a var straight off it hands back `any`. Take it as `unknown`
    // and check for a string before calling `.replace` — a non-string value
    // (mis-set at build time) would otherwise throw here rather than fall back.
    const configuredBase: unknown = import.meta.env?.VITE_API_BASE_URL;
    const base = (typeof configuredBase === 'string' ? configuredBase : '')
      .replace(/\/$/, ''); // Remove trailing slash
    const encodedSessionId = encodeURIComponent(sessionId);
    const encodedPhotoId = encodeURIComponent(photoId);
    const url = `${base}/api/photos/${encodedSessionId}/${encodedPhotoId}`;
    
    const img = await this.loadImage(url);
    
    // Cache the loaded image
    this.cache.set(cacheKey, {
      image: img,
      url,
      timestamp: Date.now()
    });

    // Clean up old entries if cache is too large
    this.cleanup();

    return img;
  }

  /**
   * Load an image from URL
   */
  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        resolve(img);
      };
      
      img.onerror = (error) => {
        reject(error);
      };
      
      img.src = url;
    });
  }

  /**
   * Get an image by direct URL with caching and eviction.
   *
   * Returns the decoded `HTMLImageElement` for `url`, reusing the cached one
   * when possible. Concurrent callers for the same key share one load, and
   * `blob:` URLs are never age-expired (see the two comments below). Rejects
   * with whatever `loadImage` rejects with (an `Event` from `img.onerror`).
   */
  async getImageByUrl(url: string, cacheKey?: string): Promise<HTMLImageElement> {
    const key = cacheKey || `url:${url}`;
    const cached = this.cache.get(key);
    // `blob:` URLs are immutable for their lifetime — one is created per photo
    // in useCompetitionSystem and revoked explicitly on removal / mode switch,
    // so the bytes behind a live blob URL can never change. Expiring them after
    // `maxAge` only forced a full-resolution re-decode on the next editor mount
    // (modal open, aspect-ratio remount, tray → slot) and left the previously
    // decoded element alive inside still-mounted editors while the cache held a
    // second copy. Non-blob URLs keep the age check: a server-side asset can
    // change behind a stable URL.
    const isImmutable = url.startsWith('blob:');
    if (cached && (isImmutable || Date.now() - cached.timestamp < this.maxAge)) {
      return cached.image;
    }

    // De-duplicate concurrent loads of the same key. React runs child effects
    // before parent effects, so every `useCachedImage` in a freshly mounted
    // PhotoEditorApi misses the cache and starts a load BEFORE PhotoGridApi's
    // `preloadImages` effect runs and starts a second load of the same URL —
    // every photo was decoded twice on first mount, and the two resulting
    // HTMLImageElements diverged between the cache and the mounted editors.
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const load = this.loadImage(url)
      .then(img => {
        this.cache.set(key, { image: img, url, timestamp: Date.now() });
        this.cleanup();
        return img;
      })
      // `finally` (not a `then` tail) so a failed load also clears the slot and
      // a later retry actually re-issues the request instead of re-awaiting a
      // permanently rejected promise.
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, load);
    return load;
  }

  /**
   * Clean up old cache entries
   */
  private cleanup() {
    if (this.cache.size <= this.maxSize) return;

    // Sort entries by timestamp and remove oldest
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, this.cache.size - this.maxSize);
    toRemove.forEach(([key]) => {
      debugLog(`🗑️ Removing old cached image: ${key}`);
      this.cache.delete(key);
    });
  }

  /**
   * Preload images for a set of photos (OPFS-only mode)
   */
  async preloadImages(photos: Array<{ id: string; sessionId: string; url?: string }>) {
    const promises = photos.map(async (photo) => {
      try {
        // OPFS-only mode: Only preload if we have a valid blob URL
        if (photo.url && photo.url.startsWith('blob:')) {
          return await this.getImageByUrl(photo.url);
        }
        // Skip photos without valid blob URLs
        return null;
      } catch (err) {
        console.error(`Failed to preload image ${photo.id}:`, err);
        return null;
      }
    });
    
    const results = await Promise.all(promises);
    const successful = results.filter(r => r !== null).length;
    debugLog(`✅ Preloaded ${successful} images`);
  }

  /**
   * Clear the entire cache
   */
  clear() {
    this.cache.clear();
    debugLog('🗑️ Image cache cleared');
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

// Singleton instance
let imageCacheInstance: ImageCacheManager | null = null;

export function getImageCache(): ImageCacheManager {
  if (!imageCacheInstance) {
    imageCacheInstance = new ImageCacheManager();
    
    // Make it available globally for debugging. Cast to a `window` view naming
    // exactly this one extra property rather than `any` — devtools convenience
    // only, no app code reads it back.
    if (typeof window !== 'undefined') {
      (window as Window & { imageCache?: ImageCacheManager }).imageCache = imageCacheInstance;
    }
  }
  return imageCacheInstance;
}

// React hook for using the image cache
import { useEffect, useState } from 'react';

export function useCachedImage(photoId: string, sessionId: string, directUrl?: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!photoId) {
      setImage(null);
      setLoading(false);
      return;
    }

    // OPFS-only mode: Only load images if we have a valid blob URL
    if (!directUrl || !directUrl.startsWith('blob:')) {
      setImage(null);
      setLoading(false);
      setError(new Error('No valid blob URL provided - OPFS-only mode'));
      return;
    }

    const cache = getImageCache();
    let cancelled = false;

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Only use blob URLs - no HTTP fallback
        const img = await cache.getImageByUrl(directUrl);
        
        if (!cancelled) {
          setImage(img);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
          setLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      cancelled = true;
    };
  }, [photoId, sessionId, directUrl]);

  return { image, loading, error };
}
