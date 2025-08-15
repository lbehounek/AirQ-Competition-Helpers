import { useState, useCallback, useEffect, useRef } from 'react';
import type { PhotoSession, Photo, PhotoSet } from '../types';
import { api, ApiError } from '../services/api';

/**
 * Enhanced Photo type for API integration
 */
interface ApiPhoto extends Omit<Photo, 'file' | 'originalImage'> {
  url: string; // Backend photo URL
  filename: string;
  sessionId: string;
  uploadedAt: string;
}

interface ApiPhotoSession extends Omit<PhotoSession, 'sets'> {
  sets: {
    set1: PhotoSet & { photos: ApiPhoto[] };
    set2: PhotoSet & { photos: ApiPhoto[] };
  };
}

const SESSION_STORAGE_KEY = 'airq-session-id';

export const usePhotoSessionApi = () => {
  const [session, setSession] = useState<ApiPhotoSession | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null); // null = checking
  const [backendCheckTimeout, setBackendCheckTimeout] = useState<NodeJS.Timeout | null>(null);
  
  // Use a ref to ensure we only initialize once
  const hasInitialized = useRef(false);

  // Check backend availability on mount (only once)
  useEffect(() => {
    // Only check if we haven't already initialized
    if (hasInitialized.current) {
      return;
    }
    hasInitialized.current = true;
    
    // Show loading state immediately
    setBackendAvailable(null);
    
    // Set a timeout to show error after 3 seconds if backend is still not available
    const timeout = setTimeout(() => {
      setBackendAvailable(prev => {
        if (prev === null) {
          setError('Backend server is not responding. Please make sure the backend server is running.');
          return false;
        }
        return prev;
      });
    }, 3000);
    
    setBackendCheckTimeout(timeout);
    checkBackendHealth();
    
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  // Load existing session or create new one
  useEffect(() => {
    if (backendAvailable === true) {
      loadOrCreateSession();
    }
  }, [backendAvailable]);

  const checkBackendHealth = async () => {
    try {
      await api.healthCheck();
      // Clear any timeout if we get a response
      if (backendCheckTimeout) {
        clearTimeout(backendCheckTimeout);
        setBackendCheckTimeout(null);
      }
      setBackendAvailable(true);
      setError(null);
      console.log('✅ Backend is available');
    } catch (err) {
      // Only set error if we haven't already timed out
      if (backendAvailable === null) {
        // Let the timeout handle the error message
        console.log('⏳ Waiting for backend...');
      } else {
        setBackendAvailable(false);
        setError('Backend server is not running. Please start the backend server.');
        console.error('❌ Backend not available:', err);
      }
    }
  };

  const loadOrCreateSession = async () => {
    if (!backendAvailable) return;

    // Try to load existing session from localStorage
    const storedSessionId = localStorage.getItem(SESSION_STORAGE_KEY);
    
    if (storedSessionId) {
      console.log('🔄 Loading existing session:', storedSessionId);
      try {
        const response = await api.getSession(storedSessionId);
        setSessionId(storedSessionId);
        setSession(response.session as ApiPhotoSession);
        setError(null);
        console.log('✅ Session loaded successfully');
        return;
      } catch (err) {
        console.warn('⚠️ Failed to load existing session, creating new one:', err);
        // Clear invalid session ID
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }

    // Create new session if none exists or loading failed
    await createNewSession();
  };

  const createNewSession = async () => {
    if (!backendAvailable) return;

    setLoading(true);
    try {
      const response = await api.createSession();
      const newSessionId = response.sessionId;
      
      // Store session ID in localStorage
      localStorage.setItem(SESSION_STORAGE_KEY, newSessionId);
      
      setSessionId(newSessionId);
      setSession(response.session as ApiPhotoSession);
      setError(null);
      console.log('🎯 Created new session:', newSessionId);
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : 'Failed to create session';
      setError(errorMessage);
      console.error('Failed to create session:', err);
    } finally {
      setLoading(false);
    }
  };

  const addPhotosToSet = useCallback(async (
    files: File[], 
    setKey: 'set1' | 'set2'
  ): Promise<void> => {
    if (!sessionId || !backendAvailable) {
      throw new Error('No active session or backend not available');
    }

    setLoading(true);
    setError(null);

    try {
      const response = await api.uploadPhotos(sessionId, setKey, files);
      setSession(response.session as ApiPhotoSession);
      console.log(`📸 Uploaded ${files.length} photos to ${setKey}`);
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : 'Failed to upload photos';
      setError(errorMessage);
      console.error('Upload error:', err);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [sessionId, backendAvailable]);

  const removePhoto = useCallback(async (setKey: 'set1' | 'set2', photoId: string) => {
    if (!sessionId || !backendAvailable) return;

    setLoading(true);
    try {
      const response = await api.deletePhoto(sessionId, photoId);
      setSession(response.session as ApiPhotoSession);
      console.log(`🗑️ Deleted photo ${photoId}`);
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : 'Failed to delete photo';
      setError(errorMessage);
      console.error('Delete error:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId, backendAvailable]);

  const updatePhotoState = useCallback(async (
    setKey: 'set1' | 'set2', 
    photoId: string, 
    canvasState: Partial<Photo['canvasState']>
  ) => {
    if (!sessionId || !backendAvailable) return;

    try {
      const response = await api.updatePhotoCanvasState(sessionId, photoId, canvasState);
      setSession(response.session as ApiPhotoSession);
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : 'Failed to update photo';
      setError(errorMessage);
      console.error('Update error:', err);
    }
  }, [sessionId, backendAvailable]);

  const updateSetTitle = useCallback(async (setKey: 'set1' | 'set2', title: string) => {
    if (!sessionId || !backendAvailable) return;

    try {
      const response = await api.updateSetTitle(sessionId, setKey, title);
      setSession(response.session as ApiPhotoSession);
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : 'Failed to update title';
      setError(errorMessage);
      console.error('Title update error:', err);
    }
  }, [sessionId, backendAvailable]);

  const resetSession = useCallback(async () => {
    if (!backendAvailable) return;
    
    // Clear stored session ID
    localStorage.removeItem(SESSION_STORAGE_KEY);
    
    // Create new session
    await createNewSession();
  }, [backendAvailable]);

  const refreshSession = useCallback(async () => {
    if (!sessionId || !backendAvailable) return;

    setLoading(true);
    try {
      const response = await api.getSession(sessionId);
      setSession(response.session as ApiPhotoSession);
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : 'Failed to refresh session';
      setError(errorMessage);
      console.error('Refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId, backendAvailable]);

  const getSessionStats = useCallback(() => {
    if (!session) {
      return {
        set1Photos: 0,
        set2Photos: 0,
        totalPhotos: 0,
        set1Available: 9,
        set2Available: 9,
        isComplete: false
      };
    }

    const set1Count = session.sets.set1.photos.length;
    const set2Count = session.sets.set2.photos.length;
    
    return {
      set1Photos: set1Count,
      set2Photos: set2Count,
      totalPhotos: set1Count + set2Count,
      set1Available: 9 - set1Count,
      set2Available: 9 - set2Count,
      isComplete: set1Count === 9 && set2Count === 9
    };
  }, [session]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const reorderPhotos = useCallback(async (setKey: 'set1' | 'set2', fromIndex: number, toIndex: number) => {
    if (!sessionId || !backendAvailable || !session) return;
    
    // Immediate optimistic update for smooth UX
    const newSession = { ...session };
    const photos = [...newSession.sets[setKey].photos];
    
    // Ensure we have an array of 9 slots (some may be undefined)
    const photoArray = new Array(9).fill(undefined);
    photos.forEach((photo, index) => {
      if (photo && index < 9) {
        photoArray[index] = photo;
      }
    });
    
    // Get source and target photos
    const sourcePhoto = photoArray[fromIndex];
    const targetPhoto = photoArray[toIndex];
    
    if (!sourcePhoto) return; // Can't move from empty slot
    
    // Perform the swap or move
    if (targetPhoto) {
      // Swap photos
      photoArray[fromIndex] = targetPhoto;
      photoArray[toIndex] = sourcePhoto;
    } else {
      // Move to empty slot
      photoArray[fromIndex] = undefined;
      photoArray[toIndex] = sourcePhoto;
    }
    
    // Update the session with the reordered photos (filter out undefined values)
    newSession.sets[setKey].photos = photoArray.filter(photo => photo !== undefined);
    
    // Optimistic update - immediate UI response
    setSession(newSession);
    
    try {
      // Persist to backend
      const response = await api.reorderPhotos(sessionId, setKey, fromIndex, toIndex);
      setSession(response.session as ApiPhotoSession);
      console.log('✅ Photos reordered and persisted:', response.operation);
    } catch (err) {
      // Revert optimistic update on error
      setSession(session);
      const errorMessage = err instanceof ApiError ? err.message : 'Failed to reorder photos';
      setError(errorMessage);
      console.error('❌ Photo reorder failed:', err);
    }
  }, [sessionId, backendAvailable, session]);

  return {
    session,
    sessionId,
    loading,
    error,
    backendAvailable,
    
    // Actions
    addPhotosToSet,
    removePhoto,
    updatePhotoState,
    updateSetTitle,
    reorderPhotos,
    resetSession,
    refreshSession,
    clearError,
    checkBackendHealth,
    
    // Utils
    getSessionStats
  };
};
