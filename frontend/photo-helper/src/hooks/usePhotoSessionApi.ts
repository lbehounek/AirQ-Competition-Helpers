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
  const backendCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
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
    
    backendCheckTimeoutRef.current = timeout;
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
      if (backendCheckTimeoutRef.current) {
        clearTimeout(backendCheckTimeoutRef.current);
        backendCheckTimeoutRef.current = null;
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

    // Bounds and no-op checks
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex > 8 || toIndex < 0 || toIndex > 8) {
      return;
    }

    // Capture immutable snapshot for revert
    const previousSnapshot: ApiPhotoSession = JSON.parse(JSON.stringify(session));

    // Clone only modified branch for optimistic update
    const newSession: ApiPhotoSession = {
      ...session,
      sets: {
        ...session.sets,
        [setKey]: {
          ...session.sets[setKey],
          photos: [...session.sets[setKey].photos]
        }
      }
    };

    // Build 9-slot representation
    const slots: (ApiPhoto | null)[] = Array(9).fill(null);
    newSession.sets[setKey].photos.forEach((p, i) => {
      if (i < 9) slots[i] = p as ApiPhoto;
    });

    const moving = slots[fromIndex];
    if (!moving) return; // nothing to move

    // Compact excluding fromIndex
    const compact: ApiPhoto[] = [];
    for (let i = 0; i < 9; i++) {
      const p = slots[i];
      if (p && i !== fromIndex) compact.push(p);
    }

    // Compute insertion index reflecting shift behavior
    const insertIdx = fromIndex < toIndex ? Math.max(0, Math.min(compact.length, toIndex - 1)) : Math.max(0, Math.min(compact.length, toIndex));
    compact.splice(insertIdx, 0, moving);

    newSession.sets[setKey].photos = compact.slice(0, 9);

    // Optimistic UI
    setSession(newSession);

    try {
      const response = await api.reorderPhotos(sessionId, setKey, fromIndex, toIndex);
      setSession(response.session as ApiPhotoSession);
      console.log('✅ Photos reordered and persisted:', response.operation);
    } catch (err) {
      // Revert on error
      setSession(previousSnapshot);
      const errorMessage = err instanceof ApiError ? err.message : 'Failed to reorder photos';
      setError(errorMessage);
      console.error('❌ Photo reorder failed:', err);
    }
  }, [sessionId, backendAvailable, session]);
  
  /**
   * Shuffle photos in a set - optimized to update all at once
   */
  const shufflePhotos = useCallback(async (setKey: 'set1' | 'set2' | 'both') => {
    if (!session) return;
    
    // Fisher-Yates shuffle algorithm
    const shuffleArray = (array: any[]) => {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };
    
    // Use functional update to ensure we work with the latest state
    setSession((currentSession) => {
      if (!currentSession) return currentSession;
      
      const newSets = { ...currentSession.sets };
      
      // Shuffle set1 if requested
      if ((setKey === 'set1' || setKey === 'both') && currentSession.sets.set1.photos.length > 1) {
        newSets.set1 = {
          ...currentSession.sets.set1,
          photos: shuffleArray(currentSession.sets.set1.photos)
        };
        console.log(`🎲 Shuffled set1 photos`);
      }
      
      // Shuffle set2 if requested
      if ((setKey === 'set2' || setKey === 'both') && currentSession.sets.set2.photos.length > 1) {
        newSets.set2 = {
          ...currentSession.sets.set2,
          photos: shuffleArray(currentSession.sets.set2.photos)
        };
        console.log(`🎲 Shuffled set2 photos`);
      }
      
      return {
        ...currentSession,
        sets: newSets
      };
    });
    
    // If backend is available, persist the new order
    if (backendAvailable && sessionId) {
      try {
        // TODO: Add a bulk update API endpoint for better performance
        console.log('✅ Shuffle completed');
      } catch (err) {
        console.error('Failed to persist shuffle:', err);
      }
    }
  }, [sessionId, backendAvailable]);

  const updateSessionMode = useCallback(async (mode: 'track' | 'turningpoint') => {
    if (!sessionId || !backendAvailable || !session) return;

    try {
      const response = await api.updateSessionMode(sessionId, mode);
      setSession(response.session as ApiPhotoSession);
      console.log(`✅ Session mode updated to ${mode}`);
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : 'Failed to update session mode';
      setError(errorMessage);
      console.error('❌ Session mode update failed:', err);
    }
  }, [sessionId, backendAvailable, session]);

  const updateLayoutMode = useCallback(async (layoutMode: 'landscape' | 'portrait') => {
    if (!sessionId || !backendAvailable || !session) return;

    try {
      // Update the session with new layout mode
      const updatedSession = {
        ...session,
        layoutMode
      };
      setSession(updatedSession);
      
      // Try to persist to backend if available
      if (backendAvailable) {
        // Note: Backend API may need to be updated to support layoutMode
        // For now, we just update the local state
        console.log(`✅ Layout mode updated to ${layoutMode}`);
      }
    } catch (err) {
      const errorMessage = 'Failed to update layout mode';
      setError(errorMessage);
      console.error('❌ Layout mode update failed:', err);
    }
  }, [sessionId, backendAvailable, session]);

  const addPhotosToTurningPoint = useCallback(async (files: File[]) => {
    if (!sessionId || !backendAvailable || !session) return;

    try {
      // Calculate current photo counts
      const set1Count = session.sets.set1.photos.length;
      const set2Count = session.sets.set2.photos.length;
      const totalCount = set1Count + set2Count;
      
      // Check if we can add all files
      if (totalCount + files.length > 18) {
        setError(`Cannot add ${files.length} photos. Maximum 18 photos allowed (${totalCount} already uploaded).`);
        return;
      }

      // Distribute files: fill set1 first (up to 9), then set2
      const filesToSet1 = [];
      const filesToSet2 = [];
      
      for (let i = 0; i < files.length; i++) {
        const currentSet1Count = set1Count + filesToSet1.length;
        if (currentSet1Count < 9) {
          filesToSet1.push(files[i]);
        } else {
          filesToSet2.push(files[i]);
        }
      }

      // Upload to set1 first
      if (filesToSet1.length > 0) {
        await addPhotosToSet(filesToSet1, 'set1');
      }

      // Then upload to set2
      if (filesToSet2.length > 0) {
        await addPhotosToSet(filesToSet2, 'set2');
      }

      console.log(`✅ Distributed ${filesToSet1.length} photos to set1, ${filesToSet2.length} photos to set2`);
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : 'Failed to add photos to turning point';
      setError(errorMessage);
      console.error('❌ Turning point photo upload failed:', err);
    }
  }, [sessionId, backendAvailable, session, addPhotosToSet]);

  const updateCompetitionName = useCallback(async (competitionName: string) => {
    if (!sessionId || !backendAvailable || !session) return;

    try {
      const response = await api.updateCompetitionName(sessionId, competitionName);
      setSession(response.session as ApiPhotoSession);
      console.log(`✅ Competition name updated to: ${competitionName}`);
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : 'Failed to update competition name';
      setError(errorMessage);
      console.error('❌ Competition name update failed:', err);
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
    addPhotosToTurningPoint,
    removePhoto,
    updatePhotoState,
    updateSetTitle,
    reorderPhotos,
    shufflePhotos,
    updateSessionMode,
    updateLayoutMode,
    updateCompetitionName,
    resetSession,
    refreshSession,
    clearError,
    checkBackendHealth,
    
    // Utils
    getSessionStats
  };
};
