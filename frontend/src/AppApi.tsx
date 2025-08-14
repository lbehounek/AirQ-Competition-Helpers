import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Grid,
  Chip,
  Alert,
  Button,
  IconButton,
  Divider,
  Modal,
  Backdrop,
  Fade
} from '@mui/material';
import {
  FlightTakeoff,
  PhotoCamera,
  FileDownload,
  RestartAlt,
  Close,
  CheckCircle,
  CloudOff,
  Refresh
} from '@mui/icons-material';
import { usePhotoSessionApi } from './hooks/usePhotoSessionApi';
import { DropZone } from './components/DropZone';
import { PhotoGridApi } from './components/PhotoGridApi';
import { TitleInput } from './components/TitleInput';
import { PhotoEditorApi } from './components/PhotoEditorApi';
import { PhotoControls } from './components/PhotoControls';

interface ApiPhoto {
  id: string;
  url: string;
  filename: string;
  canvasState: {
    position: { x: number; y: number };
    scale: number;
    brightness: number;
    contrast: number;
    labelPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };
  label: string;
}

function AppApi() {
  const {
    session,
    sessionId,
    loading,
    error,
    backendAvailable,
    addPhotosToSet,
    removePhoto,
    updatePhotoState,
    updateSetTitle,
    resetSession,
    clearError,
    checkBackendHealth,
    refreshSession,
    getSessionStats
  } = usePhotoSessionApi();

  const [selectedPhoto, setSelectedPhoto] = useState<{
    photo: ApiPhoto;
    setKey: 'set1' | 'set2';
    label: string;
  } | null>(null);

  const stats = getSessionStats();

  const handlePhotoClick = (photo: ApiPhoto, setKey: 'set1' | 'set2') => {
    const setPhotos = session?.sets[setKey].photos || [];
    const photoIndex = setPhotos.findIndex(p => p.id === photo.id);
    const label = String.fromCharCode(65 + photoIndex); // A, B, C, etc.

    setSelectedPhoto({ photo, setKey, label });
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

  // Backend not available
  if (!backendAvailable) {
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
              Navigation Flight Photo Organizer
            </Typography>
          </Box>
          <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.9)', mb: 2 }}>
            Organize your navigation flight photos into standardized PDF layouts
          </Typography>
          
          {/* Session Info */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <Chip
              label={`Session: ${sessionId.substring(0, 8)}...`}
              color="secondary"
              variant="filled"
              size="small"
            />
            <Chip
              label="🟢 Backend Connected"
              color="success"
              variant="filled"
              size="small"
            />
          </Box>

          {/* Session Stats */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Chip
              icon={<PhotoCamera />}
              label={`Total Photos: ${stats.totalPhotos}/18`}
              color="secondary"
              variant="filled"
            />
            <Chip
              label={`Set 1: ${stats.set1Photos}/9`}
              color={stats.set1Photos === 9 ? 'success' : 'default'}
              variant="outlined"
              sx={{ bgcolor: 'rgba(255, 255, 255, 0.9)' }}
            />
            <Chip
              label={`Set 2: ${stats.set2Photos}/9`}
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

        {/* Set 1 Section */}
        <Box sx={{ mb: 6 }}>
          {/* Set 1 Upload Area - Wide and Compact */}
          <Paper elevation={1} sx={{ p: 2.5, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <PhotoCamera color="primary" sx={{ fontSize: 28 }} />
              <TitleInput
                value={session.sets.set1.title}
                onChange={(title) => updateSetTitle('set1', title)}
                setName="Set 1"
                placeholder="Enter title for Set 1..."
              />
              <Chip
                label={`${stats.set1Photos}/9`}
                color={stats.set1Photos === 9 ? 'success' : 'primary'}
                variant={stats.set1Photos > 0 ? 'filled' : 'outlined'}
                size="medium"
              />
            </Box>
            <DropZone
              onFilesDropped={(files) => addPhotosToSet(files, 'set1')}
              setName="Set 1"
              currentPhotoCount={stats.set1Photos}
              maxPhotos={9}
              loading={loading}
              error={error}
            />
          </Paper>

          {/* Set 1 Photo Grid - Dominating Element */}
          {stats.set1Photos > 0 && session && (
            <Paper elevation={3} sx={{ p: 4, borderRadius: 3, border: '1px solid', borderColor: 'primary.light' }}>
              <Box sx={{ mb: 3 }}>
                <Typography variant="h5" color="primary" sx={{ fontWeight: 600 }}>
                  {session.sets.set1.title || 'Set 1'} Preview
                </Typography>
              </Box>
              <PhotoGridApi
                photoSet={session.sets.set1}
                setKey="set1"
                onPhotoUpdate={(photoId, canvasState) =>
                  handlePhotoUpdate('set1', photoId, canvasState)
                }
                onPhotoRemove={(photoId) => handlePhotoRemove('set1', photoId)}
                onPhotoClick={(photo) => handlePhotoClick(photo, 'set1')}
              />
            </Paper>
          )}
        </Box>

        {/* Horizontal Divider */}
        <Divider sx={{ my: 6, borderWidth: 2, '&::before, &::after': { borderWidth: '2px' } }}>
          <Chip
            label="Set 2"
            size="large"
            color="primary"
            variant="filled"
            sx={{ px: 3, py: 1, fontSize: '1rem', fontWeight: 600 }}
          />
        </Divider>

        {/* Set 2 Section */}
        <Box sx={{ mb: 6 }}>
          {/* Set 2 Upload Area - Wide and Compact */}
          <Paper elevation={1} sx={{ p: 2.5, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <PhotoCamera color="primary" sx={{ fontSize: 28 }} />
              <TitleInput
                value={session.sets.set2.title}
                onChange={(title) => updateSetTitle('set2', title)}
                setName="Set 2"
                placeholder="Enter title for Set 2..."
              />
              <Chip
                label={`${stats.set2Photos}/9`}
                color={stats.set2Photos === 9 ? 'success' : 'primary'}
                variant={stats.set2Photos > 0 ? 'filled' : 'outlined'}
                size="medium"
              />
            </Box>
            <DropZone
              onFilesDropped={(files) => addPhotosToSet(files, 'set2')}
              setName="Set 2"
              currentPhotoCount={stats.set2Photos}
              maxPhotos={9}
              loading={loading}
              error={error}
            />
          </Paper>

          {/* Set 2 Photo Grid - Dominating Element */}
          {stats.set2Photos > 0 && session && (
            <Paper elevation={3} sx={{ p: 4, borderRadius: 3, border: '1px solid', borderColor: 'primary.light' }}>
              <Box sx={{ mb: 3 }}>
                <Typography variant="h5" color="primary" sx={{ fontWeight: 600 }}>
                  {session.sets.set2.title || 'Set 2'} Preview
                </Typography>
              </Box>
              <PhotoGridApi
                photoSet={session.sets.set2}
                setKey="set2"
                onPhotoUpdate={(photoId, canvasState) =>
                  handlePhotoUpdate('set2', photoId, canvasState)
                }
                onPhotoRemove={(photoId) => handlePhotoRemove('set2', photoId)}
                onPhotoClick={(photo) => handlePhotoClick(photo, 'set2')}
              />
            </Paper>
          )}
        </Box>

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
              Reset All
            </Button>
            <Button
              variant="contained"
              color="success"
              startIcon={<FileDownload />}
              disabled={!stats.isComplete}
              size="large"
              sx={{
                py: 1.5,
                px: 4,
                fontSize: '1.1rem',
                minWidth: 180,
                fontWeight: 600,
                boxShadow: stats.isComplete ? 4 : 1,
                '&:hover': { boxShadow: 6 }
              }}
            >
              Export PDF
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
              Welcome to AirQ Photo Organizer (Backend Mode)
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 3, fontSize: '1.1rem', '& li': { mb: 1.5, color: 'info.dark' } }}>
              <li>Upload up to 9 photos for each set using the upload areas above</li>
              <li>Photos are stored on the backend server in local filesystem</li>
              <li>Click on any photo in the preview grids to edit it</li>
              <li>Drag photos to reposition, use zoom and brightness controls</li>
              <li>Labels A-I will be added automatically</li>
              <li>Export to PDF when both sets are complete</li>
            </Box>
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
            width: { xs: '95vw', sm: '90vw', md: '85vw', lg: '80vw' },
            maxWidth: '1200px',
            maxHeight: '90vh',
            bgcolor: 'background.paper',
            borderRadius: 3,
            boxShadow: 24,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            {selectedPhoto && (
              <>
                {/* Modal Header */}
                <Box sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  p: 3,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  background: 'linear-gradient(135deg, #1976D2 0%, #42A5F5 100%)'
                }}>
                  <Typography variant="h4" sx={{ color: 'white', fontWeight: 600 }}>
                    Edit Photo {selectedPhoto.label}
                  </Typography>
                  <IconButton
                    onClick={() => setSelectedPhoto(null)}
                    sx={{
                      color: 'white',
                      bgcolor: 'rgba(255, 255, 255, 0.2)',
                      '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.3)' }
                    }}
                    size="large"
                  >
                    <Close />
                  </IconButton>
                </Box>

                {/* Modal Content */}
                <Box sx={{
                  display: 'flex',
                  flexDirection: { xs: 'column', lg: 'row' },
                  flex: 1,
                  overflow: 'hidden'
                }}>
                  {/* Photo Preview - Larger Left Side */}
                  <Box sx={{
                    flex: { xs: '1 1 auto', lg: '2 1 auto' }, // More space on desktop
                    p: { xs: 2, lg: 4 },
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: { xs: '400px', lg: '600px' }, // Bigger minimum height
                    bgcolor: 'grey.50'
                  }}>
                    <PhotoEditorApi
                      photo={selectedPhoto.photo}
                      label={selectedPhoto.label}
                      onUpdate={(canvasState) =>
                        handlePhotoUpdate(selectedPhoto.setKey, selectedPhoto.photo.id, canvasState)
                      }
                      onRemove={() => handlePhotoRemove(selectedPhoto.setKey, selectedPhoto.photo.id)}
                      size="large"
                    />
                  </Box>

                  {/* Photo Controls - Smaller Right Side */}
                  <Box sx={{
                    flex: { xs: '1 1 auto', lg: '0 0 320px' }, // Fixed smaller width on desktop
                    borderLeft: { xs: 'none', lg: '1px solid' },
                    borderTop: { xs: '1px solid', lg: 'none' },
                    borderColor: 'divider',
                    bgcolor: 'background.default',
                    overflow: 'auto',
                    maxHeight: { xs: '250px', lg: 'none' } // Less height on mobile
                  }}>
                    <PhotoControls
                      photo={selectedPhoto.photo as any} // Type compatibility
                      label={selectedPhoto.label}
                      onUpdate={(canvasState) =>
                        handlePhotoUpdate(selectedPhoto.setKey, selectedPhoto.photo.id, canvasState)
                      }
                      onRemove={() => {
                        handlePhotoRemove(selectedPhoto.setKey, selectedPhoto.photo.id);
                        setSelectedPhoto(null); // Close modal when photo is removed
                      }}
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
