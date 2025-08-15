import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  CropFree,
  BlurOn,
  ColorLens,
  AutoAwesome
} from '@mui/icons-material';
import type { Photo } from '../types';
import { useI18n } from '../contexts/I18nContext';

interface PhotoControlsProps {
  photo: {
    canvasState: {
      position: { x: number; y: number };
      scale: number;
      brightness: number;
      contrast: number;
      sharpness?: number;
      whiteBalance?: {
        temperature: number;
        tint: number;
        auto: boolean;
      };
      labelPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    };
  };
  label: string;
  onUpdate: (canvasState: Photo['canvasState']) => void;
  onRemove: () => void;
  mode?: 'full' | 'sidebar' | 'sliders' | 'compact-left' | 'compact-right';
  showOriginal?: boolean;
  onToggleOriginal?: () => void;
}

type LabelPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const PhotoControls: React.FC<PhotoControlsProps> = ({
  photo,
  label,
  onUpdate,
  onRemove,
  mode = 'full',
  showOriginal = false,
  onToggleOriginal
}) => {
  const { t } = useI18n();
  // Local state for immediate UI feedback
  const [localLabelPosition, setLocalLabelPosition] = useState(photo.canvasState.labelPosition);

  // Ensure we are viewing the edited version after any change
  const ensureEdited = () => {
    if (showOriginal && onToggleOriginal) {
      onToggleOriginal();
    }
  };

  // Provide default values for new properties that might not exist in old sessions
  const sharpness = photo.canvasState.sharpness || 0;
  const whiteBalance = photo.canvasState.whiteBalance || { temperature: 0, tint: 0, auto: false };

  // Sync with photo state changes
  useEffect(() => {
    setLocalLabelPosition(photo.canvasState.labelPosition);
  }, [photo.canvasState.labelPosition]);

  const handleScaleChange = (newScale: number) => {
    ensureEdited();
    // Ensure scale is at least 1.0 to prevent white borders
    const clampedScale = Math.max(1.0, newScale);
    
    // If scale didn't actually change, don't update
    if (Math.abs(clampedScale - photo.canvasState.scale) < 0.01) return;
    
    // Calculate center-based position adjustment for zoom
    const oldScale = photo.canvasState.scale;
    const scaleRatio = clampedScale / oldScale;
    
    // Base canvas dimensions - same as used in PhotoEditorApi
    const canvasWidth = 300;
    const canvasHeight = 225;
    
    // Calculate the center of the currently visible area
    const visibleCenterX = -photo.canvasState.position.x + canvasWidth / 2;
    const visibleCenterY = -photo.canvasState.position.y + canvasHeight / 2;
    
    // Calculate new position to keep the same center visible after scaling
    const newPositionX = -(visibleCenterX * scaleRatio - canvasWidth / 2);
    const newPositionY = -(visibleCenterY * scaleRatio - canvasHeight / 2);
    
    onUpdate({
      ...photo.canvasState,
      scale: clampedScale,
      position: {
        x: newPositionX,
        y: newPositionY
      }
    });
  };

  const handleBrightnessChange = (newBrightness: number) => {
    ensureEdited();
    onUpdate({
      ...photo.canvasState,
      brightness: newBrightness
    });
  };

  const handleContrastChange = (newContrast: number) => {
    ensureEdited();
    onUpdate({
      ...photo.canvasState,
      contrast: newContrast
    });
  };

  // Debounced sharpness handler to reduce computational load
  const debouncedSharpnessRef = useRef<NodeJS.Timeout>();
  const handleSharpnessChange = useCallback((newSharpness: number) => {
    ensureEdited();
    // Clear previous timeout
    if (debouncedSharpnessRef.current) {
      clearTimeout(debouncedSharpnessRef.current);
    }
    
    // Set new timeout for debounced update
    debouncedSharpnessRef.current = setTimeout(() => {
      onUpdate({
        ...photo.canvasState,
        sharpness: newSharpness
      });
    }, 300); // 300ms delay
  }, [onUpdate, photo.canvasState]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debouncedSharpnessRef.current) {
        clearTimeout(debouncedSharpnessRef.current);
      }
    };
  }, []);

  const handleWhiteBalanceTemperatureChange = (newTemperature: number) => {
    ensureEdited();
    onUpdate({
      ...photo.canvasState,
      whiteBalance: {
        ...whiteBalance,
        temperature: newTemperature,
        auto: false // Disable auto when manually adjusting
      }
    });
  };

  const handleWhiteBalanceTintChange = (newTint: number) => {
    ensureEdited();
    onUpdate({
      ...photo.canvasState,
      whiteBalance: {
        ...whiteBalance,
        tint: newTint,
        auto: false // Disable auto when manually adjusting
      }
    });
  };

  const handleAutoWhiteBalance = () => {
    ensureEdited();
    // Set auto flag temporarily to trigger calculation
    // The PhotoEditorApi component will calculate the actual values
    onUpdate({
      ...photo.canvasState,
      whiteBalance: {
        ...whiteBalance,
        auto: true
      }
    });
  };

  const handleLabelPositionChange = (position: LabelPosition) => {
    ensureEdited();
    // Update local state immediately for instant UI feedback
    setLocalLabelPosition(position);
    // Then update backend
    onUpdate({
      ...photo.canvasState,
      labelPosition: position
    });
  };

  const handleReset = () => {
    ensureEdited();
    onUpdate({
      position: { x: 0, y: 0 },
      scale: 1.0, // Default 100% scale (fills canvas)
      brightness: 0,
      contrast: 1,
      sharpness: 0,
      whiteBalance: {
        temperature: 0,
        tint: 0,
        auto: false,
      },
      labelPosition: 'bottom-left'
    });
  };

  const quickScaleOptions = [
    { label: '100%', value: 1.0 },
    { label: '125%', value: 1.25 },
    { label: '150%', value: 1.5 },
    { label: '200%', value: 2.0 },
    { label: '250%', value: 2.5 }
  ];

  // Render header component
  const renderHeader = () => (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CropFree color="primary" fontSize="small" />
        <Typography variant="subtitle1" color="primary" sx={{ fontSize: '1rem', fontWeight: 600 }}>
          {t('controls.photoLabel', { label })}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Button 
          variant="outlined" 
          color="warning" 
          size="small"
          startIcon={<Refresh fontSize="small" />}
          onClick={handleReset}
          sx={{ fontSize: '0.75rem', py: 0.5, px: 1 }}
        >
          {t('controls.resetAll')}
        </Button>
        <Tooltip title="Remove photo">
          <IconButton onClick={onRemove} color="error" size="small">
            <RestoreFromTrash fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );

  // Render label position selector and zoom
  const renderSidebarControls = () => (
    <Box>
      {/* Label Position */}
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Label color="primary" />
          <Typography variant="h6">{t('controls.labelPosition')}</Typography>
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
            const isSelected = localLabelPosition === position;
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
              {t('controls.preview')}
            </Typography>
          </Box>
        </Box>

        {/* Current selection indicator */}
        <Chip
          label={`Label: ${localLabelPosition}`}
          color="primary"
          variant="outlined"
          size="small"
          sx={{ width: '100%' }}
        />
      </Paper>

      {/* Zoom Control */}
      <Paper elevation={1} sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <ZoomIn color="primary" />
          {t('controls.zoom')}
        </Typography>
        
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="body2" color="primary" fontWeight={600}>
            {Math.round(photo.canvasState.scale * 100)}%
          </Typography>
          <Tooltip title={t('controls.resetZoom')}>
            <IconButton 
              size="small" 
              onClick={() => handleScaleChange(1.0)}
              sx={{ padding: 0.5 }}
            >
              <Refresh fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        
        <Slider
          value={Math.max(1.0, photo.canvasState.scale)}
          onChange={(_, value) => handleScaleChange(value as number)}
          min={1.0}
          max={3}
          step={0.05}
          color="primary"
          size="small"
          sx={{ mb: 2 }}
        />
        
        {/* Quick scale buttons */}
        <ButtonGroup size="small" variant="outlined" fullWidth>
          {quickScaleOptions.map((option) => (
            <Button
              key={option.value}
              onClick={() => handleScaleChange(option.value)}
              variant={photo.canvasState.scale === option.value ? 'contained' : 'outlined'}
              size="small"
              sx={{ fontSize: '0.75rem' }}
            >
              {option.label}
            </Button>
          ))}
        </ButtonGroup>
      </Paper>
    </Box>
  );

  // Render bottom sliders (horizontal layout for L-shape) - 3 equal-width tiles
  const renderSliders = () => (
    <Box sx={{ width: '100%', p: 2 }}>
      <Box sx={{ display: 'flex', gap: 2, width: '100%' }}>
        {/* Brightness + Contrast Grouped - 1/3 width */}
        <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
          <Paper elevation={1} sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Brightness4 color="primary" />
              {t('controls.basicColor')}
            </Typography>
            
            {/* Brightness */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">
                  {t('controls.brightness')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="primary" fontWeight={600}>
                    {photo.canvasState.brightness > 0 ? '+' : ''}{photo.canvasState.brightness}
                  </Typography>
                  <Tooltip title={t('controls.resetBrightness')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleBrightnessChange(0)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
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

            {/* Contrast */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">
                  {t('controls.contrast')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="primary" fontWeight={600}>
                    {Math.round(photo.canvasState.contrast * 100)}%
                  </Typography>
                  <Tooltip title={t('controls.resetContrast')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleContrastChange(1)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
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
        </Box>

        {/* Sharpness - 1/3 width */}
        <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
          <Paper elevation={1} sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
              <BlurOn color="primary" />
              {t('controls.sharpness')}
            </Typography>
            
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="primary" fontWeight={600}>
                {sharpness}
              </Typography>
              <Tooltip title={t('controls.resetSharpness')}>
                <IconButton 
                  size="small" 
                  onClick={() => handleSharpnessChange(0)}
                  sx={{ padding: 0.5 }}
                >
                  <Refresh fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            
            <Slider
              value={sharpness}
              min={0}
              max={100}
              step={5}
              onChange={(_, value) => handleSharpnessChange(value as number)}
              color="primary"
              size="small"
            />
          </Paper>
        </Box>

        {/* White Balance - 1/3 width */}
        <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
          <Paper elevation={1} sx={{ p: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ColorLens color="primary" />
                {t('controls.whiteBalance')}
              </Typography>
              
              <Button
                variant={whiteBalance.auto ? "contained" : "outlined"}
                onClick={handleAutoWhiteBalance}
                color="primary"
                size="small"
                sx={{ minWidth: 'auto', px: 2 }}
              >
                {t('controls.autoShort')}
              </Button>
            </Box>

            {/* Temperature Control - Below each other */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">
                  {t('controls.temperature')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="primary" fontWeight={600}>
                    {whiteBalance.temperature}
                  </Typography>
                  <Tooltip title={t('controls.resetTemperature')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleWhiteBalanceTemperatureChange(0)}
                      sx={{ padding: 0.5 }}
                      disabled={whiteBalance.auto}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
              <Slider
                value={whiteBalance.temperature}
                min={-100}
                max={100}
                step={5}
                onChange={(_, value) => handleWhiteBalanceTemperatureChange(value as number)}
                color="primary"
                size="small"
                disabled={whiteBalance.auto}
                sx={{
                  '& .MuiSlider-track': {
                    background: 'linear-gradient(90deg, #4FC3F7 0%, #FFE082 100%)'
                  }
                }}
              />
            </Box>

            {/* Tint Control - Below temperature */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">
                  {t('controls.tint')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="primary" fontWeight={600}>
                    {whiteBalance.tint}
                  </Typography>
                  <Tooltip title={t('controls.resetTint')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleWhiteBalanceTintChange(0)}
                      sx={{ padding: 0.5 }}
                      disabled={whiteBalance.auto}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
              <Slider
                value={whiteBalance.tint}
                min={-100}
                max={100}
                step={5}
                onChange={(_, value) => handleWhiteBalanceTintChange(value as number)}
                color="primary"
                size="small"
                disabled={whiteBalance.auto}
                sx={{
                  '& .MuiSlider-track': {
                    background: 'linear-gradient(90deg, #81C784 0%, #E91E63 100%)'
                  }
                }}
              />
            </Box>
          </Paper>
        </Box>
      </Box>
    </Box>
  );

  // Render compact controls for reverse L layout
  const renderCompactLeft = () => (
    <Box sx={{ width: '100%', height: '100%', p: 2 }}>
      {renderHeader()}
      
      {/* Original/Edited Segmented Switch */}
      {onToggleOriginal && (
        <Box sx={{ mb: 2 }}>
          <ButtonGroup fullWidth size="small">
            <Button
              variant={showOriginal ? 'contained' : 'outlined'}
              color={showOriginal ? 'primary' : 'inherit'}
              onClick={() => { if (!showOriginal) onToggleOriginal(); }}
              sx={{ fontSize: '0.75rem', py: 0.5 }}
            >
              {t('controls.showOriginal')}
            </Button>
            <Button
              variant={!showOriginal ? 'contained' : 'outlined'}
              color={!showOriginal ? 'primary' : 'inherit'}
              onClick={() => { if (showOriginal) onToggleOriginal(); }}
              sx={{ fontSize: '0.75rem', py: 0.5 }}
            >
              {t('controls.showEdited')}
            </Button>
          </ButtonGroup>
        </Box>
      )}
      
      {/* Label Position - Compact */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Label fontSize="small" color="primary" />
          {t('controls.labelPosition')}
        </Typography>
        <Box sx={{ 
          width: 100, 
          height: 80, 
          mx: 'auto',
          position: 'relative',
          border: '2px solid',
          borderColor: 'primary.light',
          borderRadius: 1,
          bgcolor: 'grey.50',
          mb: 1
        }}>
          {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as LabelPosition[]).map((position) => {
            const isSelected = localLabelPosition === position;
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
                  fontSize: '10px',
                  bgcolor: isSelected ? 'primary.main' : 'background.paper',
                  color: isSelected ? 'white' : 'text.primary',
                  border: '1px solid',
                  borderColor: isSelected ? 'primary.main' : 'grey.400'
                }}
              >
                <Typography variant="caption" sx={{ fontSize: '10px', fontWeight: 700 }}>
                  {label}
                </Typography>
              </IconButton>
            );
          })}
        </Box>
      </Box>
      
      {/* Zoom - Compact */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <ZoomIn fontSize="small" color="primary" />
            {t('controls.zoom')}
          </Typography>
          <Typography variant="caption" color="primary" fontWeight={600}>
            {Math.round(photo.canvasState.scale * 100)}%
          </Typography>
        </Box>
        <Slider
          value={Math.max(1.0, photo.canvasState.scale)}
          onChange={(_, value) => handleScaleChange(value as number)}
          min={1.0}
          max={3}
          step={0.05}
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
              sx={{ fontSize: '0.7rem', py: 0.25 }}
            >
              {option.label}
            </Button>
          ))}
        </ButtonGroup>
      </Box>
    </Box>
  );
  
  const renderCompactRight = () => (
    <Box sx={{ width: '100%', height: '100%', p: 2 }}>
      {renderHeader()}
      
      {/* Original/Edited Segmented Switch */}
      {onToggleOriginal && (
        <Box sx={{ mb: 2 }}>
          <ButtonGroup fullWidth size="small">
            <Button
              variant={showOriginal ? 'contained' : 'outlined'}
              color={showOriginal ? 'primary' : 'inherit'}
              onClick={() => { if (!showOriginal) onToggleOriginal(); }}
              sx={{ fontSize: '0.75rem', py: 0.5 }}
            >
              {t('controls.showOriginal')}
            </Button>
            <Button
              variant={!showOriginal ? 'contained' : 'outlined'}
              color={!showOriginal ? 'primary' : 'inherit'}
              onClick={() => { if (showOriginal) onToggleOriginal(); }}
              sx={{ fontSize: '0.75rem', py: 0.5 }}
            >
              {t('controls.showEdited')}
            </Button>
          </ButtonGroup>
        </Box>
      )}
      
      {/* Label Position - Compact */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Label fontSize="small" color="primary" />
          {t('controls.labelPosition')}
        </Typography>
        <Box sx={{ 
          width: 100, 
          height: 80, 
          mx: 'auto',
          position: 'relative',
          border: '2px solid',
          borderColor: 'primary.light',
          borderRadius: 1,
          bgcolor: 'grey.50',
          mb: 1
        }}>
          {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as LabelPosition[]).map((position) => {
            const isSelected = localLabelPosition === position;
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
                  fontSize: '10px',
                  bgcolor: isSelected ? 'primary.main' : 'background.paper',
                  color: isSelected ? 'white' : 'text.primary',
                  border: '1px solid',
                  borderColor: isSelected ? 'primary.main' : 'grey.400'
                }}
              >
                <Typography variant="caption" sx={{ fontSize: '10px', fontWeight: 700 }}>
                  {label}
                </Typography>
              </IconButton>
            );
          })}
        </Box>
      </Box>
      
      {/* Zoom - Compact */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <ZoomIn fontSize="small" color="primary" />
            {t('controls.zoom')}
          </Typography>
          <Typography variant="caption" color="primary" fontWeight={600}>
            {Math.round(photo.canvasState.scale * 100)}%
          </Typography>
        </Box>
        <Slider
          value={Math.max(1.0, photo.canvasState.scale)}
          onChange={(_, value) => handleScaleChange(value as number)}
          min={1.0}
          max={3}
          step={0.05}
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
              sx={{ fontSize: '0.7rem', py: 0.25 }}
            >
              {option.label}
            </Button>
          ))}
        </ButtonGroup>
      </Box>
    </Box>
  );

  // Main render logic based on mode
  if (mode === 'compact-left') {
    return renderCompactLeft();
  }
  
  if (mode === 'compact-right') {
    return renderCompactRight();
  }

  if (mode === 'sidebar') {
    return (
      <Box sx={{ width: '100%', p: 2 }}>
        {renderHeader()}
        {renderSidebarControls()}
      </Box>
    );
  }

  if (mode === 'sliders') {
    return renderSliders();
  }

  // Full mode (original layout)
  return (
    <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto' }}>
      {renderHeader()}

      <Grid container spacing={3}>
        {/* Label Position Selector */}
        <Grid item xs={12} md={6}>
          {renderSidebarControls()}
        </Grid>

        {/* Image Adjustments */}
        <Grid item xs={12} md={6}>
          <Paper elevation={1} sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Brightness4 color="primary" />
              {t('controls.imageAdjustments')}
            </Typography>

            {/* Scale/Zoom Control */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ZoomIn fontSize="small" />
                  Zoom
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="primary" fontWeight={600}>
                    {Math.round(photo.canvasState.scale * 100)}%
                  </Typography>
                  <Tooltip title="Reset zoom">
                    <IconButton 
                      size="small" 
                      onClick={() => handleScaleChange(1.0)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
              
              <Slider
                value={Math.max(1.0, photo.canvasState.scale)}
                onChange={(_, value) => handleScaleChange(value as number)}
                min={1.0}
                max={3}
                step={0.05}
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
                  {t('controls.brightness')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="primary" fontWeight={600}>
                    {photo.canvasState.brightness > 0 ? '+' : ''}{photo.canvasState.brightness}
                  </Typography>
                  <Tooltip title={t('controls.resetBrightness')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleBrightnessChange(0)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
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
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Contrast fontSize="small" />
                  {t('controls.contrast')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="primary" fontWeight={600}>
                    {Math.round(photo.canvasState.contrast * 100)}%
                  </Typography>
                  <Tooltip title={t('controls.resetContrast')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleContrastChange(1)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
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

            {/* Sharpness Control */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <BlurOn fontSize="small" />
                  {t('controls.sharpness')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="primary" fontWeight={600}>
                    {sharpness}
                  </Typography>
                  <Tooltip title={t('controls.resetSharpness')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleSharpnessChange(0)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
              <Slider
                value={sharpness}
                min={0}
                max={100}
                step={5}
                onChange={(_, value) => handleSharpnessChange(value as number)}
                color="primary"
                size="small"
              />
            </Box>
          </Paper>
        </Grid>

        {/* White Balance Controls */}
        <Grid item xs={12}>
          <Paper elevation={1} sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
              <ColorLens color="primary" />
              {t('controls.whiteBalance')}
            </Typography>

            {/* Auto White Balance Button */}
            <Box sx={{ mb: 3 }}>
              <Button
                variant={whiteBalance.auto ? "contained" : "outlined"}
                startIcon={<AutoAwesome />}
                onClick={handleAutoWhiteBalance}
                fullWidth
                color="primary"
              >
                {t('controls.autoWhiteBalance')}
              </Button>
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Temperature Control */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">
                  {t('controls.temperature')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="primary" fontWeight={600}>
                    {whiteBalance.temperature}
                  </Typography>
                  <Tooltip title={t('controls.resetTemperature')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleWhiteBalanceTemperatureChange(0)}
                      sx={{ padding: 0.5 }}
                      disabled={whiteBalance.auto}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
              <Slider
                value={whiteBalance.temperature}
                min={-100}
                max={100}
                step={5}
                onChange={(_, value) => handleWhiteBalanceTemperatureChange(value as number)}
                color="primary"
                size="small"
                disabled={whiteBalance.auto}
                sx={{
                  '& .MuiSlider-track': {
                    background: 'linear-gradient(90deg, #4FC3F7 0%, #FFE082 100%)'
                  }
                }}
              />
            </Box>

            {/* Tint Control */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">
                  {t('controls.tint')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="primary" fontWeight={600}>
                    {whiteBalance.tint}
                  </Typography>
                                      <Tooltip title={t('controls.resetTint')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleWhiteBalanceTintChange(0)}
                      sx={{ padding: 0.5 }}
                      disabled={whiteBalance.auto}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
              <Slider
                value={whiteBalance.tint}
                min={-100}
                max={100}
                step={5}
                onChange={(_, value) => handleWhiteBalanceTintChange(value as number)}
                color="primary"
                size="small"
                disabled={whiteBalance.auto}
                sx={{
                  '& .MuiSlider-track': {
                    background: 'linear-gradient(90deg, #81C784 0%, #E91E63 100%)'
                  }
                }}
              />
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};
