import React, { useState } from 'react';
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
  Divider
} from '@mui/material';
import {
  FlightTakeoff,
  PhotoCamera,
  FileDownload,
  RestartAlt,
  Close,
  CheckCircle
} from '@mui/icons-material';
import { usePhotoSession } from './hooks/usePhotoSession';
import { DropZone } from './components/DropZone';
import { PhotoGrid } from './components/PhotoGrid';
import { TitleInput } from './components/TitleInput';
import { PhotoEditor } from './components/PhotoEditor';
import type { Photo } from './types';

function App() {
  const {
    session,
    loading,
    error,
    addPhotosToSet,
    removePhoto,
    updatePhotoState,
    updateSetTitle,
    resetSession,
    clearError,
    getSessionStats
  } = usePhotoSession();

  const [selectedPhoto, setSelectedPhoto] = useState<{
    photo: Photo;
    setKey: 'set1' | 'set2';
    label: string;
  } | null>(null);

  const stats = getSessionStats();

  const handlePhotoClick = (photo: Photo, setKey: 'set1' | 'set2') => {
    const setPhotos = session.sets[setKey].photos;
    const photoIndex = setPhotos.findIndex(p => p.id === photo.id);
    const label = String.fromCharCode(65 + photoIndex); // A, B, C, etc.
    
    setSelectedPhoto({ photo, setKey, label });
  };

  const handlePhotoUpdate = (setKey: 'set1' | 'set2', photoId: string, canvasState: any) => {
    updatePhotoState(setKey, photoId, canvasState);
    
    // Update selected photo if it's the one being edited
    if (selectedPhoto?.photo.id === photoId) {
      const updatedPhoto = session.sets[setKey].photos.find(p => p.id === photoId);
      if (updatedPhoto) {
        setSelectedPhoto({
          ...selectedPhoto,
          photo: updatedPhoto
        });
      }
    }
  };

  const handlePhotoRemove = (setKey: 'set1' | 'set2', photoId: string) => {
    removePhoto(setKey, photoId);
    
    // Close detailed editor if this photo was selected
    if (selectedPhoto?.photo.id === photoId) {
      setSelectedPhoto(null);
    }
  };

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
          <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.9)', mb: 3 }}>
            Organize your navigation flight photos into standardized PDF layouts
          </Typography>
          
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

        <Grid container spacing={3}>
          {/* Left Column - Upload and Management */}
          <Grid item xs={12} lg={6}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Set 1 Upload */}
              <Paper elevation={1} sx={{ p: 3 }}>
              <TitleInput
                value={session.sets.set1.title}
                onChange={(title) => updateSetTitle('set1', title)}
                setName="Set 1"
                placeholder="Enter title for Set 1..."
              />
              
              <DropZone
                onFilesDropped={(files) => addPhotosToSet(files, 'set1')}
                setName="Set 1"
                currentPhotoCount={stats.set1Photos}
                maxPhotos={9}
                loading={loading}
                error={error}
              />
              </Paper>

              {/* Divider */}
              <Divider sx={{ my: 2 }}>
                <Chip label="Set Separator" size="small" />
              </Divider>

              {/* Set 2 Upload */}
              <Paper elevation={1} sx={{ p: 3 }}>
              <TitleInput
                value={session.sets.set2.title}
                onChange={(title) => updateSetTitle('set2', title)}
                setName="Set 2"
                placeholder="Enter title for Set 2..."
              />
              
              <DropZone
                onFilesDropped={(files) => addPhotosToSet(files, 'set2')}
                setName="Set 2"
                currentPhotoCount={stats.set2Photos}
                maxPhotos={9}
                loading={loading}
                error={error}
              />
              </Paper>

              {/* Action Buttons */}
              <Paper elevation={1} sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<RestartAlt />}
                    onClick={resetSession}
                    fullWidth
                    sx={{ py: 1.5 }}
                  >
                    Reset All
                  </Button>
                  <Button
                    variant="contained"
                    color="success"
                    startIcon={<FileDownload />}
                    disabled={!stats.isComplete}
                    fullWidth
                    sx={{ py: 1.5 }}
                  >
                    Export PDF
                  </Button>
                </Box>
              </Paper>
            </Box>
          </Grid>

          {/* Right Column - Preview and Editing */}
          <Grid item xs={12} lg={6}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Photo Grids */}
            {(stats.set1Photos > 0 || stats.set2Photos > 0) && (
              <>
                {stats.set1Photos > 0 && (
                  <Paper elevation={1} sx={{ p: 3 }}>
                    <PhotoGrid
                      photoSet={session.sets.set1}
                      setKey="set1"
                      onPhotoUpdate={(photoId, canvasState) => 
                        handlePhotoUpdate('set1', photoId, canvasState)
                      }
                      onPhotoRemove={(photoId) => handlePhotoRemove('set1', photoId)}
                    />
                  </Paper>
                )}

                {stats.set2Photos > 0 && (
                  <Paper elevation={1} sx={{ p: 3 }}>
                    <PhotoGrid
                      photoSet={session.sets.set2}
                      setKey="set2"
                      onPhotoUpdate={(photoId, canvasState) => 
                        handlePhotoUpdate('set2', photoId, canvasState)
                      }
                      onPhotoRemove={(photoId) => handlePhotoRemove('set2', photoId)}
                    />
                  </Paper>
                )}
              </>
            )}

              {/* Detailed Photo Editor */}
              {selectedPhoto && (
                <Paper elevation={2} sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                    <Typography variant="h5" component="h3">
                      Edit Photo {selectedPhoto.label}
                    </Typography>
                    <IconButton onClick={() => setSelectedPhoto(null)} color="primary">
                      <Close />
                    </IconButton>
                  </Box>
                
                <PhotoEditor
                  photo={selectedPhoto.photo}
                  label={selectedPhoto.label}
                  onUpdate={(canvasState) => 
                    handlePhotoUpdate(selectedPhoto.setKey, selectedPhoto.photo.id, canvasState)
                  }
                  onRemove={() => handlePhotoRemove(selectedPhoto.setKey, selectedPhoto.photo.id)}
                  size="large"
                  />
                </Paper>
              )}

              {/* Instructions */}
              {stats.totalPhotos === 0 && (
                <Alert severity="info" sx={{ p: 3 }}>
                  <Typography variant="h6" component="h3" sx={{ mb: 2, color: 'info.main' }}>
                    Getting Started
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2, '& li': { mb: 1, color: 'info.dark' } }}>
                    <li>Upload up to 9 photos for each set</li>
                    <li>Photos will be automatically cropped to 4:3 aspect ratio</li>
                    <li>Drag photos to reposition within the crop area</li>
                    <li>Use zoom and brightness controls for adjustments</li>
                    <li>Labels A-I will be added automatically</li>
                    <li>Export to PDF when both sets are complete</li>
                  </Box>
                </Alert>
              )}
            </Box>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

export default App;