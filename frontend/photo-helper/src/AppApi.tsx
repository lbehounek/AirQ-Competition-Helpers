import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Chip,
  Alert,
  Button,
  IconButton,
  Modal,
  Backdrop,
  Fade,
  useMediaQuery,
  useTheme,
  Link,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  Snackbar,
  Tooltip
} from '@mui/material';
import {
  FlightTakeoff,
  RestartAlt,
  Close,
  PictureAsPdf,
  Shuffle,
  Warning,
  Home,
  Map,
  ChevronLeft,
  ChevronRight,
  HelpOutline,
} from '@mui/icons-material';
import { useCompetitionSystem } from './hooks/useCompetitionSystem';
import { useClipboardPaste } from './hooks/useClipboardPaste';
import { useMapPicksSync } from './hooks/useMapPicksSync';
import { startPhotoHelperTour, startEditorModalTour, scheduleAutoStartTour, markTourSeen } from './onboarding/photoHelperTour';
import {
  buildEditorPicks,
  flushPendingEditorPicks,
  scheduleWriteEditorPicks,
} from './handoff/editorPicksWriter';
import { getStorage, type DirectoryHandle } from '@airq/shared-storage';
import { GridSizedDropZone } from './components/GridSizedDropZone';
import { PhotoGridApi } from './components/PhotoGridApi';
import { EditableHeading } from './components/EditableHeading';
import { PhotoEditorApi } from './components/PhotoEditorApi';
import { PhotoControls } from './components/PhotoControls';
import { AspectRatioSelector } from './components/AspectRatioSelector';
import { LabelingSelector } from './components/LabelingSelector';
import { ModeSelector } from './components/ModeSelector';
import { TurningPointLayout } from './components/TurningPointLayout';
import { LayoutModeSelector } from './components/LayoutModeSelector';
import { CompetitionSelector } from './components/CompetitionSelector';
import { CreateCompetitionButton } from './components/CreateCompetitionButton';
import { CleanupModal } from './components/CleanupModal';
import { CandidateTray } from './components/CandidateTray';
import { ImportPhotosControl } from './components/ImportPhotosControl';
import { useAspectRatio } from './contexts/AspectRatioContext';
import { useLabeling } from './contexts/LabelingContext';
import { useI18n } from './contexts/I18nContext';
import { useLayoutMode } from './contexts/LayoutModeContext';
import { generatePDF } from './utils/pdfGenerator';
import { generateTurningPointLabels } from './utils/imageProcessing';
import { parseDiscipline } from './utils/parseDiscipline';
import type { Discipline } from './utils/parseDiscipline';
import { buildPdfSets } from './utils/buildPdfSets';
import { pickEffectiveLayout } from './utils/pickEffectiveLayout';
import { deriveSet2FromSet1 } from './utils/autoPrefillSetTitle';
import { getGridCapacity } from './utils/getGridCapacity';
import type { ApiPhoto } from './types/api';

