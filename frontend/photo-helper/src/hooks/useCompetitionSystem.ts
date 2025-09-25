/**
 * Competition management hook - integrates competition versioning with photo sessions
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { 
  Competition, 
  CompetitionMetadata, 
  CleanupCandidate,
  CleanupSuggestion,
  StorageStats 
} from '../types/competition';
import type { ApiPhotoSession } from '../types/api';
import { competitionService } from '../services/competitionService';
import { migrationService } from '../services/migrationService';
import { useI18n } from '../contexts/I18nContext';

export interface UseCompetitionSystemResult {
  // Current state
  currentCompetition: Competition | null;
  competitions: CompetitionMetadata[];
  loading: boolean;
  error: string | null;
  
  // Competition management
  createNewCompetition: (name?: string) => Promise<void>;
  switchToCompetition: (id: string) => Promise<void>;
  deleteCompetition: (id: string) => Promise<void>;
  updateCompetitionName: (name: string) => Promise<void>;
  
  // Session operations (proxied to current competition)
  session: ApiPhotoSession | null;
  sessionId: string | null;
  addPhotosToSet: (files: File[], setKey: 'set1' | 'set2') => Promise<void>;
  removePhoto: (setKey: 'set1' | 'set2', photoId: string) => Promise<void>;
  updatePhotoState: (setKey: 'set1' | 'set2', photoId: string, canvasState: any) => Promise<void>;
  updateSetTitle: (setKey: 'set1' | 'set2', title: string) => Promise<void>;
  updateSetTitles: (titles: { set1?: string; set2?: string }) => Promise<void>;
  updateSessionMode: (mode: 'track' | 'turningpoint') => Promise<void>;
  updateLayoutMode: (layoutMode: 'landscape' | 'portrait') => Promise<void>;
  updateSessionCompetitionName: (competitionName: string) => Promise<void>;
  
  // Cleanup & storage
  cleanupCandidates: CleanupCandidate[];
  storageStats: StorageStats | null;
  checkCleanupNeeded: () => Promise<void>;
  performCleanup: (candidates: CleanupCandidate[]) => Promise<void>;
  dismissCleanup: () => void;
  
  // Utilities
  clearError: () => void;
  refreshCompetitions: () => Promise<void>;
  getSessionStats: () => any;
}

export function useCompetitionSystem(): UseCompetitionSystemResult {
  const { t } = useI18n();
  const [currentCompetition, setCurrentCompetition] = useState<Competition | null>(null);
  const [competitions, setCompetitions] = useState<CompetitionMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cleanupCandidates, setCleanupCandidates] = useState<CleanupCandidate[]>([]);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  
  const migrationPerformed = useRef(false);

  // Generate default competition name using i18n
  const getDefaultCompetitionName = useCallback((competitionCount?: number) => {
    const count = competitionCount !== undefined ? competitionCount : competitions.length + 1;
    return t('competition.numbered', { number: count });
  }, [t, competitions.length]);

  // Initialize the competition system
  const initialize = useCallback(async () => {
    if (migrationPerformed.current) return;
    
    try {
      setLoading(true);
      setError(null);
      
      // Perform migration if needed (use count of 1 for first competition)
      const migrationResult = await migrationService.performMigration(() => getDefaultCompetitionName(1));
      
      if (migrationResult.migrated) {
        console.log('Migration completed:', migrationResult.message);
        migrationPerformed.current = true;
      }
      
      // Load active competition first
      const activeCompetition = await competitionService.getActiveCompetition();
      
      // If no competitions exist (fresh install), create the first one
      if (!activeCompetition) {
        console.log('No competitions found, creating first competition');
        const defaultName = getDefaultCompetitionName(1);
        
        // Create new empty session with mode-specific sets
        const emptySession: ApiPhotoSession = {
          id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          mode: 'track',
          competition_name: defaultName,
          sets: {
            set1: { title: 'SP - TPX', photos: [] },
            set2: { title: 'TPX - FP', photos: [] }
          },
          // Initialize mode-specific storage
          setsTrack: {
            set1: { title: 'SP - TPX', photos: [] },
            set2: { title: 'TPX - FP', photos: [] }
          },
          setsTurning: {
            set1: { title: '', photos: [] },
            set2: { title: '', photos: [] }
          }
        };
        
        const newCompetition = await competitionService.createCompetition(defaultName, emptySession);
        setCurrentCompetition(newCompetition);
      } else {
        setCurrentCompetition(activeCompetition);
      }
      
      // Load competitions list after setting current competition
      await refreshCompetitions();
      
      // Check for cleanup suggestions
      await checkCleanupNeeded();
      
    } catch (err) {
      console.error('Failed to initialize competition system:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize');
    } finally {
      setLoading(false);
    }
  }, []);

  // Run initialization on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Load competitions list
  const refreshCompetitions = useCallback(async () => {
    try {
      const index = await competitionService.getCompetitionsIndex();
      console.log('refreshCompetitions loaded:', index.competitions?.length || 0, 'competitions');
      setCompetitions(index.competitions);
    } catch (err) {
      console.error('Failed to load competitions:', err);
    }
  }, []);

  // Load storage stats after initialization
  useEffect(() => {
    if (!loading && currentCompetition !== null) {
      // Load storage stats
      (async () => {
        try {
          const stats = await competitionService.getStorageStats();
          setStorageStats(stats);
        } catch (err) {
          console.warn('Failed to get storage stats:', err);
        }
      })();
    }
  }, [loading, currentCompetition]);

  // Competition Management Functions
  const createNewCompetition = useCallback(async (name?: string) => {
    try {
      setLoading(true);
      setError(null);
      
      const competitionName = name || getDefaultCompetitionName();
      
      // Create new empty session with mode-specific sets
      const emptySession: ApiPhotoSession = {
        id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        mode: 'track',
        competition_name: competitionName,
        sets: {
          set1: { title: 'SP - TPX', photos: [] },
          set2: { title: 'TPX - FP', photos: [] }
        },
        // Initialize mode-specific storage
        setsTrack: {
          set1: { title: 'SP - TPX', photos: [] },
          set2: { title: 'TPX - FP', photos: [] }
        },
        setsTurning: {
          set1: { title: '', photos: [] },
          set2: { title: '', photos: [] }
        }
      };
      
      const newCompetition = await competitionService.createCompetition(competitionName, emptySession);
      setCurrentCompetition(newCompetition);
      await refreshCompetitions();
      
    } catch (err) {
      console.error('Failed to create competition:', err);
      setError(err instanceof Error ? err.message : 'Failed to create competition');
    } finally {
      setLoading(false);
    }
  }, [getDefaultCompetitionName, refreshCompetitions]);

  const switchToCompetition = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      
      await competitionService.setActiveCompetition(id);
      const competition = await competitionService.getCompetition(id);
      setCurrentCompetition(competition);
      await refreshCompetitions();
      
    } catch (err) {
      console.error('Failed to switch competition:', err);
      setError(err instanceof Error ? err.message : 'Failed to switch competition');
    } finally {
      setLoading(false);
    }
  }, [refreshCompetitions]);

  const deleteCompetition = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      
      await competitionService.deleteCompetition(id);
      
      // If we deleted the current competition, load the new active one
      if (currentCompetition?.id === id) {
        const newActive = await competitionService.getActiveCompetition();
        setCurrentCompetition(newActive);
      }
      
      await refreshCompetitions();
      
    } catch (err) {
      console.error('Failed to delete competition:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete competition');
    } finally {
      setLoading(false);
    }
  }, [currentCompetition?.id, refreshCompetitions]);

  const updateCompetitionName = useCallback(async (name: string) => {
    if (!currentCompetition) return;
    
    try {
      const updatedCompetition: Competition = {
        ...currentCompetition,
        name,
        session: {
          ...currentCompetition.session,
          competition_name: name
        }
      };
      
      await competitionService.updateCompetition(updatedCompetition);
      setCurrentCompetition(updatedCompetition);
      await refreshCompetitions();
      
    } catch (err) {
      console.error('Failed to update competition name:', err);
      setError(err instanceof Error ? err.message : 'Failed to update competition name');
    }
  }, [currentCompetition, refreshCompetitions]);

  // Session Operations (proxied to current competition)
  const updateCurrentCompetition = useCallback(async (
    updater: (session: ApiPhotoSession) => ApiPhotoSession,
    options?: { updatePhotos?: boolean }
  ) => {
    if (!currentCompetition) return;
    
    try {
      const originalSession = currentCompetition.session;
      const updatedSession = updater(originalSession);
      
      // Check if competition name changed in session and sync it
      const nameChanged = updatedSession.competition_name !== originalSession.competition_name;
      const newCompetitionName = nameChanged && updatedSession.competition_name.trim() 
        ? updatedSession.competition_name.trim()
        : currentCompetition.name;
      
      // Detect if photos have actually changed (not just metadata)
      const photosChanged = options?.updatePhotos || 
        originalSession.sets.set1.photos.length !== updatedSession.sets.set1.photos.length ||
        originalSession.sets.set2.photos.length !== updatedSession.sets.set2.photos.length ||
        JSON.stringify(originalSession.sets.set1.photos.map(p => p.id)) !== JSON.stringify(updatedSession.sets.set1.photos.map(p => p.id)) ||
        JSON.stringify(originalSession.sets.set2.photos.map(p => p.id)) !== JSON.stringify(updatedSession.sets.set2.photos.map(p => p.id));
      
      const updatedCompetition: Competition = {
        ...currentCompetition,
        name: newCompetitionName,
        session: updatedSession,
        lastModified: new Date().toISOString(),
        photoCount: updatedSession.sets.set1.photos.length + updatedSession.sets.set2.photos.length
      };
      
      await competitionService.updateCompetition(updatedCompetition, { updatePhotos: photosChanged });
      setCurrentCompetition(updatedCompetition);
      
      // Refresh competitions list if name changed
      if (nameChanged) {
        await refreshCompetitions();
      }
      
      // Update storage stats after any photo changes
      if (photosChanged) {
        try {
          const stats = await competitionService.getStorageStats();
          setStorageStats(stats);
        } catch (err) {
          console.warn('Failed to update storage stats:', err);
        }
      }
      
    } catch (err) {
      console.error('Failed to update competition:', err);
      setError(err instanceof Error ? err.message : 'Failed to update competition');
    }
  }, [currentCompetition, refreshCompetitions]);

  const addPhotosToSet = useCallback(async (files: File[], setKey: 'set1' | 'set2') => {
    if (!currentCompetition?.session) {
      console.error('No current competition or session available');
      setError('No active competition to add photos to');
      return;
    }

    await updateCurrentCompetition(session => {
      // Ensure sets structure is valid with extensive defensive checks
      if (!session || !session.sets) {
        console.error('Session or session.sets is undefined:', session);
        throw new Error('Invalid session structure');
      }

      const ensuredSets = {
        set1: session.sets.set1 || { title: '', photos: [] },
        set2: session.sets.set2 || { title: '', photos: [] }
      };

      // Additional validation
      if (!ensuredSets[setKey]) {
        console.error(`setKey '${setKey}' not found in ensuredSets:`, ensuredSets);
        throw new Error(`Invalid setKey: ${setKey}`);
      }
      
      // Convert files to photos (simplified - you'd use proper photo creation logic)
      const newPhotos = files.map((file, index) => ({
        id: `photo-${Date.now()}-${index}`,
        sessionId: session.id,
        url: URL.createObjectURL(file),
        filename: file.name,
        canvasState: {
          position: { x: 0, y: 0 },
          scale: 1,
          brightness: 0,
          contrast: 1,
          sharpness: 0,
          whiteBalance: { temperature: 0, tint: 0, auto: false },
          labelPosition: 'bottom-left' as const
        },
        label: ''
      }));
      
      return {
        ...session,
        version: session.version + 1,
        updatedAt: new Date().toISOString(),
        sets: {
          ...ensuredSets,
          [setKey]: {
            ...ensuredSets[setKey],
            photos: [...(ensuredSets[setKey].photos || []), ...newPhotos]
          }
        }
      };
    }, { updatePhotos: true });
  }, [updateCurrentCompetition, currentCompetition]);

  const removePhoto = useCallback(async (setKey: 'set1' | 'set2', photoId: string) => {
    await updateCurrentCompetition(session => {
      // Ensure sets structure is valid
      const ensuredSets = {
        set1: session.sets?.set1 || { title: '', photos: [] },
        set2: session.sets?.set2 || { title: '', photos: [] }
      };
      
      return {
        ...session,
        version: session.version + 1,
        updatedAt: new Date().toISOString(),
        sets: {
          ...ensuredSets,
          [setKey]: {
            ...ensuredSets[setKey],
            photos: (ensuredSets[setKey].photos || []).filter(p => p.id !== photoId)
          }
        }
      };
    }, { updatePhotos: true });
  }, [updateCurrentCompetition]);

  const updatePhotoState = useCallback(async (setKey: 'set1' | 'set2', photoId: string, canvasState: any) => {
    await updateCurrentCompetition(session => {
      // Ensure sets structure is valid
      const ensuredSets = {
        set1: session.sets?.set1 || { title: '', photos: [] },
        set2: session.sets?.set2 || { title: '', photos: [] }
      };
      
      return {
        ...session,
        version: session.version + 1,
        updatedAt: new Date().toISOString(),
        sets: {
          ...ensuredSets,
          [setKey]: {
            ...ensuredSets[setKey],
            photos: (ensuredSets[setKey].photos || []).map(p => 
              p.id === photoId ? { ...p, canvasState: { ...p.canvasState, ...canvasState } } : p
            )
          }
        }
      };
    });
  }, [updateCurrentCompetition]);

  const updateSetTitle = useCallback(async (setKey: 'set1' | 'set2', title: string) => {
    await updateCurrentCompetition(session => {
      let updatedSets = {
        ...session.sets,
        [setKey]: { ...session.sets[setKey], title }
      };

      // Auto-update Set 2 title when Set 1 matches SP-TP pattern (track mode only)
      if (session.mode === 'track' && setKey === 'set1') {
        const match = title.match(/^SP\s*-\s*TP(\d+)$/i);
        if (match) {
          const tpNumber = match[1];
          updatedSets.set2 = { ...updatedSets.set2, title: `TP${tpNumber} - FP` };
        }
      }

      return {
        ...session,
        version: session.version + 1,
        updatedAt: new Date().toISOString(),
        sets: updatedSets
      };
    });
  }, [updateCurrentCompetition]);

  const updateSetTitles = useCallback(async (titles: { set1?: string; set2?: string }) => {
    await updateCurrentCompetition(session => ({
      ...session,
      version: session.version + 1,
      updatedAt: new Date().toISOString(),
      sets: {
        ...session.sets,
        set1: titles.set1 !== undefined ? { ...session.sets.set1, title: titles.set1 } : session.sets.set1,
        set2: titles.set2 !== undefined ? { ...session.sets.set2, title: titles.set2 } : session.sets.set2
      }
    }));
  }, [updateCurrentCompetition]);

  const updateSessionMode = useCallback(async (mode: 'track' | 'turningpoint') => {
    if (!currentCompetition) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const session = currentCompetition.session;
      
      // Save current active sets into the current mode bucket
      const currentKey = session.mode === 'track' ? 'setsTrack' : 'setsTurning';
      const nextKey = mode === 'track' ? 'setsTrack' : 'setsTurning';
      
      // Initialize mode-specific storage if it doesn't exist
      const updatedSession = {
        ...session,
        setsTrack: session.setsTrack || { set1: { title: '', photos: [] }, set2: { title: '', photos: [] } },
        setsTurning: session.setsTurning || { set1: { title: '', photos: [] }, set2: { title: '', photos: [] } }
      };
      
      // Save current sets to current mode bucket (remove blob URLs to avoid stale references)
      const sanitizedCurrentSets = {
        set1: {
          ...session.sets.set1,
          photos: session.sets.set1.photos.map(p => ({ ...p, url: '' }))
        },
        set2: {
          ...session.sets.set2,
          photos: session.sets.set2.photos.map(p => ({ ...p, url: '' }))
        }
      };
      (updatedSession as any)[currentKey] = sanitizedCurrentSets;
      
      // Load target mode sets (or use empty defaults)
      const targetSets = (updatedSession as any)[nextKey] || { 
        set1: { title: '', photos: [] }, 
        set2: { title: '', photos: [] } 
      };
      
      // Set appropriate default titles when switching to track mode with empty sets
      let newSets = { ...targetSets };
      if (mode === 'track') {
        if (!newSets.set1.title || newSets.set1.title.trim() === '') {
          newSets.set1.title = 'SP - TPX';
        }
        if (!newSets.set2.title || newSets.set2.title.trim() === '') {
          newSets.set2.title = 'TPX - FP';
        }
      }
      
      const newSession = {
        ...updatedSession,
        mode,
        sets: newSets,
        version: session.version + 1,
        updatedAt: new Date().toISOString()
      };
      
      // Create competition with new session
      const updatedCompetition: Competition = {
        ...currentCompetition,
        session: newSession,
        lastModified: new Date().toISOString(),
        photoCount: newSession.sets.set1.photos.length + newSession.sets.set2.photos.length
      };
      
      // Update in storage and regenerate blob URLs for loaded photos
      // Persist any newly added photos from either mode buckets to OPFS
      await competitionService.updateCompetition(updatedCompetition, { updatePhotos: true });
      
      // Reload competition to get proper blob URLs
      const reloadedCompetition = await competitionService.getCompetition(currentCompetition.id);
      setCurrentCompetition(reloadedCompetition);
      
    } catch (err) {
      console.error('Failed to update session mode:', err);
      setError(err instanceof Error ? err.message : 'Failed to update session mode');
    } finally {
      setLoading(false);
    }
  }, [currentCompetition]);

  const updateLayoutMode = useCallback(async (layoutMode: 'landscape' | 'portrait') => {
    await updateCurrentCompetition(session => ({
      ...session,
      version: session.version + 1,
      updatedAt: new Date().toISOString(),
      ...(session as any).layoutMode !== undefined ? { layoutMode } : {}
    }));
  }, [updateCurrentCompetition]);

  const updateSessionCompetitionName = useCallback(async (competitionName: string) => {
    await updateCurrentCompetition(session => ({
      ...session,
      competition_name: competitionName,
      version: session.version + 1,
      updatedAt: new Date().toISOString()
    }));
  }, [updateCurrentCompetition]);

  // Cleanup & Storage
  const checkCleanupNeeded = useCallback(async () => {
    try {
      const candidates = await competitionService.detectCleanupCandidates();
      setCleanupCandidates(candidates);
    } catch (err) {
      console.warn('Failed to check cleanup candidates:', err);
    }
  }, []);

  const performCleanup = useCallback(async (candidates: CleanupCandidate[]) => {
    try {
      await competitionService.performCleanup(candidates);
      setCleanupCandidates([]);
      await refreshCompetitions();
      
      // If current competition was deleted, load new active
      const activeCompetition = await competitionService.getActiveCompetition();
      setCurrentCompetition(activeCompetition);
      
    } catch (err) {
      console.error('Failed to perform cleanup:', err);
      setError(err instanceof Error ? err.message : 'Failed to perform cleanup');
    }
  }, [refreshCompetitions]);

  const dismissCleanup = useCallback(() => {
    setCleanupCandidates([]);
  }, []);

  // Storage monitoring
  const updateStorageStats = useCallback(async () => {
    try {
      const stats = await competitionService.getStorageStats();
      setStorageStats(stats);
    } catch (err) {
      console.warn('Failed to get storage stats:', err);
    }
  }, []);

  // Utilities
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const getSessionStats = useCallback(() => {
    if (!currentCompetition) {
      return { set1Photos: 0, set2Photos: 0, totalPhotos: 0, set1Available: 9, set2Available: 9, isComplete: false };
    }
    
    const session = currentCompetition.session;
    const set1Count = session.sets.set1.photos.length;
    const set2Count = session.sets.set2.photos.length;
    const layoutMode = (session as any).layoutMode || 'landscape';
    const gridCapacity = layoutMode === 'portrait' ? 10 : 9;
    
    return {
      set1Photos: set1Count,
      set2Photos: set2Count,
      totalPhotos: set1Count + set2Count,
      set1Available: Math.max(0, gridCapacity - set1Count),
      set2Available: Math.max(0, gridCapacity - set2Count),
      isComplete: set1Count >= gridCapacity && set2Count >= gridCapacity
    };
  }, [currentCompetition]);

  return {
    // Current state
    currentCompetition,
    competitions,
    loading,
    error,
    
    // Competition management
    createNewCompetition,
    switchToCompetition,
    deleteCompetition,
    updateCompetitionName,
    
    // Session operations
    session: currentCompetition?.session || null,
    sessionId: currentCompetition?.session?.id || null,
    addPhotosToSet,
    removePhoto,
    updatePhotoState,
    updateSetTitle,
    updateSetTitles,
    updateSessionMode,
    updateLayoutMode,
    updateSessionCompetitionName,
    
    // Cleanup & storage
    cleanupCandidates,
    storageStats,
    checkCleanupNeeded,
    performCleanup,
    dismissCleanup,
    
    // Utilities
    clearError,
    refreshCompetitions,
    getSessionStats,
    updateStorageStats
  };
}
