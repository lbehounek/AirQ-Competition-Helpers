import React from 'react';
import {
  Box,
  Typography,
  Slider,
  Paper,
  IconButton,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Divider,
  Chip,
  ButtonGroup,
  Button,
  Tooltip,
  Grid
} from '@mui/material';
import {
  ZoomIn,
  ZoomOut,
  Brightness4,
  Contrast,
  RestoreFromTrash,
  Refresh,
  Label,
  CropFree
} from '@mui/icons-material';
import type { Photo } from '../types';

interface PhotoControlsProps {
  photo: Photo;
  label: string;
  onUpdate: (canvasState: Photo['canvasState']) => void;
  onRemove: () => void;
}

type LabelPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const PhotoControls: React.FC<PhotoControlsProps> = ({
  photo,
  label,
  onUpdate,
  onRemove
}) => {
  const handleScaleChange = (newScale: number) => {
    onUpdate({
      ...photo.canvasState,
      scale: newScale
    });
  };

  const handleBrightnessChange = (newBrightness: number) => {
    onUpdate({
      ...photo.canvasState,
      brightness: newBrightness
    });
  };

  const handleContrastChange = (newContrast: number) => {
    onUpdate({
      ...photo.canvasState,
      contrast: newContrast
    });
  };

  const handleLabelPositionChange = (position: LabelPosition) => {
    onUpdate({
      ...photo.canvasState,
      labelPosition: position
    });
  };

  const handleReset = () => {
    onUpdate({
      position: { x: 0, y: 0 },
      scale: 1,
      brightness: 0,
      contrast: 1,
      labelPosition: 'bottom-left'
    });
  };

  const quickScaleOptions = [
    { label: '50%', value: 0.5 },
    { label: '75%', value: 0.75 },
    { label: '100%', value: 1.0 },
    { label: '150%', value: 1.5 },
    { label: '200%', value: 2.0 }
  ];

  return (
    <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CropFree color="primary" />
          <Typography variant="h6" color="primary">
            Photo {label} Controls
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Reset all adjustments">
            <IconButton onClick={handleReset} color="warning" size="small">
              <Refresh />
            </IconButton>
          </Tooltip>
          <Tooltip title="Remove photo">
            <IconButton onClick={onRemove} color="error" size="small">
              <RestoreFromTrash />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Label Position Selector */}
        <Grid item xs={12} md={6}>
          <Paper elevation={1} sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Label color="primary" />
              <Typography variant="h6">Label Position</Typography>
            </Box>
            
            {/* Visual Corner Selector */}
            <Box sx={{ 
              width: 120, 
              height: 90, 
              mx: 'auto',
              mb: 2,
              position: 'relative',
              border: '2px solid',
              borderColor: 'primary.light',
              borderRadius: 1,
              bgcolor: 'grey.50'
            }}>
              {/* Corner buttons */}
              {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as LabelPosition[]).map((position) => {
                const isSelected = photo.canvasState.labelPosition === position;
                const [vertical, horizontal] = position.split('-');
                
                return (
                  <IconButton
                    key={position}
                    size="small"
                    onClick={() => handleLabelPositionChange(position)}
                    sx={{
                      position: 'absolute',
                      [vertical]: -12,
                      [horizontal]: -12,
                      width: 24,
                      height: 24,
                      bgcolor: isSelected ? 'primary.main' : 'background.paper',
                      color: isSelected ? 'white' : 'text.primary',
                      border: '2px solid',
                      borderColor: isSelected ? 'primary.main' : 'grey.400',
                      '&:hover': {
                        bgcolor: isSelected ? 'primary.dark' : 'primary.light',
                        color: 'white'
                      }
                    }}
                  >
                    <Typography variant="caption" sx={{ fontSize: '10px', fontWeight: 700 }}>
                      {label}
                    </Typography>
                  </IconButton>
                );
              })}
              
              {/* Center preview */}
              <Box sx={{ 
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center'
              }}>
                <Typography variant="caption" color="text.secondary">
                  Preview
                </Typography>
              </Box>
            </Box>

            {/* Current selection indicator */}
            <Chip
              label={`Label: ${photo.canvasState.labelPosition}`}
              color="primary"
              variant="outlined"
              size="small"
              sx={{ width: '100%' }}
            />
          </Paper>
        </Grid>

        {/* Image Adjustments */}
        <Grid item xs={12} md={6}>
          <Paper elevation={1} sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Brightness4 color="primary" />
              Image Adjustments
            </Typography>

            {/* Scale/Zoom Control */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ZoomIn fontSize="small" />
                  Zoom
                </Typography>
                <Typography variant="body2" color="primary" fontWeight={600}>
                  {Math.round(photo.canvasState.scale * 100)}%
                </Typography>
              </Box>
              
              <Slider
                value={photo.canvasState.scale}
                min={0.1}
                max={3}
                step={0.1}
                onChange={(_, value) => handleScaleChange(value as number)}
                color="primary"
                size="small"
                sx={{ mb: 1 }}
              />
              
              {/* Quick scale buttons */}
              <ButtonGroup size="small" variant="outlined" fullWidth>
                {quickScaleOptions.map((option) => (
                  <Button
                    key={option.value}
                    onClick={() => handleScaleChange(option.value)}
                    variant={photo.canvasState.scale === option.value ? 'contained' : 'outlined'}
                    size="small"
                  >
                    {option.label}
                  </Button>
                ))}
              </ButtonGroup>
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Brightness Control */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Brightness4 fontSize="small" />
                  Brightness
                </Typography>
                <Typography variant="body2" color="primary" fontWeight={600}>
                  {photo.canvasState.brightness > 0 ? '+' : ''}{photo.canvasState.brightness}
                </Typography>
              </Box>
              <Slider
                value={photo.canvasState.brightness}
                min={-100}
                max={100}
                step={1}
                onChange={(_, value) => handleBrightnessChange(value as number)}
                color="primary"
                size="small"
              />
            </Box>

            {/* Contrast Control */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Contrast fontSize="small" />
                  Contrast
                </Typography>
                <Typography variant="body2" color="primary" fontWeight={600}>
                  {Math.round(photo.canvasState.contrast * 100)}%
                </Typography>
              </Box>
              <Slider
                value={photo.canvasState.contrast}
                min={0.5}
                max={2}
                step={0.1}
                onChange={(_, value) => handleContrastChange(value as number)}
                color="primary"
                size="small"
              />
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};
