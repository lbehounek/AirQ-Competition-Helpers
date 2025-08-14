import { useState, useCallback, useEffect } from 'react';
import type { PhotoSession, Photo, PhotoSet } from '../types';
import { useDebouncedLocalStorage } from './useLocalStorage';
import { 
  createNewSession, 
  createPhotoFromFile, 
  updateSessionVersion,
  getSessionStorageKey,
  validateSession,
  cleanupOldSessions
} from '../utils/sessionManager';
import { loadImageFromFile } from '../utils/imageProcessing';

export const usePhotoSession = (sessionId?: string) => {
  const [currentSession, setCurrentSession] = useDebouncedLocalStorage<PhotoSession>(
    sessionId ? getSessionStorageKey(sessionId) : 'current-session',
    createNewSession(),
    500 // Auto-save every 500ms
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clean up old sessions on mount
  useEffect(() => {
    cleanupOldSessions();
  }, []);

  /**
   * Add photos to a specific set
   */
  const addPhotosToSet = useCallback(async (
    files: File[], 
    setKey: 'set1' | 'set2'
  ): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const currentSet = currentSession.sets[setKey];
      const availableSlots = 9 - currentSet.photos.length;
      
      if (files.length > availableSlots) {
        throw new Error(`Can only add ${availableSlots} more photos to this set (max 9 per set)`);
      }

      const newPhotos: Photo[] = [];
      const setIndex = setKey === 'set1' ? 0 : 1;

      // Process each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const photoIndex = currentSet.photos.length + i;
        
        try {
          // Validate and load image
          const image = await loadImageFromFile(file);
          
          // Create photo object
          const photo = createPhotoFromFile(file, setIndex, photoIndex);
          photo.originalImage = image;
          
          newPhotos.push(photo);
        } catch (err) {
          console.error(`Failed to process ${file.name}:`, err);
          setError(`Failed to process ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      if (newPhotos.length === 0) {
        throw new Error('No valid photos were processed');
      }

      // Update session
      const updatedSession = updateSessionVersion({
        ...currentSession,
        sets: {
          ...currentSession.sets,
          [setKey]: {
            ...currentSet,
            photos: [...currentSet.photos, ...newPhotos]
          }
        }
      });

      setCurrentSession(updatedSession);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Error adding photos:', err);
    } finally {
      setLoading(false);
    }
  }, [currentSession, setCurrentSession]);

  /**
   * Remove photo from set
   */
  const removePhoto = useCallback((setKey: 'set1' | 'set2', photoId: string) => {
    const updatedSession = updateSessionVersion({
      ...currentSession,
      sets: {
        ...currentSession.sets,
        [setKey]: {
          ...currentSession.sets[setKey],
          photos: currentSession.sets[setKey].photos.filter(p => p.id !== photoId)
        }
      }
    });

    setCurrentSession(updatedSession);
  }, [currentSession, setCurrentSession]);

  /**
   * Update photo canvas state (position, scale, adjustments)
   */
  const updatePhotoState = useCallback((
    setKey: 'set1' | 'set2', 
    photoId: string, 
    canvasState: Partial<Photo['canvasState']>
  ) => {
    const updatedSession = updateSessionVersion({
      ...currentSession,
      sets: {
        ...currentSession.sets,
        [setKey]: {
          ...currentSession.sets[setKey],
          photos: currentSession.sets[setKey].photos.map(photo => 
            photo.id === photoId 
              ? { ...photo, canvasState: { ...photo.canvasState, ...canvasState } }
              : photo
          )
        }
      }
    });

    setCurrentSession(updatedSession);
  }, [currentSession, setCurrentSession]);

  /**
   * Update set title
   */
  const updateSetTitle = useCallback((setKey: 'set1' | 'set2', title: string) => {
    const updatedSession = updateSessionVersion({
      ...currentSession,
      sets: {
        ...currentSession.sets,
        [setKey]: {
          ...currentSession.sets[setKey],
          title
        }
      }
    });

    setCurrentSession(updatedSession);
  }, [currentSession, setCurrentSession]);

  /**
   * Reset session to empty state
   */
  const resetSession = useCallback(() => {
    setCurrentSession(createNewSession());
    setError(null);
  }, [setCurrentSession]);

  /**
   * Load session from localStorage
   */
  const loadSession = useCallback((sessionId: string): boolean => {
    try {
      const stored = localStorage.getItem(getSessionStorageKey(sessionId));
      if (!stored) return false;

      const parsed = JSON.parse(stored);
      if (!validateSession(parsed)) return false;

      setCurrentSession(parsed);
      setError(null);
      return true;
    } catch (err) {
      console.error('Failed to load session:', err);
      return false;
    }
  }, [setCurrentSession]);

  /**
   * Get session statistics
   */
  const getSessionStats = useCallback(() => {
    const set1Count = currentSession.sets.set1.photos.length;
    const set2Count = currentSession.sets.set2.photos.length;
    
    return {
      set1Photos: set1Count,
      set2Photos: set2Count,
      totalPhotos: set1Count + set2Count,
      set1Available: 9 - set1Count,
      set2Available: 9 - set2Count,
      isComplete: set1Count === 9 && set2Count === 9
    };
  }, [currentSession]);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    session: currentSession,
    loading,
    error,
    
    // Actions
    addPhotosToSet,
    removePhoto,
    updatePhotoState,
    updateSetTitle,
    resetSession,
    loadSession,
    clearError,
    
    // Utils
    getSessionStats
  };
};
