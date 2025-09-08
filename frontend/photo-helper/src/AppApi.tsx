import { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Chip,
  Alert,
  Button,
  IconButton,
  Divider,
  Modal,
  Backdrop,
  Fade,
  CircularProgress,
  Card,
  CardContent,
  useMediaQuery,
  useTheme,
  Link
} from '@mui/material';
import {
  FlightTakeoff,
  RestartAlt,
  Close,
  CheckCircle,
  CloudOff,
  Refresh,
  PictureAsPdf,
  Shuffle
} from '@mui/icons-material';
import { usePhotoSessionApi } from './hooks/usePhotoSessionApi';
import { usePhotoSessionOPFS } from './hooks/usePhotoSessionOPFS';
import { DropZone } from './components/DropZone';
import { GridSizedDropZone } from './components/GridSizedDropZone';
import { PhotoGridApi } from './components/PhotoGridApi';
import { EditableHeading } from './components/EditableHeading';
import { PhotoEditorApi } from './components/PhotoEditorApi';
import { PhotoControls } from './components/PhotoControls';
import { AspectRatioSelector } from './components/AspectRatioSelector';
import { LabelingSelector } from './components/LabelingSelector';
import { ModeSelector } from './components/ModeSelector';
import { TurningPointLayout } from './components/TurningPointLayout';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { LayoutModeSelector } from './components/LayoutModeSelector';
import { useAspectRatio } from './contexts/AspectRatioContext';
import { useLabeling } from './contexts/LabelingContext';
import { useI18n } from './contexts/I18nContext';
import { useLayoutMode } from './contexts/LayoutModeContext';
import { generatePDF } from './utils/pdfGenerator';
import { generateTurningPointLabels } from './utils/imageProcessing';
import type { ApiPhoto, ApiPhotoSet } from './types/api';

// Configurable delay before showing loading text (in milliseconds)
const LOADING_TEXT_DELAY = 3000; // 3 seconds

const STORAGE_MODE = (import.meta as any).env?.VITE_STORAGE_MODE ?? 'opfs';
const useSessionHook = STORAGE_MODE === 'backend' ? usePhotoSessionApi : usePhotoSessionOPFS;

