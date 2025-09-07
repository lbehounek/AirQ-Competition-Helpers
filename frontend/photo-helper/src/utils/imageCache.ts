/**
 * Global image cache to prevent reloading images when photos are moved around
 */

interface CachedImage {
  image: HTMLImageElement;
  url: string;
  timestamp: number;
}

class ImageCacheManager {
  private cache = new Map<string, CachedImage>();
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
      console.log(`✨ Using cached image for ${photoId}`);
      return cached.image;
    }

    // Load the image
    console.log(`📥 Loading image for ${photoId}`);
    const base = ((import.meta as any)?.env?.VITE_API_BASE_URL || '').replace(/\/$/, ''); // Remove trailing slash
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
   * Clean up old cache entries
   */
  private cleanup() {
    if (this.cache.size <= this.maxSize) return;

    // Sort entries by timestamp and remove oldest
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, this.cache.size - this.maxSize);
    toRemove.forEach(([key]) => {
      console.log(`🗑️ Removing old cached image: ${key}`);
      this.cache.delete(key);
    });
  }

  /**
   * Preload images for a set of photos
   */
  async preloadImages(photos: Array<{ id: string; sessionId: string; url?: string }>) {
    const promises = photos.map(async (photo) => {
      try {
        if (photo.url) {
          return await this.loadImage(photo.url);
        }
        return await this.getImage(photo.id, photo.sessionId);
      } catch (err) {
        console.error(`Failed to preload image ${photo.id}:`, err);
        return null;
      }
    });
    
    await Promise.all(promises);
    console.log(`✅ Preloaded ${photos.length} images`);
  }

  /**
   * Clear the entire cache
   */
  clear() {
    this.cache.clear();
    console.log('🗑️ Image cache cleared');
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
    
    // Make it available globally for debugging
    if (typeof window !== 'undefined') {
      (window as any).imageCache = imageCacheInstance;
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

    const cache = getImageCache();
    let cancelled = false;

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(null);
        let img: HTMLImageElement;
        if (directUrl) {
          img = await (cache as any)['loadImage'](directUrl);
        } else {
          img = await cache.getImage(photoId, sessionId);
        }
        
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
