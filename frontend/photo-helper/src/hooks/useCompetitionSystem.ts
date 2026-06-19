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
import type { ApiPhotoSession, ApiPhoto, CandidateFlag, AddPhotosResult } from '../types/api';
import { competitionService } from '../services/competitionService';
import { migrationService } from '../services/migrationService';
import { useI18n } from '../contexts/I18nContext';
import { applyLabelPositionToAllInSession, applySettingToAllInSession, type CanvasSetting, type LabelPosition } from '../utils/canvasStatePatch';
import { distributeRallyDrop } from '../utils/distributeRallyDrop';
import { getGridCapacity } from '../utils/getGridCapacity';
import { parseDiscipline } from '../utils/parseDiscipline';
import { routeDrop } from '../utils/smartDropRoute';
import { isPhotoReferencedInSession } from '../utils/sessionRefs';
import {
  promoteCandidateToSlot as promoteCandidateToSlotPure,
  demoteSlotToCandidate as demoteSlotToCandidatePure,
  setCandidateFlag as setCandidateFlagPure,
  removeCandidate as removeCandidatePure,
  clearAllCandidates as clearAllCandidatesPure,
  updateCandidateCanvasState as updateCandidateCanvasStatePure,
  routeImportedPickIntoSets,
  insertPlaceholderIntoSet,
} from '../utils/candidateTransitions';
import { createPlaceholderPhoto, PLACEHOLDER_ID_PREFIX } from '../utils/placeholderPhoto';
import { collectSessionContentHashes, partitionFilesByContentHash } from '../utils/contentHash';
import {
  defaultTrackSetTitles,
  DEFAULT_TRACK_SET1_TITLE_RALLY,
  DEFAULT_TRACK_SET2_TITLE_RALLY,
  DEFAULT_TRACK_SET1_TITLE_PRECISION,
} from '../utils/defaultTrackSetTitles';
import { migrateLegacyPrecisionTitles } from '../utils/migrateLegacyPrecisionTitles';
import { collectModeSwitchRevokeUrls } from '../utils/modeSwitchRevokeUrls';
import { deriveSet2FromSet1 } from '../utils/autoPrefillSetTitle';

export interface UseCompetitionSystemResult {
  // Current state
  currentCompetition: Competition | null;
  competitions: CompetitionMetadata[];
  loading: boolean;
  error: string | null;
  /** True when competition is managed by the desktop launcher (hide in-app selector) */
  isDesktopManaged: boolean;

  // Competition management
  createNewCompetition: (name?: string) => Promise<void>;
  switchToCompetition: (id: string) => Promise<void>;
  deleteCompetition: (id: string) => Promise<void>;
  updateCompetitionName: (name: string) => Promise<void>;
  
  // Session operations (proxied to current competition)
  session: ApiPhotoSession | null;
  sessionId: string | null;
  addPhotosToSet: (files: File[], setKey: 'set1' | 'set2') => Promise<AddPhotosResult>;
  addPhotosToTurningPoint: (files: File[]) => Promise<AddPhotosResult>;
  removePhoto: (setKey: 'set1' | 'set2', photoId: string) => Promise<void>;
  updatePhotoState: (setKey: 'set1' | 'set2', photoId: string, canvasState: Partial<ApiPhoto['canvasState']>) => Promise<void>;
  updateSetTitle: (setKey: 'set1' | 'set2', title: string) => Promise<void>;
  updateSetTitles: (titles: { set1?: string; set2?: string }) => Promise<void>;
  updateSessionMode: (mode: 'track' | 'turningpoint') => Promise<void>;
  updateLayoutMode: (layoutMode: 'landscape' | 'portrait') => Promise<void>;
  updateSessionCompetitionName: (competitionName: string) => Promise<void>;

  // Candidate pool operations (see docs/CANDIDATE_PHOTOS.md)
  addPhotosToCandidates: (files: File[]) => Promise<{ added: number; duplicates: number }>;
  /**
   * Insert a pre-built `ApiPhoto` (bytes + thumb already on disk).
   * Used by `useMapPicksSync` (Phase 8b of photo-map-culling) to
   * project map-corridors picks into the candidate pool without
   * re-uploading. Idempotent — replaces if `photo.id` already exists
   * to avoid duplicates on visibility-change re-syncs.
   */
  addExistingCandidate: (photo: ApiPhoto) => Promise<void>;
  /**
   * Auto-route a freshly-imported map-corridors pick straight into its
   * discipline's sets (`pick-track` → track, `pick-turning` → turning) using
   * the `set1→set2→tray` fill policy, without switching the user's active
   * mode. Called by `useMapPicksSync` on first import instead of
   * `addExistingCandidate` for category-flagged picks. See
   * docs/CANDIDATE_PHOTOS.md "Map-pick auto-routing".
   */
  importPickToSets: (photo: ApiPhoto, targetMode: 'track' | 'turningpoint') => Promise<void>;
  removeCandidate: (photoId: string) => Promise<void>;
  promoteCandidateToSlot: (candidateId: string, setKey: 'set1' | 'set2', slotIndex: number) => Promise<void>;
  /**
   * Insert a "no photo" placeholder at `slotIndex` (turning-point mode), holding
   * the slot position so the SP/TP/FP numbering of surrounding photos stays
   * correct when a photo is missing. No-op if the set is already at capacity.
   */
  addPlaceholderToSet: (setKey: 'set1' | 'set2', slotIndex: number) => Promise<void>;
  demoteSlotToCandidate: (setKey: 'set1' | 'set2', photoId: string) => Promise<void>;
  setCandidateFlag: (photoId: string, flag: CandidateFlag) => Promise<void>;
  /**
   * Set or clear a candidate's label. Stamps `labelUpdatedAt = now()`
   * so the cross-app sync can decide newer-wins against map-corridors'
   * `map-picks.json`. Empty string is an explicit clear (vs. undefined
   * which means "no change" — but the API uses the empty-string idiom
   * to keep `ApiPhoto.label: string` non-nullable).
   */
  setCandidateLabel: (photoId: string, label: string) => Promise<void>;
  /**
   * Set the display filename in place. Called by `useMapPicksSync` when
   * map-corridors renames a `pm-` photo after it's already been handed
   * off. One-way; map is authoritative for pm- filenames.
   */
  setCandidateFilename: (photoId: string, filename: string) => Promise<void>;
  updateCandidatePhotoState: (photoId: string, canvasState: Partial<ApiPhoto['canvasState']>) => Promise<void>;
  /**
   * Delete a specific subset of candidate ids — session entries removed AND
   * their OPFS files freed. Rethrows when any OPFS deletion fails so callers
   * (e.g. the post-export cleanup dialog) can keep their UI open and surface
   * the failure. Snapshot-id targeted variant of `clearAllCandidates`
   * (PR #62 review CRIT-3, IMP-4).
   *
   * Returns `{ deleted, skipped }` so callers can distinguish a real cleanup
   * from snapshot-drift: when every snapshot id was promoted to a slot
   * between dialog-open and confirm, `deleted === 0 && skipped === N` and
   * the dialog should tell the user instead of claiming success silently
   * (PR #62 review I6).
   */
  deleteCandidates: (photoIds: string[]) => Promise<{ deleted: number; skipped: number }>;
  clearAllCandidates: () => Promise<void>;
  
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
  updateStorageStats: () => Promise<void>;
}

