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

  /**
   * Restore HTMLImageElement objects from File objects after loading from localStorage
   */
  const restoreImagesFromSession = useCallback(async () => {
    const needsRestoring = (
      currentSession.sets.set1.photos.some(p => p.file && !p.originalImage) ||
      currentSession.sets.set2.photos.some(p => p.file && !p.originalImage)
    );

    if (!needsRestoring) return;

    setLoading(true);
    console.log('Restoring images from localStorage...');

    try {
      const updatedSets = { ...currentSession.sets };

      // Restore Set 1 images
      for (let i = 0; i < updatedSets.set1.photos.length; i++) {
        const photo = updatedSets.set1.photos[i];
        if (photo.file && !photo.originalImage) {
          try {
            const image = await loadImageFromFile(photo.file);
            updatedSets.set1.photos[i] = { ...photo, originalImage: image };
          } catch (err) {
            console.error(`Failed to restore image for photo ${photo.id}:`, err);
          }
        }
      }

      // Restore Set 2 images
      for (let i = 0; i < updatedSets.set2.photos.length; i++) {
        const photo = updatedSets.set2.photos[i];
        if (photo.file && !photo.originalImage) {
          try {
            const image = await loadImageFromFile(photo.file);
            updatedSets.set2.photos[i] = { ...photo, originalImage: image };
          } catch (err) {
            console.error(`Failed to restore image for photo ${photo.id}:`, err);
          }
        }
      }

      // Update session with restored images
      const restoredSession = updateSessionVersion({
        ...currentSession,
        sets: updatedSets
      });

      setCurrentSession(restoredSession);
      console.log('Images restored successfully');
      
    } catch (err) {
      console.error('Failed to restore images:', err);
      setError('Failed to restore images from previous session');
    } finally {
      setLoading(false);
    }
  }, [currentSession, setCurrentSession]);

  // Clean up old sessions on mount
  useEffect(() => {
    cleanupOldSessions();
  }, []);

  // Restore images when session changes and has photos without originalImage
  useEffect(() => {
    restoreImagesFromSession();
  }, [restoreImagesFromSession]);

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
   * Reorder photos within a set (swap or move). Keeps hook-managed persistence/state.
   * Note: With current model (Photo[]), moving to an empty slot beyond current length
   * is treated as moving to the end of the list.
   */
  const reorderSetPhotos = useCallback((
    setKey: 'set1' | 'set2',
    fromIndex: number,
    toIndex: number
  ) => {
    const currentPhotos = currentSession.sets[setKey].photos;
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= Math.min(9, currentPhotos.length) ||
      toIndex >= 9
    ) {
      return;
    }

    const newPhotos = [...currentPhotos];

    // If target is within current list length, perform swap/move via splice
    if (toIndex < newPhotos.length) {
      const [moved] = newPhotos.splice(fromIndex, 1);
      newPhotos.splice(toIndex, 0, moved);
    } else {
      // Move to end if target beyond current length but within grid capacity
      const [moved] = newPhotos.splice(fromIndex, 1);
      newPhotos.push(moved);
    }

    const updatedSession = updateSessionVersion({
      ...currentSession,
      sets: {
        ...currentSession.sets,
        [setKey]: {
          ...currentSession.sets[setKey],
          photos: newPhotos
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
  const loadSession = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      const stored = localStorage.getItem(getSessionStorageKey(sessionId));
      if (!stored) return false;

      const parsed = JSON.parse(stored);
      if (!validateSession(parsed)) return false;

      setCurrentSession(parsed);
      setError(null);
      
      // Restore images after setting the session
      setTimeout(() => restoreImagesFromSession(), 100);
      
      return true;
    } catch (err) {
      console.error('Failed to load session:', err);
      return false;
    }
  }, [setCurrentSession, restoreImagesFromSession]);

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
    reorderSetPhotos,
    resetSession,
    loadSession,
    clearError,
    
    // Utils
    getSessionStats
  };
};