function AppApi() {
  // Desktop launcher passes `?discipline=precision|rally` when opening this app
  // (desktop/main.js:205). Default to rally for web / legacy sessions.
  const discipline: Discipline = useMemo(() => parseDiscipline(window.location.search), []);
  const isPrecision = discipline === 'precision';

  const sessionHookResult = useCompetitionSystem() as any;
  const {
    session,
    loading,
    error,
    addPhotosToSet,
    removePhoto,
    updatePhotoState,
    updateSetTitle,
    updateSessionMode,
    updateLayoutMode,
    updateSessionCompetitionName,
    getSessionStats,
    clearError,
    // Competition-specific features (only available in OPFS mode)
    currentCompetition,
    competitions,
    createNewCompetition,
    switchToCompetition,
    deleteCompetition,
    cleanupCandidates,
    storageStats,
    performCleanup,
    dismissCleanup,
    updateStorageStats,
    isDesktopManaged,
    // Candidate pool operations (see docs/CANDIDATE_PHOTOS.md)
    addPhotosToCandidates,
    addExistingCandidate,
    importPickToSets,
    reconcilePlacedToSets,
    removeCandidate,
    promoteCandidateToSlot,
    addPlaceholderToSet,
    demoteSlotToCandidate,
    setCandidateFlag,
    setCandidateLabel,
    setCandidateFilename,
    updateCandidatePhotoState,
    deleteCandidates,
  } = sessionHookResult;

  // i18n — declared near the top because `handleReflowError` (below) reads `t`
  // in its body + deps, and that callback must precede the `pmcSessionApi`
  // useMemo that consumes it. Declaring `t` lower would put it in the temporal
  // dead zone at the callback's deps-array evaluation and crash on render.
  const { t } = useI18n();

  // Onboarding tour — replay from the "?" button; auto-start once on first run.
  // `t`'s identity changes when I18nContext re-renders, so read it via a ref and
  // run the auto-start effect ONCE on mount (see Map Corridors review note).
  const tRef = useRef(t);
  tRef.current = t;
  // The "answer sheets" step differs by discipline (rally: Set 1/Set 2;
  // precision: a single sheet). `discipline` is parsed once at mount (above),
  // so a ref keeps the once-on-mount effect stable.
  const isPrecisionRef = useRef(false);
  isPrecisionRef.current = discipline === 'precision';
  const handleStartTour = useCallback(() => {
    markTourSeen();
    startPhotoHelperTour(tRef.current, isPrecisionRef.current);
  }, []);
  useEffect(() => {
    return scheduleAutoStartTour(() => startPhotoHelperTour(tRef.current, isPrecisionRef.current));
  }, []);
  // The editor modal hosts its own "?" that highlights the editing controls in
  // place (robustly — the modal is open, so the controls exist). Declared here,
  // populated below once `t` is captured.
  const startEditorTour = useCallback(() => startEditorModalTour(tRef.current), []);

  // Candidate photos — derived from session for stable rendering. The pool
  // is optional on older sessions, so default to empty.
  const candidatePhotos: ApiPhoto[] = session?.candidates?.photos ?? [];

  // `pm-` ids already placed in a set across any discipline bucket. Fed to
  // useMapPicksSync so a re-sync never re-inserts an auto-routed photo into
  // the tray (placed photos drop their flag + leave the candidate pool, so
  // the candidates-only dedup can't see them). Recomputed whenever the sets
  // change. See docs/CANDIDATE_PHOTOS.md "Map-pick auto-routing".
  const placedPmIds: ReadonlySet<string> = useMemo(() => {
    const ids = new Set<string>();
    const collect = (sets?: { set1: { photos: ApiPhoto[] }; set2: { photos: ApiPhoto[] } }) => {
      if (!sets) return;
      for (const setKey of ['set1', 'set2'] as const) {
        for (const p of sets[setKey].photos) {
          if (p.id.startsWith('pm-')) ids.add(p.id);
        }
      }
    };
    collect(session?.sets);
    collect(session?.setsTrack);
    collect(session?.setsTurning);
    return ids;
  }, [session?.sets, session?.setsTrack, session?.setsTurning]);

  // Phase 8b of photo-map-culling — resolve the per-competition dirs
  // and mount the map-picks sync hook. The dirs come from the OPFS
  // layout `competitions/{compId}/{photos,}`; matches map-corridors'
  // useCorridorSessionOPFS resolution, so the writer + reader agree
  // on paths.
  const [pmcCompetitionDir, setPmcCompetitionDir] = useState<DirectoryHandle | null>(null);
  const [pmcPhotosDir, setPmcPhotosDir] = useState<DirectoryHandle | null>(null);
  // Sticky banner shown when cross-app dir resolution fails (OPFS unavailable,
  // permission revoked, transient I/O during init). Without it the editor
  // looks normal but the map → editor handoff is silently dead for the
  // session.
  const [pmcSyncUnavailable, setPmcSyncUnavailable] = useState(false);
  const pmcCompetitionId = currentCompetition?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!pmcCompetitionId) {
      setPmcCompetitionDir(null);
      setPmcPhotosDir(null);
      setPmcSyncUnavailable(false);
      return;
    }
    void (async () => {
      try {
        const storage = getStorage();
        const handles = await storage.init();
        const competitionsDir = await storage.getDirectoryHandle(handles.root, 'competitions', { create: true });
        const compDir = await storage.getDirectoryHandle(competitionsDir, pmcCompetitionId, { create: true });
        const photosDir = await storage.getDirectoryHandle(compDir, 'photos', { create: true });
        if (cancelled) return;
        setPmcCompetitionDir(compDir);
        setPmcPhotosDir(photosDir);
        setPmcSyncUnavailable(false);
      } catch (err) {
        console.warn('[AppApi] failed to resolve photo-map-culling dirs:', err);
        if (!cancelled) setPmcSyncUnavailable(true);
      }
    })();
    return () => { cancelled = true; };
  }, [pmcCompetitionId]);

  // Warning snackbar when a break-driven re-flow (set1↔set2) failed to persist
  // for some placed picks during a map-picks sync. Declared BEFORE pmcSessionApi
  // because that useMemo reads it in its factory + deps (a `const` used earlier
  // would hit the temporal dead zone and throw on render).
  const [reflowErrorToast, setReflowErrorToast] = useState<string | null>(null);
  const handleReflowError = useCallback(
    (failedCount: number) => setReflowErrorToast(t('candidates.reflowFailed', { count: failedCount })),
    [t],
  );

  const pmcSessionApi = useMemo(() => ({
    candidates: candidatePhotos,
    placedIds: placedPmIds,
    // Active discipline — drives which placed picks reflow on a break change
    // (only the visible discipline; the other reconciles when it's shown).
    mode: session?.mode ?? 'track',
    addCandidate: addExistingCandidate,
    importPick: importPickToSets,
    reconcilePlaced: reconcilePlacedToSets,
    removeCandidate,
    setCandidateFlag,
    setCandidateLabel,
    setCandidateFilename,
    onReflowError: handleReflowError,
  }), [candidatePhotos, placedPmIds, session?.mode, addExistingCandidate, importPickToSets, reconcilePlacedToSets, removeCandidate, setCandidateFlag, setCandidateLabel, setCandidateFilename, handleReflowError]);

  useMapPicksSync(pmcCompetitionDir, pmcPhotosDir, pmcSessionApi);

  // Phase B — write photo-helper-picks.json on every candidate change so
  // map-corridors picks up label edits made in this app. Debounced 300ms
  // by the writer; pagehide flushes best-effort.
  useEffect(() => {
    if (!pmcCompetitionDir) return;
    try {
      const storage = getStorage();
      const picks = buildEditorPicks(candidatePhotos);
      scheduleWriteEditorPicks(storage, pmcCompetitionDir, picks);
    } catch (err) {
      console.warn('[AppApi] scheduleWriteEditorPicks failed:', err);
    }
  }, [candidatePhotos, pmcCompetitionDir]);

  useEffect(() => {
    const onPageHide = () => { void flushPendingEditorPicks(); };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  // Session identifiers and storage stats come from the OPFS-backed
  // useCompetitionSystem hook — no network round-trip, so availability is
  // implicit. Previously these were ternaries fanning out between an OPFS and
  // a legacy FastAPI path.
  const sessionId = session?.id;
  const isStorageLow = storageStats?.isLow;
  const storagePercentFree = storageStats?.percentUsed ? 100 - storageStats.percentUsed : null;
  const storageUsedBytes = storageStats?.usedBytes;
  const storageQuotaBytes = storageStats?.quotaBytes;
  const updateStorageEstimate = updateStorageStats;
  const addPhotosToTurningPoint = sessionHookResult.addPhotosToTurningPoint || addPhotosToSet;
  const updateSetTitles = sessionHookResult.updateSetTitles || updateSetTitle;
  // Feature support flags (default false) and function refs when supported
  const supportsReorder = Boolean(sessionHookResult.reorderPhotos);
  const reorderPhotos = supportsReorder ? sessionHookResult.reorderPhotos : undefined;
  const supportsShuffle = Boolean(sessionHookResult.shufflePhotos);
  const shufflePhotos = supportsShuffle ? sessionHookResult.shufflePhotos : undefined;
  const updateCompetitionName = updateSessionCompetitionName;
  const supportsReset = Boolean(sessionHookResult.resetSession);
  const resetSession = supportsReset ? sessionHookResult.resetSession : undefined;
  const supportsRefresh = Boolean(sessionHookResult.refreshSession);
  const refreshSession = supportsRefresh ? sessionHookResult.refreshSession : undefined;
  const supportsApplyToAll = Boolean(sessionHookResult.applySettingToAll);
  const applySettingToAll = supportsApplyToAll ? sessionHookResult.applySettingToAll : undefined;
  // Mirrors the supportsApplyToAll pattern above. Without this Boolean gate
  // the prop would be always-truthy (the hook unconditionally exposes the
  // function) and the "Sync corner to all" button would render even on a
  // hook variant that doesn't implement label sync — a click then becomes a
  // silent no-op. Consistent gating across all session-bulk operations.
  const supportsApplyLabelPositionToAll = Boolean(sessionHookResult.applyLabelPositionToAll);
  const applyLabelPositionToAll = supportsApplyLabelPositionToAll ? sessionHookResult.applyLabelPositionToAll : undefined;
  
  const { currentRatio } = useAspectRatio();
  const { generateLabel } = useLabeling();
  const { setLayoutMode, layoutMode } = useLayoutMode();
  const theme = useTheme();
  const isLargeScreen = useMediaQuery(theme.breakpoints.up('lg')); // lg = 1200px by default
  
  // State for delete confirmation dialog
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [competitionToDelete, setCompetitionToDelete] = useState<{ id: string; name: string } | null>(null);

  // State for rename competition dialog
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameText, setRenameText] = useState('');

  // Post-export cleanup dialog (offers to delete unused candidates after a
  // successful PDF generation). Snapshots BOTH the count AND the specific
  // candidate ids at export time so adding more candidates between dialog
  // open and confirm doesn't sweep them away (PR #62 review IMP-4).
  const [cleanupCandidatesDialog, setCleanupCandidatesDialog] = useState<{ count: number; sizeMB: number; ids: string[] } | null>(null);

  // Snackbar shown when smart-drop routes a slot-targeted batch into the
  // candidate tray (because the batch exceeded remaining slot capacity).
  // First dev-test feedback 2026-05-12: the routing was silent and felt
  // like the photos "disappeared" from the user's perspective.
  const [dropToast, setDropToast] = useState<{ count: number } | null>(null);

  // Snackbar shown when "Add photos" skips files already in the session
  // (content-hash re-import dedup, ADR-020) — so fewer-than-selected photos
  // appearing isn't a mystery.
  const [dupToast, setDupToast] = useState<{ count: number } | null>(null);

  // Friendly, actionable surface for a PDF export failure (replaces a raw
  // native alert showing the technical message). Most failures are "a photo
  // lost its image bytes"; the message tells the user how to recover.
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Hint snackbar for cross-set slot→slot drags (out of scope in v1 per
  // docs/CANDIDATE_PHOTOS.md). Previously a silent no-op (PR #62 review I4).
  const [crossSetHintOpen, setCrossSetHintOpen] = useState(false);

  // Error snackbar for cleanup-dialog failures (PR #62 review IMP-5). The
  // hook's `deleteCandidates` rethrows on OPFS partial failure (CRIT-3); the
  // snackbar replaces the previous blocking `alert()` and is i18n-friendly.
  const [cleanupErrorToast, setCleanupErrorToast] = useState<string | null>(null);

  // Wrapper around the hook's `addPhotosToSet` that surfaces the smart-drop
  // routing result. Calling sites stay simple — they just pass files + set.
  // The hook owns error reporting via `setError` → global Alert (PR #62
  // review IMP-8: dropped dead AppApi try/catch); we just react to the
  // 'ok'-arm tray-routing for the toast.
  const handleAddToSet = async (files: File[], setKey: 'set1' | 'set2') => {
    const result = await addPhotosToSet(files, setKey);
    if (result?.kind === 'ok' && result.routedTo === 'tray' && result.count > 0) {
      setDropToast({ count: result.count });
    }
  };

  // Wrapper around the hook's `addPhotosToCandidates` that surfaces the re-import
  // dedup (ADR-020). The dedup happens hook-side for every caller; this only adds
  // the toast at the user-facing import sites so a skipped duplicate isn't silent.
  const handleAddCandidates = async (files: File[]) => {
    if (!addPhotosToCandidates) return;
    const r = await addPhotosToCandidates(files);
    if (r && r.duplicates > 0) setDupToast({ count: r.duplicates });
  };

  // Initial drop for rally turning-point distributes across set1+set2; on total
  // overflow the hook routes everything to the candidate tray. Surface the toast
  // the same way `handleAddToSet` does (PR #62 review I1).
  const handleInitialTurningPointDrop = async (files: File[]) => {
    const result = await addPhotosToTurningPoint(files);
    if (result?.kind === 'ok' && result.routedTo === 'tray' && result.count > 0) {
      setDropToast({ count: result.count });
    }
  };

  // Ctrl+V from Total Commander / Explorer / Finder, or from a screenshot
  // tool, lands here. Pasted photos go into the candidate tray (slotless
  // pool) because the user hasn't specified a slot — they can then drag to
  // the right grid position. Same destination the GridSizedDropZone uses
  // when initial drops overflow capacity. Disabled until a competition is
  // loaded so a pre-mount paste can't race the session bootstrap.
  const { pasteError, clearPasteError } = useClipboardPaste({
    addFiles: (files) => {
      void handleAddCandidates(files);
    },
    disabled: !session || !addPhotosToCandidates,
  });

  // selectedPhoto.setKey === 'candidates' for tray-source photos. Label is
  // empty in that case (tray photos have no slot index). The modal reuses
  // the same editor and persistence dispatches to the right hook method.
  const [selectedPhoto, setSelectedPhoto] = useState<{
    photo: ApiPhoto;
    setKey: 'set1' | 'set2' | 'candidates';
    label: string;
  } | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [circleMode, setCircleMode] = useState(false);

  const stats = getSessionStats();
  const SHOW_WELCOME_INSTRUCTIONS = false;

  // Humanize bytes
  const formatBytes = (b?: number | null) => {
    if (b == null) return 'unknown';
    const units = ['B','KB','MB','GB','TB'];
    let v = b;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(1)} ${units[i]}`;
  };

  // Log relation ID to console (removed from UI)
  useEffect(() => {
    if (sessionId) {
      console.log('Session ID:', sessionId);
    }
  }, [sessionId]);

  // Sync layout mode with session
  useEffect(() => {
    if (session?.layoutMode) {
      setLayoutMode(session.layoutMode);
    }
  }, [session?.layoutMode, setLayoutMode]);

  // Precision-track auto-layout switching removed (first dev-test feedback
  // 2026-05-12): the 9→10 portrait flip is gone. Users pick layout manually
  // via `LayoutModeSelector`; capacity follows that choice via
  // `getGridCapacity`. The candidate tray now absorbs any drop that exceeds
  // the current slot capacity, so a "10th photo" no longer needs a special
  // path. (Rally turning-point's grid column expand from 3×3 → 5×2 at 10
  // photos in landscape is left in place — it's not a layout-mode change,
  // just grid columns within landscape — but can be re-evaluated if it also
  // feels confusing.)

  // Label for a slotted photo at a given index in set1/set2, mirroring the grid
  // labels (mode-aware). Extracted so photo-click AND modal prev/next nav share
  // one source of truth. Candidate (tray) photos have no slot index → ''.
  const computeLabelForSlot = (setKey: 'set1' | 'set2', photoIndex: number): string => {
    if (session?.mode === 'turningpoint') {
      // Turning point mode: SP, TP1, TP2, ..., FP
      const set1Count = session.sets.set1.photos.length;
      // Precision mode hides set2 in the UI, so labels also ignore it
      // (keeps SP/TP/FP sequence anchored to the single visible grid).
      const set2Count = isPrecision ? 0 : session.sets.set2.photos.length;
      const turningPointLabels = generateTurningPointLabels(set1Count, set2Count, session.layoutMode || 'landscape');
      return (setKey === 'set1' ? turningPointLabels.set1[photoIndex] : turningPointLabels.set2[photoIndex]) || 'X';
    }
    // Track mode: use labeling context (letters or numbers) with offset
    if (setKey === 'set1') {
      return generateLabel(photoIndex);
    }
    const set1Count = session?.sets.set1?.photos?.length || 0;
    return generateLabel(photoIndex, set1Count); // Continue sequence from Set 1
  };

  const handlePhotoClick = (photo: ApiPhoto, setKey: 'set1' | 'set2') => {
    const setPhotos = session?.sets[setKey].photos || [];
    const photoIndex = setPhotos.findIndex((p: ApiPhoto) => p.id === photo.id);
    setSelectedPhoto({ photo, setKey, label: computeLabelForSlot(setKey, photoIndex) });
  };

  // Click handler for tray thumbs — opens the same editor modal, label is
  // empty because tray photos have no slot index yet.
  const handleCandidateClick = (photo: ApiPhoto) => {
    setSelectedPhoto({ photo, setKey: 'candidates', label: '' });
  };


  // The ordered photo list the modal navigates within — the set/pool the
  // currently-open photo came from. Used by prev/next arrows + arrow keys.
  const modalPhotoList: ApiPhoto[] = selectedPhoto
    ? (selectedPhoto.setKey === 'candidates'
        ? (session?.candidates?.photos || [])
        : (session?.sets[selectedPhoto.setKey]?.photos || []))
    : [];

  // Step to the previous/next photo within the same set/pool. Clamps at the
  // ends (no wrap), regenerating the label for slotted photos.
  const navigateModalPhoto = useCallback((dir: -1 | 1) => {
    setSelectedPhoto(prev => {
      if (!prev) return prev;
      const list = prev.setKey === 'candidates'
        ? (session?.candidates?.photos || [])
        : (session?.sets[prev.setKey]?.photos || []);
      const idx = list.findIndex((p: ApiPhoto) => p.id === prev.photo.id);
      if (idx === -1) return prev;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= list.length) return prev;
      const nextPhoto = list[nextIdx];
      const label = prev.setKey === 'candidates' ? '' : computeLabelForSlot(prev.setKey, nextIdx);
      return { photo: nextPhoto, setKey: prev.setKey, label };
    });
  // computeLabelForSlot closes over session/isPrecision/generateLabel; session
  // is the meaningful dependency for the list + label recompute.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isPrecision, generateLabel]);

  const modalIndex = selectedPhoto ? modalPhotoList.findIndex((p: ApiPhoto) => p.id === selectedPhoto.photo.id) : -1;
  const canPrev = modalIndex > 0;
  const canNext = modalIndex >= 0 && modalIndex < modalPhotoList.length - 1;

  // Arrow-key navigation while the modal is open.
  useEffect(() => {
    if (!selectedPhoto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); navigateModalPhoto(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); navigateModalPhoto(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPhoto, navigateModalPhoto]);

  // Tray → slot promotion. The hook handles swap-on-occupied semantics and the
  // capacity clamp for out-of-range indices (PR #62 review C1). Errors are
  // routed through the hook's internal try/catch → global error banner; no
  // local try/catch needed (PR #62 review IMP-8 — dead catch was misleading).
  const handleCandidateDropped = (setKey: 'set1' | 'set2') => async (candidateId: string, slotIndex: number) => {
    if (!promoteCandidateToSlot) return;
    await promoteCandidateToSlot(candidateId, setKey, slotIndex);
  };

  // Slot → tray demotion when a slot photo is dragged onto the tray drop zone.
  const handleSlotDroppedToTray = async (payload: { setKey: 'set1' | 'set2'; photoId: string }) => {
    if (!demoteSlotToCandidate) return;
    await demoteSlotToCandidate(payload.setKey, payload.photoId);
  };

  // "Send to Set X" from the tray toolbar. If the target set is full, we ask
  // the hook for a swap with the LAST slot photo by passing `capacity - 1`;
  // otherwise we append at the next empty index. The hook clamps anyway, but
  // computing it here keeps the intent explicit at the call site.
  const handleSendCandidateToSet = async (photoId: string, setKey: 'set1' | 'set2') => {
    if (!session || !promoteCandidateToSlot) return;
    const capacity = getGridCapacity(session as any);
    const slotCount = session.sets[setKey].photos.length;
    const slotIndex = slotCount < capacity ? slotCount : Math.max(0, capacity - 1);
    await promoteCandidateToSlot(photoId, setKey, slotIndex);
  };

  // "Send to TP photos": route a tray candidate into the turning-point set.
  // There is no always-on TP container — turning-point photos ARE set1/set2
  // while the editor is in turning-point mode. So: if already in TP mode, place
  // directly; otherwise switch mode first and let the effect below finish the
  // placement once `session.mode` has actually flipped (updateSessionMode is
  // async and persistAndSet-based, so promoteCandidateToSlot can't be chained
  // synchronously without a stale-session closure). Reuses the existing tested
  // promote path — no new session-mutation logic.
  const [pendingTPSend, setPendingTPSend] = useState<string | null>(null);

  const handleSendCandidateToTP = async (photoId: string) => {
    if (!session) return;
    if (session.mode === 'turningpoint') {
      await handleSendCandidateToSet(photoId, 'set1');
      return;
    }
    setPendingTPSend(photoId);
    if (updateSessionMode) await updateSessionMode('turningpoint');
  };

  useEffect(() => {
    if (!pendingTPSend) return;
    if (session?.mode !== 'turningpoint') return;
    const photoId = pendingTPSend;
    setPendingTPSend(null);
    // Only place if the candidate is still in the pool (it may have been moved
    // or deleted between the mode switch and this effect firing).
    if (session.candidates?.photos?.some((p: ApiPhoto) => p.id === photoId)) {
      void handleSendCandidateToSet(photoId, 'set1');
    }
  // handleSendCandidateToSet closes over the fresh post-switch session; keying
  // on session.mode + pendingTPSend is the intended trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.mode, pendingTPSend]);

  const handlePhotoUpdate = (setKey: 'set1' | 'set2' | 'candidates', photoId: string, canvasState: Partial<ApiPhoto['canvasState']>) => {
    // Dispatch to the right backend method — slot photos go through
    // updatePhotoState, candidates through updateCandidatePhotoState. The
    // explicit `void` prefix marks fire-and-forget intent (PR #62 review
    // IMP-8) — hook owns its error reporting via `setError`, and we want the
    // optimistic local state update below to happen synchronously rather
    // than waiting on persistence.
    if (setKey === 'candidates') {
      if (updateCandidatePhotoState) void updateCandidatePhotoState(photoId, canvasState);
    } else {
      void updatePhotoState(setKey, photoId, canvasState);
    }

    // Optimistically update selected photo immediately for instant UI feedback
    if (selectedPhoto?.photo.id === photoId) {
      setSelectedPhoto({
        ...selectedPhoto,
        photo: {
          ...selectedPhoto.photo,
          canvasState: { ...selectedPhoto.photo.canvasState, ...canvasState }
        }
      });
    }
  };

  const handlePhotoRemove = (setKey: 'set1' | 'set2' | 'candidates', photoId: string) => {
    // Close editor optimistically; persistence is fire-and-forget (errors
    // surface via the global Alert from `setError`). Explicit `void`
    // documents the intent (PR #62 review IMP-8).
    if (selectedPhoto?.photo.id === photoId) {
      setSelectedPhoto(null);
    }
    if (setKey === 'candidates') {
      if (removeCandidate) void removeCandidate(photoId);
    } else {
      void removePhoto(setKey, photoId);
    }
  };

  // Delete confirmation handlers
  const handleDeleteCompetitionClick = (competition: { id: string; name: string }) => {
    setCompetitionToDelete(competition);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (competitionToDelete) {
      await deleteCompetition(competitionToDelete.id);
      setDeleteConfirmOpen(false);
      setCompetitionToDelete(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmOpen(false);
    setCompetitionToDelete(null);
  };

  // Rename confirmation handlers
  const handleRenameClick = () => {
    if (currentCompetition) {
      setRenameText(currentCompetition.name);
      setRenameDialogOpen(true);
    }
  };

  const handleRenameConfirm = async () => {
    if (renameText.trim() && currentCompetition) {
      await updateCompetitionName(renameText.trim());
      setRenameDialogOpen(false);
      setRenameText('');
    }
  };

  const handleRenameCancel = () => {
    setRenameDialogOpen(false);
    setRenameText('');
  };

  const handlePhotoMove = (setKey: 'set1' | 'set2', fromIndex: number, toIndex: number) => {
    // Use the new reorderPhotos function from the hook
    if (supportsReorder && reorderPhotos) {
      reorderPhotos(setKey, fromIndex, toIndex);
    }
  };

  const handleShuffle = async () => {
    if (!session) return;
    
    console.log('🎲 Shuffling photos in both sets...');
    
    // Shuffle both sets in a single state update (no flickering, both sets update!)
    if (supportsShuffle && shufflePhotos) {
      await shufflePhotos('both');
    }

    console.log('✨ Photo shuffle completed!');
  };

  // Auto-prefill logic for track mode set titles. When the user types a
  // title matching `SP - TP<N>` (e.g. `SP - TP3`), set2 is derived as
  // `TP<N> - FP` so the print header stays coherent without a separate
  // edit. The placeholder `SP - TPX` does NOT trigger derivation — see
  // `deriveSet2FromSet1` for the contract.
  const handleSet1TitleUpdate = async (title: string) => {
    console.log('Set1 title updated to:', title);
    const derivedSet2 = deriveSet2FromSet1(title);
    if (derivedSet2 !== null) {
      await updateSetTitles({ set1: title, set2: derivedSet2 });
    } else {
      await updateSetTitles({ set1: title });
    }
  };

  const handleGeneratePDF = async () => {
    if (!session || !sessionId) {
      console.error('No session available for PDF generation');
      return;
    }

    try {
      // Resolve via the pure helper so the precedence chain (context >
      // session > 'landscape') is unit-tested in isolation. See
      // `pickEffectiveLayout` for the rationale; in short, `session.layoutMode`
      // can lag the context by one OPFS write window after the user toggles
      // (feedback 2026-04-26 #5).
      const effectiveLayout = pickEffectiveLayout(layoutMode, session.layoutMode);
      const { set1WithLabels, set2WithLabels } = buildPdfSets({
        mode: session.mode,
        layoutMode: effectiveLayout,
        isPrecision,
        set1: session.sets.set1,
        set2: session.sets.set2,
        generateLabel,
      });

      await generatePDF(set1WithLabels, set2WithLabels, sessionId, currentRatio.ratio, session.competition_name, effectiveLayout, t, session.mode, currentCompetition?.id);

      // Post-export prompt: offer to clean up unused candidate photos so the
      // user doesn't accumulate them across competitions. ~3 MB per photo
      // matches the heuristic in `competitionService.estimateCompetitionSize`.
      // Snapshot the specific candidate ids so adding more candidates between
      // dialog open and confirm doesn't sweep them away (PR #62 review IMP-4).
      if (candidatePhotos.length > 0) {
        setCleanupCandidatesDialog({
          count: candidatePhotos.length,
          sizeMB: Math.round(candidatePhotos.length * 3),
          ids: candidatePhotos.map((p) => p.id),
        });
      }
    } catch (error) {
      // Surface to the user — previously this was a TODO ("Could add user
      // notification here") and a generatePDF render failure produced a
      // silent partial export. The hi-res render path can throw on memory
      // pressure / blob URL issues / mid-export photo state changes; the
      // user needs to know the export was aborted (or partial), not be left
      // wondering why the dialog never opened.
      console.error('PDF generation failed:', error);
      // The hi-res render path attaches `renderFailures` (one entry per
      // un-renderable photo — usually missing image bytes from a photo that was
      // deleted earlier). Turn that into a plain-language, actionable message
      // instead of dumping the raw technical string into a native alert().
      const failures = (error as { renderFailures?: unknown[] } | null)?.renderFailures;
      const failedCount = Array.isArray(failures) ? failures.length : 0;
      setPdfError(
        failedCount > 0
          ? t('pdf.error.renderFailed', { count: failedCount })
          : t('pdf.error.generic'),
      );
    }
  };

  const handleCleanupCandidatesConfirm = async () => {
    const dialog = cleanupCandidatesDialog;
    if (!dialog || !deleteCandidates) return;
    try {
      // Targeted delete using the snapshot ids (PR #62 review IMP-4). The
      // hook rethrows on OPFS partial failure so the dialog stays open and
      // the user knows it didn't complete (PR #62 review CRIT-3 — previously
      // `clearAllCandidates` swallowed failures internally, making the
      // outer try/catch unreachable dead code).
      const result = await deleteCandidates(dialog.ids);
      setCleanupCandidatesDialog(null);
      // PR #62 review I6: when every snapshot id was promoted to a slot
      // between dialog-open and confirm, the dialog used to close with a
      // silent success — the user believed 5 photos of storage were freed
      // but 0 were. Surface the snapshot-drift via the same Snackbar so
      // expectations match reality.
      if (result.deleted === 0 && result.skipped > 0) {
        setCleanupErrorToast(t('candidates.cleanup.allPromoted', { count: result.skipped }));
      }
    } catch (err) {
      // PR #62 review IMP-5: replaced blocking `alert()` with a Snackbar
      // consistent with the rest of the candidate-flow UX, and routed
      // through `t()` so the message picks up the active locale rather than
      // shipping an English exception message in the Czech UI.
      console.error('handleCleanupCandidatesConfirm failed:', err);
      const message = err instanceof Error ? err.message : t('candidates.cleanup.error');
      setCleanupErrorToast(message);
    }
  };
  const handleCleanupCandidatesDecline = () => setCleanupCandidatesDialog(null);

  // Helper: safely apply a setting to all photos with sane defaults
  // applySettingToAll now provided by hook for atomic updates across photos

  // No session created yet
  if (!session || !sessionId) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 4 }}>
        <Container maxWidth="md" sx={{ pt: 8 }}>
          <Alert severity="info" sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h5" sx={{ mb: 2 }}>
              Creating New Session...
            </Typography>
            <Typography>
              Setting up your photo organization workspace
            </Typography>
          </Alert>
        </Container>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 4 }}>
      <Container maxWidth={false} sx={{ pt: 4, px: { xs: 2, sm: 3, md: 4, lg: 5 } }}>
        {/* Unified Header and Controls */}
        <Paper elevation={2} sx={{ mb: 3, borderRadius: 2, overflow: 'hidden' }}>
          {/* Blue Header Section */}
          <Box sx={{
            p: 2,
            bgcolor: '#1565C0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {isDesktopManaged && (
                <IconButton
                  size="small"
                  onClick={() => (window as any).electronAPI?.goHome()}
                  sx={{ color: 'white', mr: 0.5 }}
                  title={t('app.backToMenu')}
                >
                  <Home />
                </IconButton>
              )}
              {isDesktopManaged && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    const params = new URLSearchParams(window.location.search);
                    const compId = params.get('competitionId');
                    (window as any).electronAPI?.navigateToApp('map-corridors', compId);
                  }}
                  startIcon={<Map sx={{ fontSize: 18 }} />}
                  sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.5)', textTransform: 'none', mr: 1.5, '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' } }}
                >
                  {t('app.switchToPlacement')}
                </Button>
              )}
              <FlightTakeoff sx={{ fontSize: 32, color: 'white', mr: 1.5 }} />
              <Typography variant="h5" component="h1" sx={{ color: 'white', fontWeight: 600 }}>
                {t('app.title')}
              </Typography>
              {currentCompetition && isDesktopManaged && (
                <Chip label={currentCompetition.name} size="small" sx={{ ml: 2, bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }} />
              )}
            </Box>
            <Tooltip title={t('tour.help.button')}>
              <IconButton size="small" onClick={handleStartTour} sx={{ color: 'white' }} aria-label={t('tour.help.button')} data-tour="help">
                <HelpOutline />
              </IconButton>
            </Tooltip>
          </Box>

          {/* White Content Section */}
          <Box sx={{ bgcolor: 'background.paper' }}>
            {/* Storage warning (gated) */}
            {isStorageLow && (
              <Box sx={{ p: 1 }}>
                <Alert severity="warning" sx={{ mb: 1 }}>
                  {t('storage.warning', {
                    percent: storagePercentFree != null ? storagePercentFree : '—',
                    used: formatBytes(storageUsedBytes),
                    quota: formatBytes(storageQuotaBytes)
                  })}
                  <Button size="small" variant="text" onClick={updateStorageEstimate} sx={{ ml: 2 }}>
                    {t('storage.recheck')}
                  </Button>
                </Alert>
              </Box>
            )}
            {/* Photo Configuration */}
            <Box sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ 
                display: 'flex', 
                gap: { xs: 1, sm: 2, md: 2.5 }, 
                alignItems: { xs: 'stretch', md: 'center' }, 
                justifyContent: 'center',
                flexWrap: { xs: 'wrap', lg: 'wrap', xl: 'nowrap' }
              }}>
                {/* Photo Mode */}
                <Box sx={{ display: 'flex', alignItems: { xs: 'center', xl: 'center' }, gap: 0.5, flexDirection: { xs: 'column', xl: 'row' } }}>
                  <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.8rem', display: 'block', textAlign: { xs: 'center', xl: 'inherit' }, width: { xs: '100%', xl: 'auto' }, whiteSpace: { xl: 'nowrap' } }}>
                    {t('mode.title')}
                  </Typography>
                  <ModeSelector 
                    currentMode={session?.mode || 'track'} 
                    onModeChange={updateSessionMode}
                    compact
                  />
                </Box>

                {/* Layout Mode (Portrait/Landscape) */}
                <Box data-tour="layout" sx={{ display: 'flex', alignItems: { xs: 'center', xl: 'center' }, gap: 0.5, flexDirection: { xs: 'column', xl: 'row' } }}>
                  <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.8rem', display: 'block', textAlign: { xs: 'center', xl: 'inherit' }, width: { xs: '100%', xl: 'auto' }, whiteSpace: { xl: 'nowrap' } }}>
                    {t('layout.title')}
                  </Typography>
                  <LayoutModeSelector
                    compact 
                    set1Count={session?.sets.set1.photos.length || 0}
                    set2Count={session?.sets.set2.photos.length || 0}
                    onModeChangeComplete={(newMode) => {
                      // Sync with session when layout mode changes
                      updateLayoutMode(newMode);
                    }}
                  />
                </Box>

                {/* Photo Format */}
                <Box sx={{ display: 'flex', alignItems: { xs: 'center', xl: 'center' }, gap: 0.5, flexDirection: { xs: 'column', xl: 'row' } }}>
                  <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.8rem', display: 'block', textAlign: { xs: 'center', xl: 'inherit' }, width: { xs: '100%', xl: 'auto' }, whiteSpace: { xl: 'nowrap' } }}>
                    {t('photoFormat.title')}
                  </Typography>
                  <AspectRatioSelector compact />
                </Box>

                {/* Photo Labels — hidden for precision: rules mandate
                    numbers, so there is no valid alternative to expose. */}
                {!isPrecision && (
                  <Box sx={{ display: 'flex', alignItems: { xs: 'center', xl: 'center' }, gap: 0.5, flexDirection: { xs: 'column', xl: 'row' } }}>
                    <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.8rem', display: 'block', textAlign: { xs: 'center', xl: 'inherit' }, width: { xs: '100%', xl: 'auto' }, whiteSpace: { xl: 'nowrap' } }}>
                      {t('photoLabels.title')}
                    </Typography>
                    <LabelingSelector compact />
                  </Box>
                )}

                {/* Actions cluster — Import + Shuffle. Import is always
                    visible (mirrors map-corridors' "Select KML" button)
                    so the user has a click-or-drop entry point regardless
                    of grid state (feedback M., 2026-05-15). Shuffle stays
                    track-only since it's mode-specific. */}
                <Box sx={{ display: 'flex', alignItems: { xs: 'center', xl: 'center' }, gap: 1, flexDirection: { xs: 'column', xl: 'row' } }}>
                  <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.8rem', display: 'block', textAlign: { xs: 'center', xl: 'inherit' }, width: { xs: '100%', xl: 'auto' } }}>
                    {t('actions.title')}
                  </Typography>
                  <ImportPhotosControl
                    onFilesPicked={(files) => {
                      void handleAddCandidates(files);
                    }}
                    disabled={!session || !addPhotosToCandidates}
                  />
                  {session?.mode === 'track' && (
                    <Button
                      onClick={handleShuffle}
                      disabled={
                        loading ||
                        !session ||
                        !supportsShuffle ||
                        (session.sets.set1.photos.length <= 1 && session.sets.set2.photos.length <= 1)
                      }
                      variant="outlined"
                      size="small"
                      startIcon={<Shuffle />}
                      sx={{
                        fontSize: '0.75rem',
                        px: 1.5,
                        py: 0.5,
                        minWidth: 'auto'
                      }}
                    >
                      {t('actions.shuffle.name')}
                    </Button>
                  )}
                </Box>
              </Box>
            </Box>

            {/* Competition Management — hidden in desktop mode (managed by launcher) */}
            {!isDesktopManaged && (
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.875rem', mb: 2 }}>
                  {t('competition.title')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Box sx={{ flex: '1 1 300px', minWidth: 250 }}>
                    <CompetitionSelector
                      competitions={competitions || []}
                      currentCompetitionId={currentCompetition?.id || null}
                      onCompetitionChange={switchToCompetition}
                      loading={loading}
                    />
                  </Box>
                  <Box sx={{ flex: '0 0 auto', display: 'flex', gap: 1 }}>
                    <CreateCompetitionButton
                      onCreateCompetition={createNewCompetition}
                      storageStats={storageStats}
                      competitionCount={competitions?.length || 0}
                      loading={loading}
                    />
                    {currentCompetition && (
                      <>
                        <Button
                          variant="outlined"
                          color="primary"
                          size="small"
                          onClick={handleRenameClick}
                          disabled={loading}
                          sx={{ minWidth: 'auto' }}
                        >
                          {t('competition.rename.button')}
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          onClick={() => handleDeleteCompetitionClick({
                            id: currentCompetition.id,
                            name: currentCompetition.name
                          })}
                          disabled={loading}
                          sx={{ minWidth: 'auto' }}
                        >
                          {t('common.delete')}
                        </Button>
                      </>
                    )}
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        </Paper>

        {/* Global Error Display */}
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 3 }}
            action={
              <IconButton color="inherit" size="small" onClick={clearError}>
                <Close fontSize="small" />
              </IconButton>
            }
          >
            {error}
          </Alert>
        )}

        {/* Photo-map-culling handoff unavailable — surfaces the previously
            silent dir-resolution failure (cross-app sync would otherwise
            quietly miss every pick made in map-corridors). */}
        {pmcSyncUnavailable && (
          <Alert severity="warning" sx={{ mb: 3 }}>
            {t('candidates.handoff.unavailable')}
          </Alert>
        )}

        {/* Candidate tray — slotless pool above the print layout. We render
            it whenever EITHER candidates exist OR slots have photos. The
            empty-state branch in CandidateTray itself shows a "drop more
            here" dropzone — the only entry point for adding files once all
            slots are full (otherwise the user gets stuck on a maxed-out
            grid with no dropzone, first dev test 2026-05-12). Stays hidden
            only on the truly-fresh empty state (no slots, no candidates)
            so the initial DropZone hero remains unobstructed. */}
        {(candidatePhotos.length > 0 || stats.totalPhotos > 0) && (
          <Box data-tour="tray">
          <CandidateTray
            photos={candidatePhotos}
            onAddFiles={(files) => { void handleAddCandidates(files); }}
            onPhotoClick={handleCandidateClick}
            onSetFlag={(photoId, flag) => { if (setCandidateFlag) void setCandidateFlag(photoId, flag); }}
            onDelete={(photoId) => { if (removeCandidate) void removeCandidate(photoId); }}
            onSendToSet={handleSendCandidateToSet}
            // Track mode only — in turning-point mode set1/set2 ARE the TP photos,
            // so the extra button would be redundant (CandidateTray hides it when
            // onSendToTP is undefined).
            onSendToTP={session?.mode === 'turningpoint' ? undefined : handleSendCandidateToTP}
            onSlotDroppedIn={handleSlotDroppedToTray}
            hideSet2={isPrecision && session?.mode === 'track'}
          />
          </Box>
        )}

        {/* Conditional Layout based on mode */}
        {session?.mode === 'turningpoint' ? (
          <TurningPointLayout
            set1={session.sets.set1}
            set2={session.sets.set2}
            loading={loading}
            error={error}
            onFilesDropped={(setKey, files) => handleAddToSet(files, setKey)}
            /* Initial Rally drop can span 10-18 photos — distribute across
               both sets instead of overflowing set1 invisibly. Precision stays
               capped at 9 so single-set flow still applies. */
            onInitialFilesDropped={isPrecision
              ? (files) => handleAddToSet(files, 'set1')
              : handleInitialTurningPointDrop}
            onPhotoClick={handlePhotoClick}
            onPhotoUpdate={handlePhotoUpdate}
            onPhotoRemove={handlePhotoRemove}
            onPhotoMove={handlePhotoMove}
            onCandidateDropped={(setKey, candidateId, slotIndex) =>
              handleCandidateDropped(setKey)(candidateId, slotIndex)
            }
            onAddPlaceholder={addPlaceholderToSet ? (setKey, slotIndex) => { void addPlaceholderToSet(setKey, slotIndex); } : undefined}
            totalPhotoCount={stats.set1Photos + stats.set2Photos}
            isPrecision={isPrecision}
          />
        ) : (
          /* Track Mode - Responsive Layout */
          (() => {
            // Determine if we should show side-by-side layout
            const shouldShowSideBySide = isLargeScreen && layoutMode === 'portrait';

            // Create reusable set components
            const Set1Component = (
              <Box sx={{ width: '100%' }}>
                {stats.set1Photos === 0 ? (
                  /* Empty Set 1 - Show Grid-Sized DropZone */
                  <Paper elevation={3} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'primary.light', height: '100%' }}>
                    <Box sx={{ p: 4, pb: 2 }}>
                      <Typography variant="h4" color="primary" sx={{ fontWeight: 600, mb: 4, textAlign: 'center' }}>
                        {t('sets.set1')}
                      </Typography>
                    </Box>
                    <GridSizedDropZone
                      onFilesDropped={(files) => handleAddToSet(files, 'set1')}
                      setName={t('sets.set1')}
                      // Precision track allows up to 10 regardless of current
                      // layoutMode — a fresh 10-photo drop will switch the
                      // layout via the effect above (feedback 2026-04-18).
                      maxPhotos={isPrecision && session?.mode === 'track' ? 10 : (layoutMode === 'portrait' ? 10 : 9)}
                      loading={loading}
                      error={error}
                      setKey="set1"
                      onCandidateDropped={(candidateId) => handleCandidateDropped('set1')(candidateId, 0)}
                      onCrossSetDropRejected={() => setCrossSetHintOpen(true)}
                    />
                  </Paper>
                ) : (
                  /* Set 1 has photos - Show normal grid */
                  session && (
                    <Paper elevation={3} sx={{ p: 4, borderRadius: 3, border: '1px solid', borderColor: 'primary.light' }}>
                      <Box sx={{ mb: 4 }}>
                        <EditableHeading
                          value={session.sets.set1.title}
                          defaultValue={t('sets.set1')}
                          onChange={handleSet1TitleUpdate}
                          variant="h4"
                          color="primary"
                        />
                      </Box>
                      <PhotoGridApi
                        photoSet={session.sets.set1}
                        setKey="set1"
                        onPhotoUpdate={(photoId, canvasState) =>
                          handlePhotoUpdate('set1', photoId, canvasState)
                        }
                        onPhotoRemove={(photoId) => handlePhotoRemove('set1', photoId)}
                        onPhotoClick={(photo) => handlePhotoClick(photo, 'set1')}
                        onPhotoMove={(fromIndex, toIndex) => handlePhotoMove('set1', fromIndex, toIndex)}
                        onFilesDropped={(files) => handleAddToSet(files, 'set1')}
                        onCandidateDropped={handleCandidateDropped('set1')}
                        onCrossSetDropRejected={() => setCrossSetHintOpen(true)}
                        maxPhotosOverride={isPrecision && session.mode === 'track' ? 10 : undefined}
                      />
                    </Paper>
                  )
                )}
              </Box>
            );

            const Set2Component = (
              <Box sx={{ width: '100%' }}>
                {stats.set2Photos === 0 ? (
                  /* Empty Set 2 - Show Grid-Sized DropZone */
                  <Paper elevation={3} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'primary.light', height: '100%' }}>
                    <Box sx={{ p: 4, pb: 2 }}>
                      <Typography variant="h4" color="primary" sx={{ fontWeight: 600, mb: 4, textAlign: 'center' }}>
                        {t('sets.set2')}
                      </Typography>
                    </Box>
                    <GridSizedDropZone
                      onFilesDropped={(files) => handleAddToSet(files, 'set2')}
                      setName={t('sets.set2')}
                      maxPhotos={layoutMode === 'portrait' ? 10 : 9}
                      loading={loading}
                      error={error}
                      setKey="set2"
                      onCandidateDropped={(candidateId) => handleCandidateDropped('set2')(candidateId, 0)}
                      onCrossSetDropRejected={() => setCrossSetHintOpen(true)}
                    />
                  </Paper>
                ) : (
                  /* Set 2 has photos - Show normal grid */
                  session && (
                    <Paper elevation={3} sx={{ p: 4, borderRadius: 3, border: '1px solid', borderColor: 'primary.light' }}>
                      <Box sx={{ mb: 4 }}>
                        <EditableHeading
                          value={session.sets.set2.title}
                          defaultValue={t('sets.set2')}
                          onChange={(title) => updateSetTitle('set2', title)}
                          variant="h4"
                          color="primary"
                        />
                      </Box>
                      <PhotoGridApi
                        photoSet={session.sets.set2}
                        setKey="set2"
                        labelOffset={session.sets.set1.photos.length} // Continue sequence from Set 1
                        onPhotoUpdate={(photoId, canvasState) =>
                          handlePhotoUpdate('set2', photoId, canvasState)
                        }
                        onPhotoRemove={(photoId) => handlePhotoRemove('set2', photoId)}
                        onPhotoClick={(photo) => handlePhotoClick(photo, 'set2')}
                        onPhotoMove={(fromIndex, toIndex) => handlePhotoMove('set2', fromIndex, toIndex)}
                        onFilesDropped={(files) => handleAddToSet(files, 'set2')}
                        onCandidateDropped={handleCandidateDropped('set2')}
                        onCrossSetDropRejected={() => setCrossSetHintOpen(true)}
                      />
                    </Paper>
                  )
                )}
              </Box>
            );

            // Precision track mode: single-set layout (no Set 2). The
            // "Add 10th photo" affordance was removed with the auto-flip
            // (first dev-test feedback 2026-05-12) — overflow now lands in
            // the candidate tray, and users flip to portrait themselves
            // when they want a 10-slot layout.
            if (isPrecision) {
              return (
                <Box sx={{ mb: 6 }}>
                  {Set1Component}
                </Box>
              );
            }

            // Render based on layout mode
            if (shouldShowSideBySide) {
              // Side-by-side layout for large screens in portrait mode
              return (
                <Box sx={{
                  display: 'flex',
                  gap: 2, // Reduced gap from 3 to 2
                  mb: 6,
                  alignItems: 'flex-start'
                }}>
                  {/* Set 1 - Left Side */}
                  <Box sx={{ flex: 1 }}>
                    {Set1Component}
                  </Box>

                  {/* Set 2 - Right Side */}
                  <Box sx={{ flex: 1 }}>
                    {Set2Component}
                  </Box>
                </Box>
              );
            } else {
              // Stacked layout for small screens or landscape mode
              return (
                <>
                  {/* Set 1 Section */}
                  <Box sx={{ mb: 6 }}>
                    {Set1Component}
                  </Box>

                  {/* Removed horizontal divider for cleaner look */}

                  {/* Set 2 Section */}
                  <Box sx={{ mb: 6 }}>
                    {Set2Component}
                  </Box>
                </>
              );
            }
          })()
        )}

        {/* Action Buttons - Centered and Prominent */}
        <Paper elevation={1} sx={{ p: 4, mb: 4, borderRadius: 3 }}>
          <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              color="error"
              startIcon={<RestartAlt />}
              onClick={() => { if (supportsReset && resetSession) resetSession(); }}
              size="large"
              sx={{
                py: 1.5,
                px: 4,
                fontSize: '1.1rem',
                minWidth: 160,
                borderWidth: 2,
                '&:hover': { borderWidth: 2 }
              }}
              disabled={!supportsReset}
            >
              {t('actions.resetSession')}
            </Button>
            <Button
              variant="contained"
              color="success"
              startIcon={<PictureAsPdf />}
              onClick={handleGeneratePDF}
              disabled={stats.totalPhotos === 0}
              size="large"
              data-tour="export"
              sx={{
                py: 1.5,
                px: 4,
                fontSize: '1.1rem',
                minWidth: 180,
                fontWeight: 600,
                boxShadow: stats.totalPhotos > 0 ? 4 : 1,
                '&:hover': { boxShadow: 6 }
              }}
            >
              {t('actions.generatePdf')}
            </Button>
          </Box>
        </Paper>

        {/* Welcome Instructions - present but hidden by default for cleaner UX */}
        <Box sx={{ display: SHOW_WELCOME_INSTRUCTIONS ? 'block' : 'none' }}>
          <Alert
            severity="info"
            sx={{
              p: 4,
              mb: 4,
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'info.light'
            }}
          >
            <Typography variant="h5" component="h3" sx={{ mb: 3, color: 'info.main', fontWeight: 600 }}>
              {t('session.instructions.title')}
            </Typography>
            <Typography variant="h6" sx={{ mb: 2, color: 'info.dark', fontWeight: 500 }}>
              {t('session.instructions.subtitle')}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 3, fontSize: '1.1rem', '& li': { mb: 1.5, color: 'info.dark' } }}>
              <li>{t('session.instructions.step1')}</li>
              <li>{t('session.instructions.step2')}</li>
              <li>{t('session.instructions.step3')}</li>
              <li>{t('session.instructions.step4')}</li>
            </Box>
            <Typography variant="body1" sx={{ mt: 2, color: 'info.dark', fontStyle: 'italic' }}>
              {t('session.instructions.tips')}
            </Typography>
          </Alert>
        </Box>
      </Container>

      {/* Footer */}
      <Box component="footer" sx={{ py: 2, mt: 4, bgcolor: 'background.default' }}>
        <Container maxWidth={false} sx={{ px: { xs: 2, sm: 3, md: 4, lg: 5 } }}>
          <Box sx={{ p: 2, borderRadius: 2, bgcolor: '#1565C0' }}>
            <Typography variant="body2" align="center" sx={{ color: 'common.white' }}>
              {t('footer.copy', { year: new Date().getFullYear(), name: 'Lukáš Běhounek' })} {' '}
              <Link href="https://behounek.it" target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit', textDecoration: 'underline' }}>
                {t('footer.cta')}
              </Link>
            </Typography>
          </Box>
        </Container>
      </Box>

      {/* Photo Editor Modal */}
      <Modal
        open={!!selectedPhoto}
        onClose={() => {
          setSelectedPhoto(null);
          // Immediately refresh session to sync grid with modal changes
          if (supportsRefresh && refreshSession) {
            refreshSession();
          }
        }}
        closeAfterTransition
        slots={{ backdrop: Backdrop }}
        slotProps={{
          backdrop: {
            timeout: 500,
            sx: { backgroundColor: 'rgba(0, 0, 0, 0.8)' }
          }
        }}
      >
        <Fade in={!!selectedPhoto}>
          <Box sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: { xs: '95vw', sm: '90vw', md: '90vw', lg: '85vw' },
            maxWidth: '1400px',
            maxHeight: '98vh', // Even taller modal - utilizing saved header space
            bgcolor: 'background.paper',
            borderRadius: 3,
            boxShadow: 24,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            {selectedPhoto && (
              <>


                {/* In-modal tour trigger — highlights the editor controls in place. */}
                <Tooltip title={t('tour.help.button')}>
                  <IconButton
                    size="small"
                    onClick={startEditorTour}
                    aria-label={t('tour.help.button')}
                    data-tour="editor-help"
                    sx={{ position: 'absolute', top: 8, right: 48, zIndex: 2, color: 'text.secondary' }}
                  >
                    <HelpOutline />
                  </IconButton>
                </Tooltip>
                {/* Modal Content - L-Shape Layout: Photo top-left, Controls wrapping around */}
                <Box data-tour="editor" sx={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  height: '90vh', // Much taller content - utilizing saved header space
                  maxHeight: '900px'
                }}>
                  {/* Top Row: Photo (left) + Right Controls */}
                  <Box sx={{
                    display: 'flex',
                    flex: '1 1 55%', // Reduced to 55% to give more space to bottom
                    overflow: 'hidden'
                  }}>
                    {/* Photo - Top Left */}
                    <Box data-tour="editor-photo" sx={{
                      flex: '1 1 65%', // Take 65% of width
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: 'grey.50',
                      px: 4, // Horizontal padding
                      py: 10 // Much more vertical padding above and below photo
                    }}>
                      <PhotoEditorApi
                        photo={selectedPhoto.photo}
                        label={selectedPhoto.label}
                        onUpdate={(canvasState) =>
                          handlePhotoUpdate(selectedPhoto.setKey, selectedPhoto.photo.id, canvasState)
                        }
                        onRemove={() => handlePhotoRemove(selectedPhoto.setKey, selectedPhoto.photo.id)}
                        size="large"
                        setKey={selectedPhoto.setKey}
                        showOriginal={showOriginal}
                        circleMode={circleMode}
                        mode={session?.mode}
                      />
                      {/* Filename caption under the photo — screen only. */}
                      {selectedPhoto.photo.filename && (
                        <Typography
                          variant="caption"
                          title={selectedPhoto.photo.filename}
                          sx={{
                            mt: 1.5,
                            fontFamily: 'monospace',
                            color: 'text.secondary',
                            userSelect: 'text',
                            '@media print': { display: 'none' },
                          }}
                        >
                          {selectedPhoto.photo.filename}
                        </Typography>
                      )}
                      {/* Prev/next navigation within the same set/pool. Mirrors
                          the ArrowLeft/ArrowRight keyboard shortcuts; hidden when
                          the set has a single photo. Clamps at both ends. */}
                      {modalPhotoList.length > 1 && (
                        <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                          <IconButton
                            size="small"
                            onClick={() => navigateModalPhoto(-1)}
                            disabled={!canPrev}
                            aria-label={t('modal.prevPhoto')}
                            title={t('modal.prevPhoto')}
                          >
                            <ChevronLeft />
                          </IconButton>
                          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 48, textAlign: 'center' }}>
                            {modalIndex + 1} / {modalPhotoList.length}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={() => navigateModalPhoto(1)}
                            disabled={!canNext}
                            aria-label={t('modal.nextPhoto')}
                            title={t('modal.nextPhoto')}
                          >
                            <ChevronRight />
                          </IconButton>
                        </Box>
                      )}
                    </Box>

                    {/* Right Controls */}
                    <Box sx={{
                      flex: '0 0 35%', // Take 35% of width
                      borderLeft: '1px solid',
                      borderColor: 'divider',
                      bgcolor: 'background.default',
                      overflow: 'auto'
                    }}>
                      <PhotoControls
                        photo={selectedPhoto.photo}
                        label={selectedPhoto.label}
                        onUpdate={(canvasState) =>
                          handlePhotoUpdate(selectedPhoto.setKey, selectedPhoto.photo.id, canvasState)
                        }
                        onRemove={() => {}} // No-op since delete button is removed
                        onClose={() => {
                          setSelectedPhoto(null);
                          // Immediately refresh session to sync grid with modal changes
                          if (supportsRefresh && refreshSession) {
                            refreshSession();
                          }
                        }}
                        mode="compact-right"
                        showOriginal={showOriginal}
                        onToggleOriginal={() => setShowOriginal(!showOriginal)}
                        circleMode={circleMode}
                        onCircleModeToggle={() => setCircleMode(!circleMode)}
                        onApplyToAll={supportsApplyToAll && applySettingToAll ? (setting, value) => applySettingToAll(setting, value) : undefined}
                        onSyncLabelPositionToAll={supportsApplyLabelPositionToAll && applyLabelPositionToAll ? (position) => applyLabelPositionToAll(position) : undefined}
                      />
                    </Box>
                  </Box>

                  {/* Bottom Row: Controls spanning full width - Taller */}
                  <Box sx={{
                    flex: '0 0 38%', // Reduced to move cards down and give more space to photo
                    borderTop: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    overflow: 'auto'
                  }}>
                    <PhotoControls
                      photo={selectedPhoto.photo}
                      label={selectedPhoto.label}
                      onUpdate={(canvasState) =>
                        handlePhotoUpdate(selectedPhoto.setKey, selectedPhoto.photo.id, canvasState)
                      }
                      onRemove={() => {}} // No-op since delete button is removed
                      onClose={() => {
                        setSelectedPhoto(null);
                        // Immediately refresh session to sync grid with modal changes
                        if (supportsRefresh && refreshSession) {
                          refreshSession();
                        }
                      }}
                      mode="sliders"
                      showOriginal={showOriginal}
                      onToggleOriginal={() => setShowOriginal(!showOriginal)}
                      onApplyToAll={supportsApplyToAll && applySettingToAll ? (setting, value) => applySettingToAll(setting, value) : undefined}
                    />
                  </Box>
                </Box>
              </>
            )}
          </Box>
        </Fade>
      </Modal>

      {/* Competition Cleanup Modal */}
      <CleanupModal
        open={cleanupCandidates?.length > 0}
        candidates={cleanupCandidates || []}
        onConfirm={performCleanup}
        onCancel={dismissCleanup}
        loading={loading}
      />

      {/* Delete Competition Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={handleDeleteCancel}
        aria-labelledby="delete-competition-title"
        aria-describedby="delete-competition-description"
      >
        <DialogTitle id="delete-competition-title" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Warning color="error" />
          {t('competition.delete.title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-competition-description">
            {competitionToDelete && t('competition.delete.message', { name: competitionToDelete.name })}
          </DialogContentText>
          <DialogContentText sx={{ mt: 2, fontWeight: 600, color: 'error.main' }}>
            {t('competition.delete.warning')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} variant="outlined">
            {t('common.cancel')}
          </Button>
          <Button 
            onClick={handleDeleteConfirm} 
            color="error" 
            variant="contained"
            disabled={loading}
          >
            {loading ? t('common.loading') : t('competition.delete.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rename Competition Dialog */}
      <Dialog
        open={renameDialogOpen}
        onClose={handleRenameCancel}
        aria-labelledby="rename-competition-title"
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle id="rename-competition-title">
          {t('competition.rename.title')}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label={t('competition.rename.label')}
            type="text"
            fullWidth
            variant="outlined"
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            placeholder={t('competition.rename.placeholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameText.trim()) {
                handleRenameConfirm();
              }
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRenameCancel}>
            {t('competition.rename.cancel')}
          </Button>
          <Button
            onClick={handleRenameConfirm}
            variant="contained"
            disabled={!renameText.trim() || loading}
          >
            {loading ? t('common.loading') : t('competition.rename.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Smart-drop notification — surfaces silent batches routed to the
          candidate tray so the user doesn't think their photos vanished. */}
      <Snackbar
        open={Boolean(dropToast)}
        autoHideDuration={6000}
        onClose={() => setDropToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={dropToast ? t('candidates.smartDropToast', { count: dropToast.count }) : ''}
      />

      {/* Re-import dedup notification — "Add photos" skipped files already in the
          session, so the user doesn't think their pick silently vanished. */}
      <Snackbar
        open={Boolean(dupToast)}
        autoHideDuration={6000}
        onClose={() => setDupToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={dupToast ? t('candidates.duplicatesSkipped', { count: dupToast.count }) : ''}
      />

      {/* PDF export failure — friendly, actionable surface that replaces the raw
          native alert. Stays up longer and is dismissible because the message
          tells the user how to recover (re-import / remove the affected cells). */}
      <Snackbar
        open={Boolean(pdfError)}
        autoHideDuration={14000}
        onClose={() => setPdfError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" variant="filled" onClose={() => setPdfError(null)} sx={{ maxWidth: 560 }}>
          {pdfError}
        </Alert>
      </Snackbar>

      {/* Hint when the user tries an unsupported cross-set slot drag (PR #62
          review I4). The two-step via the tray works; this just tells them. */}
      <Snackbar
        open={crossSetHintOpen}
        autoHideDuration={5000}
        onClose={() => setCrossSetHintOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={t('candidates.crossSetHint')}
      />

      {/* Cleanup-dialog failure surface (PR #62 review IMP-5). Replaces a
          blocking `alert()`; consistent with `dropToast`/`crossSetHint`
          snackbars elsewhere in this view. */}
      <Snackbar
        open={Boolean(cleanupErrorToast)}
        autoHideDuration={8000}
        onClose={() => setCleanupErrorToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={cleanupErrorToast ?? ''}
      />

      {/* Re-flow failure surface — a moved set1↔set2 break couldn't re-paginate
          some placed picks (OPFS quota / permission). Recoverable: it retries
          on the next sync. Same Snackbar vocabulary as the other toasts. */}
      <Snackbar
        open={Boolean(reflowErrorToast)}
        autoHideDuration={8000}
        onClose={() => setReflowErrorToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={reflowErrorToast ?? ''}
      />

      {/* Clipboard-paste failure surface — partial reads (some files rejected
          server-side for ext/size/symlinks), empty clipboards, IPC failures.
          Same Snackbar vocabulary as the other toasts so the user gets a
          consistent dismissible affordance. */}
      <Snackbar
        open={Boolean(pasteError)}
        autoHideDuration={8000}
        onClose={clearPasteError}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={pasteError ?? ''}
      />

      {/* Post-export candidate cleanup dialog */}
      <Dialog
        open={Boolean(cleanupCandidatesDialog)}
        onClose={handleCleanupCandidatesDecline}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('candidates.cleanup.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {cleanupCandidatesDialog && t('candidates.cleanup.message', {
              count: cleanupCandidatesDialog.count,
              size: cleanupCandidatesDialog.sizeMB,
            })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCleanupCandidatesDecline}>
            {t('candidates.cleanup.keep')}
          </Button>
          <Button
            onClick={handleCleanupCandidatesConfirm}
            color="error"
            variant="contained"
            disabled={loading}
          >
            {cleanupCandidatesDialog
              ? t('candidates.cleanup.delete', { count: cleanupCandidatesDialog.count })
              : t('candidates.cleanup.delete', { count: 0 })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default AppApi;