export function useCompetitionSystem(): UseCompetitionSystemResult {
  const { t } = useI18n();
  const [currentCompetition, setCurrentCompetition] = useState<Competition | null>(null);
  const [competitions, setCompetitions] = useState<CompetitionMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cleanupCandidates, setCleanupCandidates] = useState<CleanupCandidate[]>([]);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);

  // Synchronous mirror of `currentCompetition`. Updated by `applyCurrentCompetition`
  // (and the effect below for any direct setCurrentCompetition call sites) so that
  // sequential async setters running within the same render frame each read the
  // already-applied update from the previous call. Without this, the closure-
  // captured `currentCompetition` is stale across awaits and last-write-wins on
  // `setCurrentCompetition` silently drops earlier updates. Repro: map-corridors
  // → editor handoff with N picks lands only the last one because
  // `syncMapPicksOnce` awaits N `addExistingCandidate` calls back-to-back without
  // React rendering between them. See useMapPicksSync.test.ts (sequential).
  const currentCompetitionRef = useRef<Competition | null>(null);
  useEffect(() => { currentCompetitionRef.current = currentCompetition; }, [currentCompetition]);

  // Write-through helper: updates the ref synchronously AND queues the React
  // setState. Every call site that wants the next sequential read to see this
  // value MUST go through here instead of bare `setCurrentCompetition`.
  const applyCurrentCompetition = useCallback((next: Competition | null) => {
    currentCompetitionRef.current = next;
    setCurrentCompetition(next);
  }, []);

  const migrationPerformed = useRef(false);

  // Read external competition ID from URL (set by desktop launcher)
  const externalCompetitionId = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('competitionId') || null;
    } catch {
      return null;
    }
  })();

  // Discipline drives the default track-set title (precision uses
  // "SP - FP" because set2 is hidden; rally splits via "SP - TPX" /
  // "TPX - FP"). Read once at hook init — the URL doesn't change at
  // runtime in the desktop launcher.
  const isPrecisionDiscipline = parseDiscipline(typeof window !== 'undefined' ? window.location.search : '') === 'precision';

  // One-shot migration for precision sessions persisted before feedback
  // 2026-04-26 #1: their track-set titles still carry the legacy rally
  // pair (`SP - TPX` / `TPX - FP`). Applies on every OPFS load and
  // persists back the FIRST time it actually changes anything, so
  // subsequent loads are a no-op (idempotent guard inside the helper).
  // See `migrateLegacyPrecisionTitles` for the exact-match rule that
  // protects user-customised titles from being clobbered.
  const migrateLoadedCompetition = useCallback(async (competition: Competition | null): Promise<Competition | null> => {
    if (!competition) return competition;
    const result = migrateLegacyPrecisionTitles(competition.session, isPrecisionDiscipline);
    if (!result.migrated) return competition;
    const migrated: Competition = {
      ...competition,
      session: result.session,
      lastModified: new Date().toISOString(),
    };
    try {
      await competitionService.updateCompetition(migrated, { updatePhotos: false });
    } catch (err) {
      // Non-fatal: the in-memory migration still gives the user the
      // correct titles for this session; persistence will retry on
      // the next load.
      console.warn('[useCompetitionSystem] persist of precision title migration failed (non-fatal):', err);
    }
    return migrated;
  }, [isPrecisionDiscipline]);

  // Whether we're running in desktop mode with an externally-selected competition
  const isDesktopManaged = Boolean(externalCompetitionId && (window as any).electronAPI);

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

      // If an external competition ID is provided (from desktop launcher),
      // use it directly instead of relying on the index's activeCompetitionId
      if (externalCompetitionId) {
        console.log('Using externally-selected competition:', externalCompetitionId);
        await competitionService.setActiveCompetition(externalCompetitionId);
        const competition = await migrateLoadedCompetition(
          await competitionService.getCompetition(externalCompetitionId),
        );
        if (competition) {
          setCurrentCompetition(competition);
          await refreshCompetitions();
          await checkCleanupNeeded();
          return;
        }
        // If the external ID doesn't exist, fall through to normal flow
        console.warn('External competition not found, falling back to default');
      }

      // Load active competition first
      const activeCompetition = await migrateLoadedCompetition(
        await competitionService.getActiveCompetition(),
      );

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
            set1: { title: defaultTrackSetTitles(isPrecisionDiscipline).set1, photos: [] },
            set2: { title: defaultTrackSetTitles(isPrecisionDiscipline).set2, photos: [] }
          },
          // Initialize mode-specific storage
          setsTrack: {
            set1: { title: defaultTrackSetTitles(isPrecisionDiscipline).set1, photos: [] },
            set2: { title: defaultTrackSetTitles(isPrecisionDiscipline).set2, photos: [] }
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
      // DRY: reuse updateStorageStats helper
      updateStorageStats();
    }
  }, [loading, currentCompetition]);

  // Competition Management Functions
  const createNewCompetition = useCallback(async (name?: string) => {
    try {
      setLoading(true);
      setError(null);
      
      const competitionName = name || getDefaultCompetitionName();
      
      // Revoke blob URLs from current competition before creating a new one
      try {
        if (currentCompetition?.session) {
          const s = currentCompetition.session as any;
          const revokeInSet = (setObj: any) => {
            try { setObj?.set1?.photos?.forEach((p: any) => { if (p?.url?.startsWith?.('blob:')) URL.revokeObjectURL(p.url); }); } catch {}
            try { setObj?.set2?.photos?.forEach((p: any) => { if (p?.url?.startsWith?.('blob:')) URL.revokeObjectURL(p.url); }); } catch {}
          };
          revokeInSet(s.sets);
          revokeInSet(s.setsTrack);
          revokeInSet(s.setsTurning);
          // Candidate pool URLs are independent of mode buckets — revoke
          // them on competition transitions too, otherwise we leak one URL
          // per candidate per switch.
          try { s.candidates?.photos?.forEach((p: any) => { if (p?.url?.startsWith?.('blob:')) URL.revokeObjectURL(p.url); }); } catch {}
        }
      } catch {}

      // Create new empty session with mode-specific sets
      const trackTitles = defaultTrackSetTitles(isPrecisionDiscipline);
      const emptySession: ApiPhotoSession = {
        id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        mode: 'track',
        competition_name: competitionName,
        sets: {
          set1: { title: trackTitles.set1, photos: [] },
          set2: { title: trackTitles.set2, photos: [] }
        },
        // Initialize mode-specific storage
        setsTrack: {
          set1: { title: trackTitles.set1, photos: [] },
          set2: { title: trackTitles.set2, photos: [] }
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
      
      // Revoke blob URLs from current competition before switching
      try {
        if (currentCompetition?.session) {
          const s = currentCompetition.session as any;
          const revokeInSet = (setObj: any) => {
            try { setObj?.set1?.photos?.forEach((p: any) => { if (p?.url?.startsWith?.('blob:')) URL.revokeObjectURL(p.url); }); } catch {}
            try { setObj?.set2?.photos?.forEach((p: any) => { if (p?.url?.startsWith?.('blob:')) URL.revokeObjectURL(p.url); }); } catch {}
          };
          revokeInSet(s.sets);
          revokeInSet(s.setsTrack);
          revokeInSet(s.setsTurning);
          // Candidate pool URLs are independent of mode buckets — revoke
          // them on competition transitions too, otherwise we leak one URL
          // per candidate per switch.
          try { s.candidates?.photos?.forEach((p: any) => { if (p?.url?.startsWith?.('blob:')) URL.revokeObjectURL(p.url); }); } catch {}
        }
      } catch {}

      await competitionService.setActiveCompetition(id);
      const competition = await migrateLoadedCompetition(
        await competitionService.getCompetition(id),
      );
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
      
      // Revoke blob URLs before deleting (if deleting the current competition)
      try {
        if (currentCompetition?.id === id && currentCompetition?.session) {
          const s = currentCompetition.session as any;
          const revokeInSet = (setObj: any) => {
            try { setObj?.set1?.photos?.forEach((p: any) => { if (p?.url?.startsWith?.('blob:')) URL.revokeObjectURL(p.url); }); } catch {}
            try { setObj?.set2?.photos?.forEach((p: any) => { if (p?.url?.startsWith?.('blob:')) URL.revokeObjectURL(p.url); }); } catch {}
          };
          revokeInSet(s.sets);
          revokeInSet(s.setsTrack);
          revokeInSet(s.setsTurning);
          // Candidate pool URLs are independent of mode buckets — revoke
          // them on competition transitions too, otherwise we leak one URL
          // per candidate per switch.
          try { s.candidates?.photos?.forEach((p: any) => { if (p?.url?.startsWith?.('blob:')) URL.revokeObjectURL(p.url); }); } catch {}
        }
      } catch {}

      await competitionService.deleteCompetition(id);
      
      // If we deleted the current competition, load the new active one
      if (currentCompetition?.id === id) {
        const newActive = await migrateLoadedCompetition(
          await competitionService.getActiveCompetition(),
        );
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
  //
  // Reads the live competition from `currentCompetitionRef` rather than the
  // closure so sequential calls within the same render frame see each
  // other's updates. Critical for the handoff path: `syncMapPicksOnce`
  // awaits N `addExistingCandidate` calls back-to-back; without the ref read
  // every call would re-derive `updatedCompetition` from the same initial
  // snapshot and `setCurrentCompetition`'s last-write-wins would land only
  // the final call's photo on screen.
  //
  // We also commit the new value to the ref BEFORE awaiting the disk write
  // so the next caller in the chain sees this update immediately, not after
  // the persist has settled.
  const updateCurrentCompetition = useCallback(async (
    updater: (session: ApiPhotoSession) => ApiPhotoSession,
    options?: { updatePhotos?: boolean }
  ) => {
    const current = currentCompetitionRef.current;
    if (!current) return;

    try {
      const originalSession = current.session;
      const updatedSession = updater(originalSession);

      // Check if competition name changed in session and sync it
      const nameChanged = updatedSession.competition_name !== originalSession.competition_name;
      const newCompetitionName = nameChanged && updatedSession.competition_name.trim()
        ? updatedSession.competition_name.trim()
        : current.name;

      // Detect if photos have actually changed (not just metadata). Includes
      // the candidate pool so promoting/demoting/adding to the tray triggers
      // a write — `competitionService.saveSessionPhotos` walks candidates
      // alongside slots, so the persistence path is symmetric.
      const origCandIds = (originalSession.candidates?.photos ?? []).map(p => p.id);
      const nextCandIds = (updatedSession.candidates?.photos ?? []).map(p => p.id);
      const photosChanged = options?.updatePhotos ||
        originalSession.sets.set1.photos.length !== updatedSession.sets.set1.photos.length ||
        originalSession.sets.set2.photos.length !== updatedSession.sets.set2.photos.length ||
        JSON.stringify(originalSession.sets.set1.photos.map(p => p.id)) !== JSON.stringify(updatedSession.sets.set1.photos.map(p => p.id)) ||
        JSON.stringify(originalSession.sets.set2.photos.map(p => p.id)) !== JSON.stringify(updatedSession.sets.set2.photos.map(p => p.id)) ||
        origCandIds.length !== nextCandIds.length ||
        JSON.stringify(origCandIds) !== JSON.stringify(nextCandIds);

      const updatedCompetition: Competition = {
        ...current,
        name: newCompetitionName,
        session: updatedSession,
        lastModified: new Date().toISOString(),
        photoCount: updatedSession.sets.set1.photos.length + updatedSession.sets.set2.photos.length
      };

      // Publish the new value to the ref BEFORE the await so the very next
      // caller (e.g. syncMapPicksOnce iterating over picks) reads our
      // update, not the pre-update snapshot. The React state update is
      // still deferred until after the disk write succeeds, which preserves
      // the prior "no phantom UI on failed persist" contract.
      currentCompetitionRef.current = updatedCompetition;

      try {
        await competitionService.updateCompetition(updatedCompetition, { updatePhotos: photosChanged });
      } catch (err) {
        // Persist failed — roll back the ref so the next caller doesn't
        // build on top of unsaved phantom state.
        currentCompetitionRef.current = current;
        throw err;
      }
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
  }, [refreshCompetitions]);

  /**
   * Build a fresh ApiPhoto from a File. Shared by slot-add and candidate-add
   * paths so the canvasState/blob-URL/id construction stays in one place.
   * `flag` is only set on the candidate path.
   */
  const filesToPhotos = useCallback((files: File[], sessionIdLocal: string, flag?: CandidateFlag): ApiPhoto[] => {
    return files.map((file) => ({
      id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? (crypto as any).randomUUID()
        : `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: sessionIdLocal,
      url: URL.createObjectURL(file),
      filename: file.name,
      canvasState: {
        position: { x: 0, y: 0 },
        scale: 1,
        brightness: 0,
        contrast: 1,
        sharpness: 0,
        whiteBalance: { temperature: 0, tint: 0, auto: false },
        labelPosition: 'bottom-left' as const,
      },
      label: '',
      ...(flag !== undefined ? { flag } : {}),
    }));
  }, []);

  /**
   * Append files into the candidate pool. Used directly by the tray dropzone
   * and indirectly by `addPhotosToSet` via the smart-drop heuristic when a
   * slot batch exceeds remaining capacity. New candidates start as `neutral`.
   */
  const addPhotosToCandidates = useCallback(async (files: File[]): Promise<{ added: number; duplicates: number }> => {
    if (!currentCompetition?.session) {
      setError(t('errors.noActiveCompetition'));
      return { added: 0, duplicates: 0 };
    }
    if (files.length === 0) return { added: 0, duplicates: 0 };
    // ADR-020 re-import dedup: skip any file whose bytes match a photo already
    // anywhere in the session (tray or any set) or repeat within this batch, so a
    // duplicate never creates a second candidate. The original is left untouched.
    const existingHashes = collectSessionContentHashes(currentCompetition.session);
    const { fresh, duplicates } = await partitionFilesByContentHash(files, existingHashes);
    if (fresh.length > 0) {
      await updateCurrentCompetition(session => {
        const sessionId = session.id;
        // filesToPhotos preserves order, so zip the precomputed hashes back on.
        const newPhotos = filesToPhotos(fresh.map(f => f.file), sessionId, 'neutral')
          .map((p, i) => ({ ...p, contentHash: fresh[i].contentHash }));
        const existing = session.candidates?.photos ?? [];
        return {
          ...session,
          version: session.version + 1,
          updatedAt: new Date().toISOString(),
          candidates: { photos: [...existing, ...newPhotos] },
        };
      }, { updatePhotos: true });
    }
    return { added: fresh.length, duplicates: duplicates.length };
  }, [updateCurrentCompetition, currentCompetition, filesToPhotos, t]);

  /**
   * Insert / replace a pre-built ApiPhoto. The bytes live in OPFS at
   * `competitions/{compId}/photos/{photoId}` already (writer side is
   * map-corridors' importPhotosToStorage). We only mutate the session
   * JSON. Idempotent by `photo.id` so re-syncs from useMapPicksSync
   * don't duplicate.
   */
  const addExistingCandidate = useCallback(async (photo: ApiPhoto) => {
    if (!currentCompetition?.session) return;
    await updateCurrentCompetition(session => {
      const existing = session.candidates?.photos ?? [];
      // Revoke the displaced photo's blob URL before dropping its
      // reference. Without this, every re-sync of the same id (the
      // common case in the bidirectional handoff) leaks one URL per
      // visibility-change. The check guards against same-URL reuse and
      // non-blob URLs (data: / http: from older session shapes).
      const previous = existing.find(p => p.id === photo.id);
      if (
        previous &&
        previous.url &&
        previous.url !== photo.url &&
        previous.url.startsWith('blob:')
      ) {
        try { URL.revokeObjectURL(previous.url); } catch { /* best-effort */ }
      }
      const filtered = existing.filter(p => p.id !== photo.id);
      // Preserve sessionId so the photo is consistent with the rest of
      // the pool (the caller often doesn't know it).
      const normalized: ApiPhoto = { ...photo, sessionId: session.id };
      return {
        ...session,
        version: session.version + 1,
        updatedAt: new Date().toISOString(),
        candidates: { photos: [...filtered, normalized] },
      };
    }, { updatePhotos: true });
  }, [updateCurrentCompetition, currentCompetition]);

  /**
   * Auto-route a freshly-imported map-corridors pick into the sets of its
   * discipline (`pick-track` → track sets, `pick-turning` → turning sets)
   * instead of the candidate tray. Used by `useMapPicksSync` on first import.
   * Delegates the placement decision (set1→set2→tray spillover, active vs.
   * inactive mode bucket) to the pure `routeImportedPickIntoSets` helper, then
   * revokes the now-orphaned blob URL when the photo landed in an inactive
   * bucket (stored there with `url: ''`, like every other inactive-bucket
   * photo). Single source of truth for the fill/mode policy lives in the
   * helper so this stays a thin persistence wrapper.
   */
  const importPickToSets = useCallback(async (
    photo: ApiPhoto,
    targetMode: 'track' | 'turningpoint',
  ) => {
    if (!currentCompetition?.session) return;
    let revokeUrl: string | undefined;
    await updateCurrentCompetition(session => {
      const result = routeImportedPickIntoSets(session, photo, targetMode, isPrecisionDiscipline);
      revokeUrl = result.revokeUrl;
      return result.session;
    }, { updatePhotos: true });
    if (revokeUrl && revokeUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(revokeUrl); } catch { /* best-effort */ }
    }
  }, [updateCurrentCompetition, currentCompetition, isPrecisionDiscipline]);

  const addPhotosToSet = useCallback(async (files: File[], setKey: 'set1' | 'set2'): Promise<AddPhotosResult> => {
    if (!currentCompetition?.session) {
      console.error('No current competition or session available');
      const message = t('errors.noActiveCompetition');
      setError(message);
      return { kind: 'err', reason: 'no-competition', message };
    }

    // Smart-drop routing: if the batch fits the remaining slot capacity, fill
    // slots. Otherwise route the WHOLE batch into the candidate pool — never
    // silently split. See `routeDrop` + docs/CANDIDATE_PHOTOS.md.
    //
    // Capacity strictly follows `getGridCapacity` (= layoutMode). First
    // dev-test feedback 2026-05-12 removed the precision-track 9→10
    // auto-layout-flip; without that, bumping capacity to 10 in landscape
    // would route a 10th drop into a hidden 10th slot. Layout choice is
    // now fully manual.
    const sess = currentCompetition.session as any;
    const slotCapacity = getGridCapacity(sess);
    const currentSlotCount = sess.sets?.[setKey]?.photos?.length ?? 0;
    // Mirror the over-cap guard from usePhotoSessionOPFS (PR #62 review I2):
    // a legacy session or a layout switch can leave a set already over the
    // current cap. Without this check the smart-drop routes everything to
    // tray anyway (remaining = 0), but surfacing the corruption explicitly
    // lets the user know to clean up.
    if (currentSlotCount > slotCapacity) {
      // PR #62 review I2: localised; was hardcoded English even after the
      // IMP-5 cleanup-dialog fix, so Czech UI users hit an English banner.
      const message = t('errors.setOverCapacity', { current: currentSlotCount, cap: slotCapacity });
      setError(message);
      return { kind: 'err', reason: 'over-capacity', message };
    }
    const route = routeDrop({ files, currentSlotCount, slotCapacity });
    if (route.kind === 'tray') {
      await addPhotosToCandidates(route.files);
      return { kind: 'ok', routedTo: 'tray', count: route.files.length };
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

      const newPhotos = filesToPhotos(route.files, session.id);

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
    return { kind: 'ok', routedTo: 'slot', count: route.files.length };
  }, [updateCurrentCompetition, currentCompetition, t, filesToPhotos, addPhotosToCandidates]);

  const removePhoto = useCallback(async (setKey: 'set1' | 'set2', photoId: string) => {
    const compId = currentCompetition?.id;
    // Capture from inside the updater so the check runs against POST-mutation
    // state. The active mode bucket is mirrored alongside `sets` (PR #62
    // review IMP-3) so a mode-switch round-trip can't resurrect the photo;
    // `isPhotoReferencedInSession` then accurately reports whether the OTHER
    // mode bucket (or candidates, or the other set) still references the id.
    let referencedElsewhere = true;
    await updateCurrentCompetition(session => {
      const ensuredSets = {
        set1: session.sets?.set1 || { title: '', photos: [] },
        set2: session.sets?.set2 || { title: '', photos: [] }
      };
      const photoToRemove = (ensuredSets as any)[setKey]?.photos?.find((p: any) => p.id === photoId);
      if (photoToRemove && typeof photoToRemove.url === 'string' && photoToRemove.url.startsWith('blob:')) {
        try { URL.revokeObjectURL(photoToRemove.url); } catch (err) {
          console.warn(`removePhoto: revoke failed for ${photoId}:`, err);
        }
      }

      const nextSets = {
        ...ensuredSets,
        [setKey]: {
          ...ensuredSets[setKey],
          photos: (ensuredSets[setKey].photos || []).filter(p => p.id !== photoId)
        }
      };
      const next: ApiPhotoSession = {
        ...session,
        version: session.version + 1,
        updatedAt: new Date().toISOString(),
        sets: nextSets,
      };
      // Mirror the slot removal into the active mode bucket (PR #62 review
      // IMP-3) — without this, `setsTrack`/`setsTurning` keep a stale entry,
      // `isPhotoReferencedInSession` stays truthy, and the OPFS file orphans
      // after a mode-switch round-trip.
      const modeKey = session.mode === 'track' ? 'setsTrack' : 'setsTurning';
      (next as any)[modeKey] = nextSets;
      referencedElsewhere = isPhotoReferencedInSession(next, photoId);
      return next;
    }, { updatePhotos: true });
    // EXCEPTION: pm-prefixed photos are owned by map-corridors (shared
    // `competitions/{compId}/photos/` dir). Deleting the file here strands the
    // map marker — `getPhotoBlob` then NotFoundErrors on the next
    // `useMapPicksSync` pass and the entry is silently skipped, so a re-Send
    // brings back FEWER photos than were picked. Mirrors the guard in
    // `removeCandidate` / `deleteCandidates` (user feedback 2026-05-17 added it
    // there but THIS set-deletion path was missed — feedback 2026-06-19:
    // "deleted in editor, re-sent 9, only 7 returned"). map-corridors' own
    // hard-delete is the canonical place to free pm- bytes.
    const isMapOwned = photoId.startsWith('pm-');
    // Placeholders carry no OPFS file (url=''); a delete would throw a swallowed
    // NotFoundError. Skip the file-delete for them too.
    const isPlaceholder = photoId.startsWith(PLACEHOLDER_ID_PREFIX);
    if (compId && !referencedElsewhere && !isMapOwned && !isPlaceholder) {
      try {
        await competitionService.deletePhotosByIds(compId, [photoId]);
      } catch (err) {
        // Per-photo cleanup is best-effort. The session entry is gone; an
        // orphan OPFS file is preferable to refusing the UX flow. The
        // cleanup dialog (CRIT-3) DOES surface failures because it deletes
        // explicit user-targeted ids; this single-photo path doesn't.
        console.warn('removePhoto: deletePhotosByIds failed:', err);
      }
    }
  }, [updateCurrentCompetition, currentCompetition]);

  // ── Candidate pool operations ─────────────────────────────────────────────
  // All transitions delegate to the pure helpers in `candidateTransitions.ts`
  // so the branching logic is unit-testable and identical across the two
  // hook implementations. See docs/CANDIDATE_PHOTOS.md.

  const removeCandidate = useCallback(async (photoId: string) => {
    const compId = currentCompetition?.id;
    // Capture POST-mutation reference state. Slots and candidates are
    // disjoint by construction, but the cross-bucket check is symmetric
    // with `removePhoto` (PR #62 review IMP-2) — if anything ever breaks
    // the invariant, this prevents the OPFS file from being deleted while
    // still referenced from a slot or mode bucket.
    let referencedElsewhere = true;
    await updateCurrentCompetition(session => {
      const target = session.candidates?.photos?.find(p => p.id === photoId);
      if (typeof target?.url === 'string' && target.url.startsWith('blob:')) {
        try { URL.revokeObjectURL(target.url); } catch (err) {
          console.warn(`removeCandidate: revoke failed for ${photoId}:`, err);
        }
      }
      const next = removeCandidatePure(session, photoId);
      referencedElsewhere = isPhotoReferencedInSession(next, photoId);
      return next;
    }, { updatePhotos: true });
    // Free the OPFS file (PR #62 review C3). `saveSessionPhotos` never prunes,
    // so without an explicit delete the file orphans and storage stats lie.
    //
    // EXCEPTION: pm-prefixed photos are owned by map-corridors (shared
    // `competitions/{compId}/photos/` directory). Deleting the file here
    // strands map-corridors' marker — `getPhotoBlob` then throws
    // NotFoundError on the next `useMapPicksSync` pass and the entry is
    // silently skipped, so a re-Send brings back nothing. The map-corridors
    // hard-delete path (`removePhoto` in `useCorridorSessionOPFS`) is the
    // canonical place to delete pm- bytes, and it cleans up both the
    // marker and the file in one shot. User feedback 2026-05-17.
    const isMapOwned = photoId.startsWith('pm-');
    // Placeholders carry no OPFS file (url=''); a delete would throw a swallowed
    // NotFoundError. Skip the file-delete for them too.
    const isPlaceholder = photoId.startsWith(PLACEHOLDER_ID_PREFIX);
    if (compId && !referencedElsewhere && !isMapOwned && !isPlaceholder) {
      try {
        await competitionService.deletePhotosByIds(compId, [photoId]);
      } catch (err) {
        console.warn('removeCandidate: deletePhotosByIds failed:', err);
      }
    }
  }, [updateCurrentCompetition, currentCompetition]);

  const promoteCandidateToSlot = useCallback(async (
    candidateId: string,
    setKey: 'set1' | 'set2',
    slotIndex: number,
  ) => {
    await updateCurrentCompetition(session => {
      // Capacity gate: the pure helper trusts the caller, but `handleSendCandidateToSet`
      // passes `slotIndex = photos.length` which would silently APPEND past capacity
      // when the set is full (PR #62 review C1, contract violation vs.
      // docs/CANDIDATE_PHOTOS.md swap-on-full row). Clamp out-of-range indices to
      // `capacity - 1` so the helper's swap branch fires instead.
      const capacity = getGridCapacity(session as any);
      const slotCount = session.sets[setKey].photos.length;
      const safeIndex = slotIndex >= capacity
        ? Math.max(0, capacity - 1)
        : slotIndex < 0
          ? 0
          : slotIndex;
      // Mirror the slot mutation into the active mode bucket so a subsequent
      // mode switch doesn't resurrect pre-promotion state from the bucket.
      const next = promoteCandidateToSlotPure(session, candidateId, setKey, safeIndex);
      const modeKey = session.mode === 'track' ? 'setsTrack' : 'setsTurning';
      (next as any)[modeKey] = next.sets;
      return next;
    }, { updatePhotos: true });
  }, [updateCurrentCompetition]);

  // Insert a "no photo" placeholder at a slot (turning-point only). Holds the
  // position so SP/TP/FP numbering stays correct. The pure helper splices +
  // mirrors into the active mode bucket; here we just gate on capacity and build
  // the localized placeholder. updatePhotos:true persists; the placeholder has
  // url='' so saveSessionPhotos skips it (no OPFS write).
  const addPlaceholderToSet = useCallback(async (
    setKey: 'set1' | 'set2',
    slotIndex: number,
  ) => {
    const sess = currentCompetition?.session;
    // Turning-point only (the UI button is hidden on track sheets); guard here
    // too so a stray call can't insert a placeholder into a track set.
    if (!sess || sess.mode !== 'turningpoint') return;
    const capacity = getGridCapacity(sess as any);
    if ((sess.sets?.[setKey]?.photos?.length ?? 0) >= capacity) return;
    await updateCurrentCompetition(session => {
      const placeholder = createPlaceholderPhoto(session.id, t('photo.noPhotoFilename'));
      return insertPlaceholderIntoSet(session, setKey, slotIndex, placeholder);
    }, { updatePhotos: true });
  }, [updateCurrentCompetition, currentCompetition, t]);

  const demoteSlotToCandidate = useCallback(async (
    setKey: 'set1' | 'set2',
    photoId: string,
  ) => {
    await updateCurrentCompetition(session => {
      const next = demoteSlotToCandidatePure(session, setKey, photoId, 'pick');
      const modeKey = session.mode === 'track' ? 'setsTrack' : 'setsTurning';
      (next as any)[modeKey] = next.sets;
      return next;
    }, { updatePhotos: true });
  }, [updateCurrentCompetition]);

  const setCandidateFlag = useCallback(async (photoId: string, flag: CandidateFlag) => {
    await updateCurrentCompetition(session => setCandidateFlagPure(session, photoId, flag));
  }, [updateCurrentCompetition]);

  // Phase A of bidirectional label sync. Stamps labelUpdatedAt so
  // useEditorPicksSync on the map side can decide newer-wins against
  // its own marker.labelUpdatedAt. Empty string = explicit clear.
  const setCandidateLabel = useCallback(async (photoId: string, label: string) => {
    await updateCurrentCompetition(session => {
      const existing = session.candidates?.photos ?? [];
      const next = existing.map(p => p.id === photoId
        ? { ...p, label, labelUpdatedAt: new Date().toISOString() }
        : p);
      return { ...session, candidates: { photos: next } };
    });
  }, [updateCurrentCompetition]);

  // One-way filename sync — map-corridors is authoritative for the
  // display name on `pm-` candidates. `useMapPicksSync` calls this when
  // it observes `existing.filename !== entry.filename` on an
  // already-inserted entry. No timestamp pairing because there's no
  // editor-side rename UI; if one is added later, mirror the
  // labelUpdatedAt newer-wins pattern.
  const setCandidateFilename = useCallback(async (photoId: string, filename: string) => {
    await updateCurrentCompetition(session => {
      const existing = session.candidates?.photos ?? [];
      const next = existing.map(p => p.id === photoId ? { ...p, filename } : p);
      return { ...session, candidates: { photos: next } };
    }, { updatePhotos: true });
  }, [updateCurrentCompetition]);

  const updateCandidatePhotoState = useCallback(async (photoId: string, canvasState: Partial<ApiPhoto['canvasState']>) => {
    await updateCurrentCompetition(session => updateCandidateCanvasStatePure(session, photoId, canvasState));
  }, [updateCurrentCompetition]);

  /**
   * Targeted candidate deletion (PR #62 review CRIT-3, IMP-4). The cleanup
   * dialog snapshots ids at open time and passes them here — adding more
   * candidates between dialog-open and confirm doesn't sweep them away.
   *
   * Rethrows when any per-id OPFS deletion fails, so the dialog can keep
   * itself open and surface the partial failure. The `removeCandidate`
   * single-id path remains best-effort (warning + swallow) because it's
   * invoked from per-click UI where a per-failure modal would be hostile.
   */
  const deleteCandidates = useCallback(async (photoIds: string[]): Promise<{ deleted: number; skipped: number }> => {
    if (photoIds.length === 0) return { deleted: 0, skipped: 0 };
    const compId = currentCompetition?.id;
    const idsSet = new Set(photoIds);
    // Filter to ids that are STILL in the candidate pool — protects against
    // a race where a candidate was promoted to a slot between dialog-snapshot
    // and confirm. `isPhotoReferencedInSession` would catch this AFTER the
    // mutation too, but it's clearer to gate up front.
    const presentIds = (currentCompetition?.session.candidates?.photos ?? [])
      .filter(p => idsSet.has(p.id))
      .map(p => p.id);
    // PR #62 review I6: `presentIds.length === 0` was previously a silent
    // no-op — the cleanup dialog closed with no feedback even though 0 of
    // N requested photos were deleted. Surface the snapshot-drift count.
    if (presentIds.length === 0) return { deleted: 0, skipped: photoIds.length };
    let safeIds: string[] = [];
    await updateCurrentCompetition(session => {
      let next = session;
      for (const id of presentIds) {
        const target = next.candidates?.photos?.find(p => p.id === id);
        if (typeof target?.url === 'string' && target.url.startsWith('blob:')) {
          try { URL.revokeObjectURL(target.url); } catch (err) {
            console.warn(`deleteCandidates: revoke failed for ${id}:`, err);
          }
        }
        next = removeCandidatePure(next, id);
      }
      // Only delete the OPFS files that no other container references —
      // protects against a promotion racing the delete (PR #62 review IMP-2).
      // Also exclude `pm-` prefixed photos: those are owned by map-corridors
      // (shared `competitions/{compId}/photos/`); deleting them here strands
      // the map marker and silently breaks the next `useMapPicksSync` pass
      // (`getPhotoBlob` → NotFoundError → entry skipped). See removeCandidate
      // for the symmetric guard and user feedback 2026-05-17 rationale.
      safeIds = presentIds.filter(id =>
        !isPhotoReferencedInSession(next, id) && !id.startsWith('pm-')
      );
      return next;
    }, { updatePhotos: true });
    if (compId && safeIds.length > 0) {
      const { failed } = await competitionService.deletePhotosByIds(compId, safeIds);
      if (failed.length > 0) {
        throw new Error(
          t('errors.candidateDeletePartialFailure', { failed: failed.length, total: safeIds.length })
        );
      }
    }
    return {
      deleted: presentIds.length,
      skipped: photoIds.length - presentIds.length,
    };
  }, [updateCurrentCompetition, currentCompetition, t]);

  const clearAllCandidates = useCallback(async () => {
    const ids = (currentCompetition?.session.candidates?.photos ?? []).map(p => p.id);
    await deleteCandidates(ids);
  }, [deleteCandidates, currentCompetition]);

  const reorderPhotos = useCallback(async (setKey: 'set1' | 'set2', fromIndex: number, toIndex: number) => {
    await updateCurrentCompetition(session => {
      // Ensure sets structure is valid
      const ensuredSets = {
        set1: session.sets?.set1 || { title: '', photos: [] },
        set2: session.sets?.set2 || { title: '', photos: [] }
      };

      const photos = [...(ensuredSets[setKey].photos || [])];
      if (fromIndex < 0 || fromIndex >= photos.length || toIndex < 0 || toIndex >= photos.length) {
        return session; // Invalid indices, no change
      }

      // Remove photo from original position and insert at new position
      const [movedPhoto] = photos.splice(fromIndex, 1);
      photos.splice(toIndex, 0, movedPhoto);

      return {
        ...session,
        version: session.version + 1,
        updatedAt: new Date().toISOString(),
        sets: {
          ...ensuredSets,
          [setKey]: {
            ...ensuredSets[setKey],
            photos
          }
        }
      };
    });
  }, [updateCurrentCompetition]);

  const shufflePhotos = useCallback(async (target: 'set1' | 'set2' | 'both') => {
    await updateCurrentCompetition(session => {
      // Ensure sets structure is valid
      const ensuredSets = {
        set1: session.sets?.set1 || { title: '', photos: [] },
        set2: session.sets?.set2 || { title: '', photos: [] }
      };

      // Fisher-Yates shuffle
      const shuffle = <T,>(arr: T[]): T[] => {
        const result = [...arr];
        for (let i = result.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
      };

      const newSets = { ...ensuredSets };
      if (target === 'set1' || target === 'both') {
        newSets.set1 = { ...ensuredSets.set1, photos: shuffle(ensuredSets.set1.photos || []) };
      }
      if (target === 'set2' || target === 'both') {
        newSets.set2 = { ...ensuredSets.set2, photos: shuffle(ensuredSets.set2.photos || []) };
      }

      return {
        ...session,
        version: session.version + 1,
        updatedAt: new Date().toISOString(),
        sets: newSets
      };
    });
  }, [updateCurrentCompetition]);

  const applySettingToAll = useCallback(async (setting: CanvasSetting, value: number, excludePhotoId?: string) => {
    await updateCurrentCompetition(session => {
      const normalized = {
        ...session,
        sets: {
          set1: session.sets?.set1 || { title: '', photos: [] },
          set2: session.sets?.set2 || { title: '', photos: [] },
        },
      };
      return applySettingToAllInSession(normalized, setting, value, excludePhotoId);
    });
  }, [updateCurrentCompetition]);

  // Sync label corner across every photo in both sets — see usePhotoSessionOPFS
  // for the canonical comment. This wrapper keeps the competition-system
  // surface symmetric with applySettingToAll.
  //
  // The explicit !currentCompetition guard surfaces the "no active competition"
  // race (user clicks Sync while a competition switch is in flight) as a
  // user-visible error banner instead of letting `updateCurrentCompetition`'s
  // silent early-return at line ~405 swallow the click. The button is also
  // gated in AppApi via `supportsApplyLabelPositionToAll`, but a defensive
  // guard here means future call sites can't reintroduce the silent failure.
  const applyLabelPositionToAll = useCallback(async (position: LabelPosition, excludePhotoId?: string) => {
    if (!currentCompetition) {
      // Match the in-file convention (lines 298, 332, 396) — hardcoded
      // English error strings. The error banner is informational; the
      // primary defence against this race is the supportsApplyLabelPosition
      // gate in AppApi.tsx.
      setError('No active competition to sync label corner');
      return;
    }
    await updateCurrentCompetition(session => {
      const normalized = {
        ...session,
        sets: {
          set1: session.sets?.set1 || { title: '', photos: [] },
          set2: session.sets?.set2 || { title: '', photos: [] },
        },
      };
      return applyLabelPositionToAllInSession(normalized, position, excludePhotoId);
    });
  }, [currentCompetition, updateCurrentCompetition]);

  const updatePhotoState = useCallback(async (setKey: 'set1' | 'set2', photoId: string, canvasState: Partial<ApiPhoto['canvasState']>) => {
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

      // Auto-update Set 2 title when Set 1 matches the `SP - TP<N>` pattern
      // (track mode only). See `deriveSet2FromSet1` for the regex and the
      // `SP - TPX` placeholder exclusion.
      if (session.mode === 'track' && setKey === 'set1') {
        const derivedSet2 = deriveSet2FromSet1(title);
        if (derivedSet2 !== null) {
          updatedSets.set2 = { ...updatedSets.set2, title: derivedSet2 };
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
      
      // Revoke the OUTGOING mode's blob URLs — both `session.sets`
      // (outgoing view) AND the outgoing mode-bucket (`setsTrack` or
      // `setsTurning`, whichever the user is leaving). The two carry
      // INDEPENDENT `blob:` URL strings even when they reference the
      // same File, because `competitionService.loadSessionPhotos` calls
      // `URL.createObjectURL` once per bucket. Skipping the outgoing
      // mode-bucket leaks ~9-20 URL registrations per mode switch.
      //
      // Critically, we do NOT pre-revoke the INCOMING mode-bucket. Its
      // URLs are about to become `session.sets` after the OPFS reload
      // below; pre-revoking causes the "photos flicker and disappear"
      // symptom (feedback 2026-04-26 #4) because the renderer holds
      // dead `blob:` references in React state for one frame before the
      // reload regenerates fresh URLs.
      //
      // Selection logic lives in the unit-tested
      // `collectModeSwitchRevokeUrls` helper so a future "fix the leak"
      // refactor can't silently re-introduce the flicker by adding the
      // incoming bucket to the list.
      try {
        const urlsToRevoke = collectModeSwitchRevokeUrls(session, mode);
        for (const url of urlsToRevoke) {
          try { URL.revokeObjectURL(url); } catch {}
        }
      } catch {}
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
        const trackTitles = defaultTrackSetTitles(isPrecisionDiscipline);
        if (!newSets.set1.title || newSets.set1.title.trim() === '') {
          newSets.set1.title = trackTitles.set1;
        }
        if (!newSets.set2.title || newSets.set2.title.trim() === '') {
          newSets.set2.title = trackTitles.set2;
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
      const reloadedCompetition = await migrateLoadedCompetition(
        await competitionService.getCompetition(currentCompetition.id),
      );
      setCurrentCompetition(reloadedCompetition);
      // Refresh storage stats after mode switch persistence
      try {
        await updateStorageStats();
      } catch {}
      
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
      layoutMode
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
      const activeCompetition = await migrateLoadedCompetition(
        await competitionService.getActiveCompetition(),
      );
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
    // Same source-of-truth helper as usePhotoSessionOPFS so the four sites
    // can't drift (round-5 follow-up to feedback 2026-05-03).
    const gridCapacity = getGridCapacity(session as any);
    
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
    isDesktopManaged,

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
    // Methods to align with AppApi expectations
    reorderPhotos,
    shufflePhotos,
    // Rally turning-point initial drop: distribute files across set1 (first
    // 10) and set2 (remainder). Per-set capacity is 10 in BOTH orientations
    // (feedback 2026-05-03 — landscape auto-expands from 3×3 to 5×2 at 10).
    // Without this, a 10+ photo drop overflowed set1 invisibly.
    addPhotosToTurningPoint: async (files: File[]): Promise<AddPhotosResult> => {
      const session = currentCompetition?.session;
      if (!session) {
        // Asymmetric with the overflow branch below, which surfaces via
        // `setError`. Silently dropping 10–18 files because the session is
        // transiently null (initial load, switch-competition in flight) is
        // the exact silent-failure pattern this PR set out to eliminate.
        // PR #62 review I2: localised; was hardcoded English.
        const message = t('errors.noActiveCompetition');
        setError(message);
        return { kind: 'err', reason: 'no-competition', message };
      }
      const layoutMode = (session as any).layoutMode === 'portrait' ? 'portrait' : 'landscape';
      const set1Count = session.sets?.set1?.photos?.length ?? 0;
      const set2Count = session.sets?.set2?.photos?.length ?? 0;
      const result = distributeRallyDrop({ files, layoutMode, set1Count, set2Count });
      if (!result.ok) {
        // Smart-drop at total-capacity level: rather than erroring on a
        // 25-photo drop into a 20-cap rally turning-point session, route the
        // whole batch to candidates. Return `routedTo: 'tray'` so AppApi can
        // surface the toast (PR #62 review I1: previously this was silent
        // and felt like the photos "vanished").
        await addPhotosToCandidates(files);
        return { kind: 'ok', routedTo: 'tray', count: files.length };
      }
      // Inspect inner results so we don't claim `routedTo: 'slot', count: N`
      // when an inner `addPhotosToSet` actually hit its over-capacity guard
      // (PR #62 review I1). Previously the discarded inner err meant the
      // outer caller's smart-drop toast never fired and the user had no
      // map back from "set1 failed silently, set2 took 8 of 18".
      const r1 = result.toSet1.length ? await addPhotosToSet(result.toSet1, 'set1') : null;
      const r2 = result.toSet2.length ? await addPhotosToSet(result.toSet2, 'set2') : null;
      if (r1?.kind === 'err') return r1;
      if (r2?.kind === 'err') return r2;
      const added = (r1?.kind === 'ok' ? r1.count : 0) + (r2?.kind === 'ok' ? r2.count : 0);
      const r1Tray = r1?.kind === 'ok' && r1.routedTo === 'tray';
      const r2Tray = r2?.kind === 'ok' && r2.routedTo === 'tray';
      // If either half overflowed into the tray, the outer caller needs to
      // know so it can surface the smart-drop toast. Only report 'slot' when
      // BOTH halves landed in slots.
      const routedTo: 'slot' | 'tray' = r1Tray || r2Tray ? 'tray' : 'slot';
      return { kind: 'ok', routedTo, count: added };
    },
    refreshSession: (async () => {}) as any,
    applySettingToAll,
    applyLabelPositionToAll,

    // Candidate pool surface
    addPhotosToCandidates,
    addExistingCandidate,
    importPickToSets,
    removeCandidate,
    promoteCandidateToSlot,
    addPlaceholderToSet,
    demoteSlotToCandidate,
    setCandidateFlag,
    setCandidateLabel,
    setCandidateFilename,
    updateCandidatePhotoState,
    deleteCandidates,
    clearAllCandidates,
    
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