function AppApi() {
  const {
    session,
    sessionId,
    loading,
    error,
    backendAvailable,
    // storage
    isStorageLow,
    storagePercentFree,
    storageUsedBytes,
    storageQuotaBytes,
    updateStorageEstimate,
    addPhotosToSet,
    addPhotosToTurningPoint,
    removePhoto,
    updatePhotoState,
    updateSetTitle,
    updateSetTitles,
    reorderPhotos,
    shufflePhotos,
    updateSessionMode,
    updateLayoutMode,
    updateCompetitionName,
    resetSession,
    clearError,
    checkBackendHealth,
    refreshSession,
    getSessionStats
  } = useSessionHook() as any;
  
  const { currentRatio } = useAspectRatio();
  const { generateLabel } = useLabeling();
  const { t } = useI18n();
  const { setLayoutMode, layoutMode } = useLayoutMode();
  const theme = useTheme();
  const isLargeScreen = useMediaQuery(theme.breakpoints.up('lg')); // lg = 1200px by default
  
  // State to track if we should show loading text
  const [showLoadingText, setShowLoadingText] = useState(false);
  
  // Show loading text after delay
  useEffect(() => {
    if (backendAvailable === null) {
      const timer = setTimeout(() => {
        setShowLoadingText(true);
      }, LOADING_TEXT_DELAY);
      
      return () => clearTimeout(timer);
    } else {
      setShowLoadingText(false);
    }
  }, [backendAvailable]);

  const [selectedPhoto, setSelectedPhoto] = useState<{
    photo: ApiPhoto;
    setKey: 'set1' | 'set2';
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

  const handlePhotoClick = (photo: ApiPhoto, setKey: 'set1' | 'set2') => {
    const setPhotos = session?.sets[setKey].photos || [];
    const photoIndex = setPhotos.findIndex(p => p.id === photo.id);
    
    // Calculate label based on mode
    let label: string;
    if (session?.mode === 'turningpoint') {
      // Turning point mode: SP, TP1, TP2, ..., FP
      const set1Count = session.sets.set1.photos.length;
      const set2Count = session.sets.set2.photos.length;
      const totalPhotos = set1Count + set2Count;
      const turningPointLabels = generateTurningPointLabels(totalPhotos, session.layoutMode || 'landscape');
      
      if (setKey === 'set1') {
        label = turningPointLabels.set1[photoIndex] || 'X';
      } else {
        label = turningPointLabels.set2[photoIndex] || 'X';
      }
    } else {
      // Track mode: use labeling context (letters or numbers) with offset
      if (setKey === 'set1') {
        label = generateLabel(photoIndex);
      } else {
        const set1Count = session?.sets.set1?.photos?.length || 0;
        label = generateLabel(photoIndex, set1Count); // Continue sequence from Set 1
      }
    }

    setSelectedPhoto({ 
      photo, 
      setKey, 
      label
    });
  };

  const handlePhotoUpdate = (setKey: 'set1' | 'set2', photoId: string, canvasState: any) => {
    // Update the backend first
    updatePhotoState(setKey, photoId, canvasState);

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

  const handlePhotoRemove = (setKey: 'set1' | 'set2', photoId: string) => {
    removePhoto(setKey, photoId);

    // Close detailed editor if this photo was selected
    if (selectedPhoto?.photo.id === photoId) {
      setSelectedPhoto(null);
    }
  };

  const handlePhotoMove = (setKey: 'set1' | 'set2', fromIndex: number, toIndex: number) => {
    // Use the new reorderPhotos function from the hook
    reorderPhotos(setKey, fromIndex, toIndex);
  };

  const handleShuffle = async () => {
    if (!session) return;
    
    console.log('🎲 Shuffling photos in both sets...');
    
    // Shuffle both sets in a single state update (no flickering, both sets update!)
    await shufflePhotos('both');

    console.log('✨ Photo shuffle completed!');
  };

  // Auto-prefill logic for track mode set titles
  const handleSet1TitleUpdate = async (title: string) => {
    console.log('Set1 title updated to:', title);
    const match = title.match(/^SP\s*-\s*TP(\d+)$/i);
    if (match) {
      const tpNumber = match[1];
      const newSet2Title = `TP${tpNumber} - FP`;
      await updateSetTitles({ set1: title, set2: newSet2Title });
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
      let set1WithLabels, set2WithLabels;

      if (session.mode === 'turningpoint') {
        // Turning point mode: use SP, TP1, TP2, ..., FP labels
        const set1Count = session.sets.set1.photos.length;
        const set2Count = session.sets.set2.photos.length;
        const totalPhotos = set1Count + set2Count;
        const turningPointLabels = generateTurningPointLabels(totalPhotos, session.layoutMode || 'landscape');

        set1WithLabels = {
          ...session.sets.set1,
          photos: session.sets.set1.photos.map((photo, index) => ({
            ...photo,
            label: turningPointLabels.set1[index] || 'X'
          } as unknown as ApiPhoto & { label: string }))
        };

        set2WithLabels = {
          ...session.sets.set2,
          photos: session.sets.set2.photos.map((photo, index) => ({
            ...photo,
            label: turningPointLabels.set2[index] || 'X'
          } as unknown as ApiPhoto & { label: string }))
        };
      } else {
        // Track mode: use A, B, C, etc. labels
        set1WithLabels = {
          ...session.sets.set1,
          photos: session.sets.set1.photos.map((photo, index) => ({
            ...photo,
            label: generateLabel(index) // Use dynamic labeling (letters or numbers) with dot
          } as unknown as ApiPhoto & { label: string }))
        };

        const set1Count = session.sets.set1.photos.length;
        set2WithLabels = {
          ...session.sets.set2,
          photos: session.sets.set2.photos.map((photo, index) => ({
            ...photo,
            label: generateLabel(index, set1Count) // Continue from where Set 1 left off
          } as unknown as ApiPhoto & { label: string }))
        };
      }

      await generatePDF(set1WithLabels, set2WithLabels, sessionId, currentRatio.ratio, session.competition_name, session.layoutMode || 'landscape');
    } catch (error) {
      console.error('PDF generation failed:', error);
      // Could add user notification here
    }
  };

  // Helper: safely apply a setting to all photos with sane defaults
  const applySettingToAll = (setting: string, value: any) => {
    if (!session || !selectedPhoto) return;

    const defaultCanvasState = {
      position: { x: 0, y: 0 },
      scale: 1,
      brightness: 0,
      contrast: 1,
      sharpness: 0,
      whiteBalance: { temperature: 0, tint: 0, auto: false },
      labelPosition: 'bottom-left' as const
    };

    (['set1', 'set2'] as const).forEach(setKey => {
      session.sets[setKey].photos.forEach((photo: any) => {
        if (photo.id === selectedPhoto.photo.id) return; // Skip current photo

        const baseState = photo.canvasState ?? defaultCanvasState;
        const currentState: any = { ...defaultCanvasState, ...baseState };

        if (setting === 'scale') {
          currentState.scale = value;
        } else if (setting === 'brightness') {
          currentState.brightness = value;
        } else if (setting === 'contrast') {
          currentState.contrast = value;
        } else if (setting === 'sharpness') {
          currentState.sharpness = value;
        } else if (setting === 'whiteBalance.temperature') {
          const wb = { ...(currentState.whiteBalance ?? defaultCanvasState.whiteBalance), auto: false };
          wb.temperature = value;
          currentState.whiteBalance = wb;
        } else if (setting === 'whiteBalance.tint') {
          const wb = { ...(currentState.whiteBalance ?? defaultCanvasState.whiteBalance), auto: false };
          wb.tint = value;
          currentState.whiteBalance = wb;
        }

        updatePhotoState(setKey as 'set1' | 'set2', photo.id, currentState);
      });
    });
  };

  // OPFS/back-end availability check (loading state)
  if (backendAvailable === null) {
    return (
      <Box sx={{ 
        minHeight: '100vh', 
        bgcolor: 'background.default', 
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        {showLoadingText ? (
          // Show full loading message after delay
          <Container maxWidth="md">
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <CircularProgress size={60} sx={{ mb: 3 }} />
              <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
                {t('session.connecting')}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {t('session.checkConnection')}
              </Typography>
            </Paper>
          </Container>
        ) : (
          // Just show spinner initially
          <CircularProgress size={60} />
        )}
      </Box>
    );
  }

  // In OPFS mode, when not available, show non-blocking banner but continue
  const showOPFSWarning = STORAGE_MODE !== 'backend' && backendAvailable === false;

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
      <Container maxWidth={false} sx={{ pt: 4, px: { xs: 2, sm: 3, md: 4, lg: 5 }, maxWidth: { xl: '75%' }, mx: { xl: 'auto' } }}>
        {showOPFSWarning && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('opfs.warning')}
          </Alert>
        )}
        {/* Unified Header and Controls */}
        <Paper elevation={2} sx={{ mb: 3, borderRadius: 2, overflow: 'hidden' }}>
          {/* Blue Header Section */}
          <Box sx={{ 
            p: 2, 
            background: 'linear-gradient(135deg, #1976D2 0%, #42A5F5 100%)',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between' 
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <FlightTakeoff sx={{ fontSize: 32, color: 'white', mr: 1.5 }} />
              <Typography variant="h5" component="h1" sx={{ color: 'white', fontWeight: 600 }}>
                {t('app.title')}
              </Typography>
            </Box>
            <LanguageSwitcher compact />
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
                <Box sx={{ display: 'flex', alignItems: { xs: 'center', xl: 'center' }, gap: 0.5, flexDirection: { xs: 'column', xl: 'row' } }}>
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

                {/* Photo Labels */}
                <Box sx={{ display: 'flex', alignItems: { xs: 'center', xl: 'center' }, gap: 0.5, flexDirection: { xs: 'column', xl: 'row' } }}>
                  <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.8rem', display: 'block', textAlign: { xs: 'center', xl: 'inherit' }, width: { xs: '100%', xl: 'auto' }, whiteSpace: { xl: 'nowrap' } }}>
                    {t('photoLabels.title')}
                  </Typography>
                  <LabelingSelector compact />
                </Box>

                {/* Shuffle Photos - Only show in track mode */}
                {session?.mode === 'track' && (
                  <Box sx={{ display: 'flex', alignItems: { xs: 'center', xl: 'center' }, gap: 1, flexDirection: { xs: 'column', xl: 'row' } }}>
                    <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.8rem', display: 'block', textAlign: { xs: 'center', xl: 'inherit' }, width: { xs: '100%', xl: 'auto' } }}>
                      {t('actions.title')}
                    </Typography>
                    <Button
                      onClick={handleShuffle}
                      disabled={loading || !session || (session.sets.set1.photos.length <= 1 && session.sets.set2.photos.length <= 1)}
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
                  </Box>
                )}
              </Box>
            </Box>

            {/* Competition Name */}
            <Box sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                  {t('competition.title')}
                </Typography>
                <EditableHeading
                  value={session?.competition_name || ''}
                  defaultValue={t('competition.defaultName')}
                  onChange={updateCompetitionName}
                  variant="h6"
                  color="text.primary"
                  placeholder={t('competition.placeholder')}
                />
              </Box>
            </Box>
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

        {/* Conditional Layout based on mode */}
        {session?.mode === 'turningpoint' ? (
          <TurningPointLayout
            set1={session.sets.set1}
            set2={session.sets.set2}
            loading={loading}
            error={error}
            onFilesDropped={addPhotosToTurningPoint}
            onPhotoClick={handlePhotoClick}
            onPhotoUpdate={handlePhotoUpdate}
            onPhotoRemove={handlePhotoRemove}
            onPhotoMove={handlePhotoMove}
            totalPhotoCount={stats.set1Photos + stats.set2Photos}
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
                      onFilesDropped={(files) => addPhotosToSet(files, 'set1')}
                      setName={t('sets.set1')}
                      maxPhotos={layoutMode === 'portrait' ? 10 : 9}
                      loading={loading}
                      error={error}
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
                        onFilesDropped={(files) => addPhotosToSet(files, 'set1')}
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
                      onFilesDropped={(files) => addPhotosToSet(files, 'set2')}
                      setName={t('sets.set2')}
                      maxPhotos={layoutMode === 'portrait' ? 10 : 9}
                      loading={loading}
                      error={error}
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
                        onFilesDropped={(files) => addPhotosToSet(files, 'set2')}
                      />
                    </Paper>
                  )
                )}
              </Box>
            );

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
              onClick={resetSession}
              size="large"
              sx={{
                py: 1.5,
                px: 4,
                fontSize: '1.1rem',
                minWidth: 160,
                borderWidth: 2,
                '&:hover': { borderWidth: 2 }
              }}
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
        <Container maxWidth={false} sx={{ px: { xs: 2, sm: 3, md: 4, lg: 5 }, maxWidth: { xl: '75%' }, mx: { xl: 'auto' } }}>
          <Box sx={{ p: 2, borderRadius: 2, background: 'linear-gradient(135deg, #1976D2 0%, #42A5F5 100%)' }}>
            <Typography variant="body2" align="center" sx={{ color: 'common.white' }}>
              {t('footer.copy', { year: 2025, name: 'Lukáš Běhounek' })} {' '}
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
          refreshSession();
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


                {/* Modal Content - L-Shape Layout: Photo top-left, Controls wrapping around */}
                <Box sx={{ 
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
                    <Box sx={{
                      flex: '1 1 65%', // Take 65% of width
                      display: 'flex',
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
                      />
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
                          refreshSession();
                        }}
                        mode="compact-right"
                        showOriginal={showOriginal}
                        onToggleOriginal={() => setShowOriginal(!showOriginal)}
                        circleMode={circleMode}
                        onCircleModeToggle={() => setCircleMode(!circleMode)}
                        onApplyToAll={(setting, value) => applySettingToAll(setting, value)}
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
                        refreshSession();
                      }}
                      mode="sliders"
                      showOriginal={showOriginal}
                      onToggleOriginal={() => setShowOriginal(!showOriginal)}
                      onApplyToAll={(setting, value) => applySettingToAll(setting, value)}
                    />
                  </Box>
                </Box>
              </>
            )}
          </Box>
        </Fade>
      </Modal>
    </Box>
  );
}

export default AppApi;
