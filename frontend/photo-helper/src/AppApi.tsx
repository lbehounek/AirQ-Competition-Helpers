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
  CardContent
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
import { DropZone } from './components/DropZone';
import { PhotoGridApi } from './components/PhotoGridApi';
import { EditableHeading } from './components/EditableHeading';
import { PhotoEditorApi } from './components/PhotoEditorApi';
import { PhotoControls } from './components/PhotoControls';
import { AspectRatioSelector } from './components/AspectRatioSelector';
import { LabelingSelector } from './components/LabelingSelector';
import { ModeSelector } from './components/ModeSelector';
import { TurningPointLayout } from './components/TurningPointLayout';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { useAspectRatio } from './contexts/AspectRatioContext';
import { useLabeling } from './contexts/LabelingContext';
import { useI18n } from './contexts/I18nContext';
import { generatePDF } from './utils/pdfGenerator';
import { generateTurningPointLabels } from './utils/imageProcessing';

interface ApiPhoto {
  id: string;
  url: string;
  filename: string;
  canvasState: {
    position: { x: number; y: number };
    scale: number;
    brightness: number;
    contrast: number;
    sharpness: number;
    whiteBalance: {
      temperature: number;
      tint: number;
      auto: boolean;
    };
    labelPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };
  label: string;
}

// Configurable delay before showing loading text (in milliseconds)
const LOADING_TEXT_DELAY = 3000; // 3 seconds

function AppApi() {
  const {
    session,
    sessionId,
    loading,
    error,
    backendAvailable,
    addPhotosToSet,
    addPhotosToTurningPoint,
    removePhoto,
    updatePhotoState,
    updateSetTitle,
    reorderPhotos,
    updateSessionMode,
    updateCompetitionName,
    resetSession,
    clearError,
    checkBackendHealth,
    refreshSession,
    getSessionStats
  } = usePhotoSessionApi();
  
  const { currentRatio } = useAspectRatio();
  const { generateLabel } = useLabeling();
  const { t } = useI18n();
  
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
    isFirstInSet: boolean;
    setName: string;
  } | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [circleMode, setCircleMode] = useState(false);

  const stats = getSessionStats();

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
      const turningPointLabels = generateTurningPointLabels(totalPhotos);
      
      if (setKey === 'set1') {
        label = turningPointLabels.set1[photoIndex] || 'X';
      } else {
        label = turningPointLabels.set2[photoIndex] || 'X';
      }
    } else {
      // Track mode: A, B, C, etc.
      if (setKey === 'set1') {
        label = String.fromCharCode(65 + photoIndex); // A, B, C, etc.
      } else {
        const set1Count = session?.sets.set1.photos.length || 0;
        label = String.fromCharCode(65 + set1Count + photoIndex); // Continue from set1
      }
    }

    setSelectedPhoto({ 
      photo, 
      setKey, 
      label, 
      isFirstInSet: photoIndex === 0,
      setName: session?.sets[setKey].title || (setKey === 'set1' ? 'Set 1' : 'Set 2')
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
    
    // Shuffle function using Fisher-Yates algorithm
    const shuffleArray = (array: any[]) => {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    console.log('🎲 Shuffling photos in both sets...');
    
    // Shuffle Set 1 if it has photos
    if (session.sets.set1.photos.length > 1) {
      const set1Photos = [...session.sets.set1.photos];
      const shuffled1 = shuffleArray(set1Photos);
      
      // Apply the new order by moving each photo to its shuffled position
      for (let i = 0; i < shuffled1.length; i++) {
        const currentPhoto = shuffled1[i];
        const currentIndex = set1Photos.findIndex((p: any) => p.id === currentPhoto.id);
        if (currentIndex !== i) {
          await reorderPhotos('set1', currentIndex, i);
          // Update the array to reflect the move for next iteration
          [set1Photos[currentIndex], set1Photos[i]] = [set1Photos[i], set1Photos[currentIndex]];
        }
      }
    }

    // Small delay between sets for better UX
    await new Promise(resolve => setTimeout(resolve, 100));

    // Shuffle Set 2 if it has photos  
    if (session.sets.set2.photos.length > 1) {
      const set2Photos = [...session.sets.set2.photos];
      const shuffled2 = shuffleArray(set2Photos);
      
      // Apply the new order by moving each photo to its shuffled position
      for (let i = 0; i < shuffled2.length; i++) {
        const currentPhoto = shuffled2[i];
        const currentIndex = set2Photos.findIndex((p: any) => p.id === currentPhoto.id);
        if (currentIndex !== i) {
          await reorderPhotos('set2', currentIndex, i);
          // Update the array to reflect the move for next iteration
          [set2Photos[currentIndex], set2Photos[i]] = [set2Photos[i], set2Photos[currentIndex]];
        }
      }
    }

    console.log('✨ Photo shuffle completed!');
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
        const turningPointLabels = generateTurningPointLabels(totalPhotos);

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

      await generatePDF(set1WithLabels, set2WithLabels, sessionId, currentRatio.ratio, session.competition_name);
    } catch (error) {
      console.error('PDF generation failed:', error);
      // Could add user notification here
    }
  };

  // Backend checking (loading state)
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

  // Backend not available
  if (backendAvailable === false) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 4 }}>
        <Container maxWidth="md" sx={{ pt: 8 }}>
          <Alert 
            severity="error" 
            sx={{ 
              p: 4, 
              textAlign: 'center',
              fontSize: '1.1rem'
            }}
            icon={<CloudOff sx={{ fontSize: 40 }} />}
          >
            <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
              Backend Server Not Running
            </Typography>
            <Typography variant="body1" sx={{ mb: 3 }}>
              The backend server needs to be running for the application to work.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', bgcolor: 'grey.100', p: 2, borderRadius: 1 }}>
                cd backend<br />
                pip install -r requirements.txt<br />
                python run.py
              </Typography>
              <Button
                variant="contained"
                startIcon={<Refresh />}
                onClick={checkBackendHealth}
                size="large"
              >
                Check Again
              </Button>
            </Box>
          </Alert>
        </Container>
      </Box>
    );
  }

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
      <Container maxWidth="xl" sx={{ pt: 4 }}>
        {/* Header */}
        <Paper elevation={2} sx={{ p: 4, mb: 4, textAlign: 'center', background: 'linear-gradient(135deg, #1976D2 0%, #42A5F5 100%)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2 }}>
            <FlightTakeoff sx={{ fontSize: 40, color: 'white', mr: 2 }} />
            <Typography variant="h3" component="h1" sx={{ color: 'white', fontWeight: 600 }}>
              {t('app.title')}
            </Typography>
          </Box>
          <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.9)', mb: 2 }}>
            {t('app.subtitle')}
          </Typography>
          
          {/* Language Switcher */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.8)', mb: 1.5 }}>
              Language / Jazyk
            </Typography>
            <LanguageSwitcher />
          </Box>
          
          {/* Session Info */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <Chip
              label={t('session.sessionId', { id: sessionId.substring(0, 8) + '...' })}
              color="secondary"
              variant="filled"
              size="small"
            />
            <Chip
              label={`🟢 ${t('session.backendConnected')}`}
              color="success"
              variant="filled"
              size="small"
            />
          </Box>

          {/* Session Stats */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Chip
              label={t('session.totalPhotos', { count: `${stats.totalPhotos}/18` })}
              color="secondary"
              variant="filled"
            />
            <Chip
              label={t('session.setPhotos', { setName: t('sets.set1'), current: stats.set1Photos, max: 9 })}
              color={stats.set1Photos === 9 ? 'success' : 'default'}
              variant="outlined"
              sx={{ bgcolor: 'rgba(255, 255, 255, 0.9)' }}
            />
            <Chip
              label={t('session.setPhotos', { setName: t('sets.set2'), current: stats.set2Photos, max: 9 })}
              color={stats.set2Photos === 9 ? 'success' : 'default'}
              variant="outlined"
              sx={{ bgcolor: 'rgba(255, 255, 255, 0.9)' }}
            />
            {stats.isComplete && (
              <Chip
                icon={<CheckCircle />}
                label="Complete"
                color="success"
                variant="filled"
              />
            )}
          </Box>
        </Paper>

        {/* Photo Configuration */}
        <Paper elevation={1} sx={{ p: 1.5, mb: 2, borderRadius: 2 }}>
          <Box sx={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            {/* Photo Mode */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                {t('mode.title')}
              </Typography>
              <ModeSelector 
                currentMode={session?.mode || 'track'} 
                onModeChange={updateSessionMode}
              />
            </Box>

            {/* Photo Format */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                {t('photoFormat.title')}
              </Typography>
              <AspectRatioSelector />
            </Box>

            {/* Photo Labels */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                {t('photoLabels.title')}
              </Typography>
              <LabelingSelector />
            </Box>

            {/* Shuffle Photos - Only show in track mode */}
            {session?.mode === 'track' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500, fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                  {t('actions.title')}
                </Typography>
              <Card
                onClick={handleShuffle}
                sx={{
                  minWidth: 120,
                  maxWidth: 140,
                  height: 70,
                  cursor: loading || !session || (session.sets.set1.photos.length <= 1 && session.sets.set2.photos.length <= 1) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease-in-out',
                  border: 2,
                  borderColor: 'grey.300',
                  backgroundColor: 'background.paper',
                  opacity: loading || !session || (session.sets.set1.photos.length <= 1 && session.sets.set2.photos.length <= 1) ? 0.5 : 1,
                  transform: 'scale(1)',
                  boxShadow: 1,
                  '&:hover': !loading && session && (session.sets.set1.photos.length > 1 || session.sets.set2.photos.length > 1) ? {
                    borderColor: 'primary.light',
                    backgroundColor: 'primary.25',
                    transform: 'scale(1.02)',
                    boxShadow: 3
                  } : {}
                }}
              >
                <CardContent sx={{ textAlign: 'center', py: 1, px: 1 }}>
                  <Box sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    mb: 0.25,
                    color: 'text.secondary'
                  }}>
                    <Shuffle />
                  </Box>
                  
                  <Typography 
                    variant="subtitle2" 
                    component="div" 
                    sx={{ 
                      fontWeight: 600,
                      color: 'text.primary',
                      mb: 0.1,
                      fontSize: '0.875rem'
                    }}
                  >
                    {t('actions.shuffle.name')}
                  </Typography>
                  
                  <Typography 
                    variant="caption" 
                    color="text.secondary"
                    sx={{ fontSize: '0.7rem', lineHeight: 1.2 }}
                  >
                    {t('actions.shuffle.description')}
                  </Typography>
                </CardContent>
              </Card>
              </Box>
            )}
          </Box>
        </Paper>

        {/* Competition Name Input */}
        <Paper elevation={1} sx={{ p: 2, mb: 3, borderRadius: 2 }}>
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
          <>
            {/* Set 1 Section */}
            <Box sx={{ mb: 6 }}>
          {/* Set 1 Upload Area - Simple */}
          <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
            <DropZone
              onFilesDropped={(files) => addPhotosToSet(files, 'set1')}
              setName={t('sets.set1')}
              currentPhotoCount={stats.set1Photos}
              maxPhotos={9}
              loading={loading}
              error={error}
            />
          </Paper>

          {/* Set 1 Photo Grid - Dominating Element */}
          {stats.set1Photos > 0 && session && (
            <Paper elevation={3} sx={{ p: 4, borderRadius: 3, border: '1px solid', borderColor: 'primary.light' }}>
              <Box sx={{ mb: 4 }}>
                <EditableHeading
                  value={session.sets.set1.title}
                  defaultValue={t('sets.set1')}
                  onChange={(title) => updateSetTitle('set1', title)}
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
          )}
        </Box>

        {/* Horizontal Divider */}
        <Divider sx={{ my: 6, borderWidth: 2, '&::before, &::after': { borderWidth: '2px' } }}>
          <Chip
            label={t('sets.set2')}
            size="medium"
            color="primary"
            variant="filled"
            sx={{ px: 3, py: 1, fontSize: '1rem', fontWeight: 600 }}
          />
        </Divider>

        {/* Set 2 Section */}
        <Box sx={{ mb: 6 }}>
          {/* Set 2 Upload Area - Simple */}
          <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
            <DropZone
              onFilesDropped={(files) => addPhotosToSet(files, 'set2')}
              setName={t('sets.set2')}
              currentPhotoCount={stats.set2Photos}
              maxPhotos={9}
              loading={loading}
              error={error}
            />
          </Paper>

          {/* Set 2 Photo Grid - Dominating Element */}
          {stats.set2Photos > 0 && session && (
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
          )}
        </Box>
          </>
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

        {/* Welcome Instructions - Only shown when no photos */}
        {stats.totalPhotos === 0 && (
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
        )}
      </Container>

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
            maxHeight: '95vh', // Taller modal to accommodate all elements
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
                  height: '85vh', // Taller modal content
                  maxHeight: '800px'
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
                        setName={selectedPhoto.setName}
                        isFirstInSet={selectedPhoto.isFirstInSet}
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
                      />
                    </Box>
                  </Box>

                  {/* Bottom Row: Controls spanning full width - Taller */}
                  <Box sx={{
                    flex: '0 0 45%', // Increased to 45% to fit 3 equal tiles comfortably
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
