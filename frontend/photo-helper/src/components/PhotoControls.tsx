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
  Grid,
  TextField
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
  AutoAwesome,
  RadioButtonUnchecked,
  Circle,
  Clear,
  Close,
  Add,
  Remove
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
      circle?: {
        x: number;
        y: number;
        radius: number;
        color: 'white' | 'red' | 'yellow';
        visible: boolean;
      } | null;
    };
  };
  label: string;
  onUpdate: (canvasState: Photo['canvasState']) => void;
  onRemove: () => void;
  onClose?: () => void; // Close modal callback
  mode?: 'full' | 'sidebar' | 'sliders' | 'compact-left' | 'compact-right';
  showOriginal?: boolean;
  onToggleOriginal?: () => void;
  circleMode?: boolean;
  onCircleModeToggle?: () => void;
  onApplyToAll?: (setting: string, value: any) => void; // Apply setting to all photos
}

type LabelPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

// Editable value display component
interface EditableValueDisplayProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  formatDisplay?: (value: number) => string;
  parseInput?: (input: string) => number | null;
  sx?: any;
}

const EditableValueDisplay: React.FC<EditableValueDisplayProps> = ({
  value,
  onChange,
  min,
  max,
  formatDisplay = (v) => String(v),
  parseInput = (input) => {
    const parsed = parseFloat(input.replace(/[^\d.-]/g, ''));
    return isNaN(parsed) ? null : parsed;
  },
  sx
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const handleClick = () => {
    setInputValue(formatDisplay(value));
    setIsEditing(true);
  };

  const handleSubmit = () => {
    const parsed = parseInput(inputValue);
    if (parsed !== null) {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(clamped);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <TextField
        size="small"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={handleKeyDown}
        autoFocus
        variant="outlined"
        sx={{
          width: '60px',
          '& .MuiOutlinedInput-root': {
            height: '24px',
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'primary.main',
          },
          '& .MuiOutlinedInput-input': {
            padding: '2px 6px',
            textAlign: 'center',
          },
          ...sx
        }}
      />
    );
  }

  return (
    <Typography
      variant="body2"
      color="primary"
      fontWeight={600}
      onClick={handleClick}
      sx={{
        cursor: 'pointer',
        userSelect: 'none',
        minWidth: '60px',
        textAlign: 'center',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.02em',
        '&:hover': {
          bgcolor: 'primary.light',
          color: 'white',
          borderRadius: '4px',
        },
        padding: '4px 8px',
        borderRadius: '4px',
        transition: 'all 0.2s ease-in-out',
        ...sx
      }}
    >
      {formatDisplay(value)}
    </Typography>
  );
};

// Reusable slider component with plus/minus buttons and editable value
interface SliderWithControlsProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  color?: 'primary' | 'secondary';
  size?: 'small' | 'medium';
  disabled?: boolean;
  sx?: any;
  label?: React.ReactNode;
  formatDisplay?: (value: number) => string;
  parseInput?: (input: string) => number | null;
  resetButton?: React.ReactNode;
  onApplyToAll?: (value: number) => void;
  settingName?: string;
}

const SliderWithControls: React.FC<SliderWithControlsProps> = ({
  value,
  onChange,
  min,
  max,
  step,
  color = 'primary',
  size = 'small',
  disabled = false,
  sx,
  label,
  formatDisplay,
  parseInput,
  resetButton,
  onApplyToAll,
  settingName
}) => {
  const { t } = useI18n();
  const handleDecrement = () => {
    const newValue = Math.max(min, value - step);
    if (newValue !== value) {
      onChange(newValue);
    }
  };

  const handleIncrement = () => {
    const newValue = Math.min(max, value + step);
    if (newValue !== value) {
      onChange(newValue);
    }
  };

  return (
    <Box sx={{ ...sx }}>
      {/* Label, centered value, apply to all button, and reset button on single line */}
      {label && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, position: 'relative' }}>
          {typeof label === 'string' ? (
            <Typography variant="body2">
              {label}
            </Typography>
          ) : (
            <Box component="div" sx={{ fontSize: '0.875rem', fontWeight: 400 }}>
              {label}
            </Box>
          )}
          <Box sx={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
            <EditableValueDisplay
              value={value}
              onChange={onChange}
              min={min}
              max={max}
              formatDisplay={formatDisplay}
              parseInput={parseInput}
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {onApplyToAll && (
              <Button
                size="small"
                variant="outlined"
                onClick={() => onApplyToAll(value)}
                disabled={disabled}
                sx={{ 
                  fontSize: '0.7rem', 
                  px: 1, 
                  py: 0.25,
                  minWidth: 'auto',
                  whiteSpace: 'nowrap'
                }}
              >
                {t('controls.applyToAll')}
              </Button>
            )}
            {resetButton}
          </Box>
        </Box>
      )}
      
      {/* Slider with plus/minus controls */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton
          size="small"
          onClick={handleDecrement}
          disabled={disabled || value <= min}
          sx={{ 
            width: 24, 
            height: 24,
            '&:hover': { bgcolor: 'primary.light', color: 'white' }
          }}
        >
          <Remove fontSize="small" />
        </IconButton>
        <Slider
          value={value}
          onChange={(_, newValue) => onChange(newValue as number)}
          min={min}
          max={max}
          step={step}
          color={color}
          size={size}
          disabled={disabled}
          sx={{ flex: 1 }}
        />
        <IconButton
          size="small"
          onClick={handleIncrement}
          disabled={disabled || value >= max}
          sx={{ 
            width: 24, 
            height: 24,
            '&:hover': { bgcolor: 'primary.light', color: 'white' }
          }}
        >
          <Add fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
};

export const PhotoControls: React.FC<PhotoControlsProps> = ({
  photo,
  label,
  onUpdate,
  onRemove,
  onClose,
  mode = 'full',
  showOriginal = false,
  onToggleOriginal,
  circleMode: externalCircleMode,
  onCircleModeToggle,
  onApplyToAll
}) => {
  const { t } = useI18n();
  // Local state for immediate UI feedback
  const [localLabelPosition, setLocalLabelPosition] = useState(photo.canvasState.labelPosition);
  const [circleMode, setCircleMode] = useState(externalCircleMode || false);

  // Ensure we are viewing the edited version after any change
  const ensureEdited = () => {
    if (showOriginal && onToggleOriginal) {
      onToggleOriginal();
    }
  };

  // Provide default values for new properties that might not exist in old sessions
  const sharpness = photo.canvasState.sharpness || 0;
  const whiteBalance = photo.canvasState.whiteBalance || { temperature: 0, tint: 0, auto: false };
  const circle = photo.canvasState.circle || null;

  // Sync with photo state changes
  useEffect(() => {
    setLocalLabelPosition(photo.canvasState.labelPosition);
  }, [photo.canvasState.labelPosition]);

  // Sync with external circle mode
  useEffect(() => {
    if (externalCircleMode !== undefined) {
      setCircleMode(externalCircleMode);
    }
  }, [externalCircleMode]);

  const handleScaleChange = (newScale: number) => {
    ensureEdited();
    // Ensure scale is at least 1.0 to prevent white borders
    const clampedScale = Math.max(1.0, newScale);
    
    // If scale didn't actually change, don't update
    if (Math.abs(clampedScale - photo.canvasState.scale) < 0.01) return;
    
    // Note: Position constraints are handled in PhotoEditorApi
    // We just update the scale here and let the editor component handle positioning
    onUpdate({
      ...photo.canvasState,
      scale: clampedScale
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

  // Immediate sharpness handler - modern browsers handle this easily
  const handleSharpnessChange = useCallback((newSharpness: number) => {
    ensureEdited();
    onUpdate({
      ...photo.canvasState,
      sharpness: newSharpness
    });
  }, [onUpdate, photo.canvasState]);

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

  const handleResetWhiteBalance = () => {
    ensureEdited();
    onUpdate({
      ...photo.canvasState,
      whiteBalance: {
        temperature: 0,
        tint: 0,
        auto: false
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
      labelPosition: 'bottom-left',
      circle: null // Remove any existing circle - use null to ensure it's sent to backend
    });
    // Also disable circle mode if it's active
    if (circleMode) {
      if (onCircleModeToggle) {
        onCircleModeToggle();
      } else {
        setCircleMode(false);
      }
    }
  };

  // Circle overlay handlers
  const handleAddCircleClick = () => {
    ensureEdited();
    // Enable circle mode
    if (onCircleModeToggle) {
      onCircleModeToggle();
    } else {
      setCircleMode(true);
    }
  };

  const handleCircleRadiusChange = (newRadius: number) => {
    if (!circle) return;
    ensureEdited();
    onUpdate({
      ...photo.canvasState,
      circle: {
        ...circle,
        radius: newRadius
      }
    });
  };

  const handleCircleColorChange = (newColor: 'white' | 'red' | 'yellow') => {
    if (!circle) return;
    ensureEdited();
    onUpdate({
      ...photo.canvasState,
      circle: {
        ...circle,
        color: newColor
      }
    });
  };

  const handleCirclePositionChange = (x: number, y: number) => {
    if (!circle) return;
    ensureEdited();
    onUpdate({
      ...photo.canvasState,
      circle: {
        ...circle,
        x,
        y
      }
    });
  };

  const handleRemoveCircle = () => {
    ensureEdited();
    onUpdate({
      ...photo.canvasState,
      circle: null // Use null to ensure it's sent to backend
    });
    // Disable circle mode when circle is removed
    if (onCircleModeToggle && circleMode) {
      onCircleModeToggle();
    } else {
      setCircleMode(false);
    }
  };

  const quickScaleOptions = [
    { label: '100%', value: 1.0 },
    { label: '125%', value: 1.25 },
    { label: '150%', value: 1.5 },
    { label: '200%', value: 2.0 },
    { label: '250%', value: 2.5 }
  ];

  // Render header component with close button (no delete button - can delete from grid)
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
          variant="contained" 
          color="error" 
          size="small"
          startIcon={<Refresh fontSize="small" />}
          onClick={handleReset}
          sx={{ fontSize: '0.75rem', py: 0.5, px: 1 }}
        >
          {t('controls.resetAll')}
        </Button>
        <Tooltip title={t('controls.closeEditor')}>
          <IconButton onClick={onClose} color="primary" size="small">
            <Close fontSize="small" />
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

      {/* Circle Overlay */}
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <RadioButtonUnchecked color="primary" />
          <Typography variant="h6">{t('controls.circleOverlay')}</Typography>
        </Box>
        
        {/* Add Circle Button - Only show when no circle exists */}
        {!circle && (
          <Box sx={{ mb: 2 }}>
            <Button
              variant="outlined"
              color="primary"
              size="small"
              startIcon={<RadioButtonUnchecked />}
              onClick={handleAddCircleClick}
              fullWidth
              sx={{ mb: 2 }}
            >
              {t('controls.circleMode.add')}
            </Button>
            
            {circleMode && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
                Click on the photo to place a circle
              </Typography>
            )}
          </Box>
        )}

        {/* Circle Controls - Only show when circle exists */}
        {circle && (
          <>
            {/* Radius Control */}
            <Box sx={{ mb: 2 }}>
              <SliderWithControls
                value={circle.radius}
                onChange={handleCircleRadiusChange}
                min={10}
                max={100}
                step={5}
                color="primary"
                size="small"
                label={
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t('controls.circleMode.radius')}
                  </Typography>
                }
                formatDisplay={(value) => `${value}px`}
                parseInput={(input) => {
                  const num = parseFloat(input.replace(/[^\d]/g, ''));
                  return isNaN(num) ? null : num;
                }}
              />
            </Box>

            {/* Color Selection */}
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
                {t('controls.circleMode.color')}
              </Typography>
              <ButtonGroup size="small" fullWidth>
                <Button
                  variant={circle.color === 'white' ? 'contained' : 'outlined'}
                  onClick={() => handleCircleColorChange('white')}
                  sx={{ 
                    bgcolor: circle.color === 'white' ? 'grey.800' : 'transparent',
                    color: circle.color === 'white' ? 'white' : 'text.primary',
                    borderColor: 'grey.400',
                    '&:hover': { bgcolor: 'grey.700', color: 'white' }
                  }}
                >
                  {t('controls.circleMode.white')}
                </Button>
                <Button
                  variant={circle.color === 'red' ? 'contained' : 'outlined'}
                  color="error"
                  onClick={() => handleCircleColorChange('red')}
                >
                  {t('controls.circleMode.red')}
                </Button>
                <Button
                  variant={circle.color === 'yellow' ? 'contained' : 'outlined'}
                  onClick={() => handleCircleColorChange('yellow')}
                  sx={{ 
                    bgcolor: circle.color === 'yellow' ? '#FFC107' : 'transparent',
                    color: circle.color === 'yellow' ? 'black' : 'text.primary',
                    borderColor: '#FFC107',
                    '&:hover': { bgcolor: '#FFB300', color: 'black' }
                  }}
                >
                  {t('controls.circleMode.yellow')}
                </Button>
              </ButtonGroup>
            </Box>

            {/* Remove Circle */}
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={<Clear />}
              onClick={handleRemoveCircle}
              fullWidth
            >
              {t('controls.circleMode.removeCircle')}
            </Button>
          </>
        )}
      </Paper>

      {/* Zoom Control */}
      <Paper elevation={1} sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <ZoomIn color="primary" />
          {t('controls.zoom')}
        </Typography>
        
        <SliderWithControls
          value={Math.max(1.0, photo.canvasState.scale)}
          onChange={handleScaleChange}
          min={1.0}
          max={3}
          step={0.05}
          color="primary"
          size="small"
          label=""
          resetButton={
            <Tooltip title={t('controls.resetZoom')}>
              <IconButton 
                size="small" 
                onClick={() => handleScaleChange(1.0)}
                sx={{ padding: 0.5 }}
              >
                <Refresh fontSize="small" />
              </IconButton>
            </Tooltip>
          }
          formatDisplay={(value) => `${Math.round(value * 100)}%`}
          parseInput={(input) => {
            const num = parseFloat(input.replace(/[^\d.]/g, ''));
            return isNaN(num) ? null : num / 100;
          }}
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
        {/* Zoom + Sharpness - 1/3 width - First position */}
        <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
          <Paper elevation={1} sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, fontSize: '1.2rem' }}>
              <ZoomIn color="primary" />
              {t('controls.zoomAndSharpness')}
            </Typography>
            
            {/* Zoom Control */}
            <Box sx={{ mb: 2 }}>
              <SliderWithControls
                value={Math.max(1.0, photo.canvasState.scale)}
                onChange={handleScaleChange}
                min={1.0}
                max={3}
                step={0.05}
                color="primary"
                size="small"
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1rem' }}>
                    <ZoomIn fontSize="small" />
                    {t('controls.zoom')}
                  </Box>
                }
                resetButton={
                  <Tooltip title={t('controls.resetZoom')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleScaleChange(1.0)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
                onApplyToAll={onApplyToAll ? (value) => onApplyToAll('scale', value) : undefined}
                formatDisplay={(value) => `${Math.round(value * 100)}%`}
                parseInput={(input) => {
                  const num = parseFloat(input.replace(/[^\d.]/g, ''));
                  return isNaN(num) ? null : num / 100;
                }}
              />
            </Box>

            {/* Sharpness Control */}
            <Box>
              <SliderWithControls
                value={sharpness}
                onChange={handleSharpnessChange}
                min={0}
                max={100}
                step={5}
                color="primary"
                size="small"
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1rem' }}>
                    <BlurOn fontSize="small" />
                    {t('controls.sharpness')}
                  </Box>
                }
                resetButton={
                  <Tooltip title={t('controls.resetSharpness')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleSharpnessChange(0)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
                onApplyToAll={onApplyToAll ? (value) => onApplyToAll('sharpness', value) : undefined}
                formatDisplay={(value) => String(value)}
                parseInput={(input) => {
                  const num = parseFloat(input.replace(/[^\d]/g, ''));
                  return isNaN(num) ? null : num;
                }}
              />
            </Box>
          </Paper>
        </Box>

        {/* Brightness + Contrast - 1/3 width - Second position */}
        <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
          <Paper elevation={1} sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, fontSize: '1.2rem' }}>
              <Brightness4 color="primary" />
              {t('controls.basicColor')}
            </Typography>
            
            {/* Brightness */}
            <Box sx={{ mb: 2 }}>
              <SliderWithControls
                value={photo.canvasState.brightness}
                onChange={handleBrightnessChange}
                min={-100}
                max={100}
                step={1}
                color="primary"
                size="small"
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1rem' }}>
                    <Brightness4 fontSize="small" />
                    {t('controls.brightness')}
                  </Box>
                }
                resetButton={
                  <Tooltip title={t('controls.resetBrightness')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleBrightnessChange(0)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
                onApplyToAll={onApplyToAll ? (value) => onApplyToAll('brightness', value) : undefined}
                formatDisplay={(value) => value > 0 ? `+${value}` : String(value)}
                parseInput={(input) => {
                  const num = parseFloat(input.replace(/[^\d.-]/g, ''));
                  return isNaN(num) ? null : num;
                }}
              />
            </Box>

            {/* Contrast */}
            <Box>
              <SliderWithControls
                value={photo.canvasState.contrast}
                onChange={handleContrastChange}
                min={0.5}
                max={2}
                step={0.01}
                color="primary"
                size="small"
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1rem' }}>
                    <Contrast fontSize="small" />
                    {t('controls.contrast')}
                  </Box>
                }
                resetButton={
                  <Tooltip title={t('controls.resetContrast')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleContrastChange(1)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
                onApplyToAll={onApplyToAll ? (value) => onApplyToAll('contrast', value) : undefined}
                formatDisplay={(value) => `${Math.round(value * 100)}%`}
                parseInput={(input) => {
                  const num = parseFloat(input.replace(/[^\d.]/g, ''));
                  return isNaN(num) ? null : num / 100;
                }}
              />
            </Box>
          </Paper>
        </Box>

        {/* White Balance - 1/3 width */}
        <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
          <Paper elevation={1} sx={{ p: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1.2rem' }}>
                <ColorLens color="primary" />
                {t('controls.whiteBalance')}
              </Typography>
              
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Button
                  variant={whiteBalance.auto ? "contained" : "outlined"}
                  onClick={handleAutoWhiteBalance}
                  color="primary"
                  size="small"
                  sx={{ minWidth: 'auto', px: 1.5, py: 0.25, fontSize: '0.75rem' }}
                >
                  {t('controls.autoShort')}
                </Button>
                <Tooltip title={t('controls.resetWhiteBalance')}>
                  <IconButton 
                    size="small" 
                    onClick={handleResetWhiteBalance}
                    sx={{ padding: 0.5 }}
                  >
                    <Refresh fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            {/* Temperature Control - Below each other */}
            <Box sx={{ mb: 2 }}>
              <SliderWithControls
                value={whiteBalance.temperature}
                onChange={handleWhiteBalanceTemperatureChange}
                min={-50}
                max={50}
                step={1}
                color="primary"
                size="small"
                disabled={whiteBalance.auto}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1rem' }}>
                    {t('controls.temperature')}
                  </Box>
                }
                resetButton={
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
                }
                onApplyToAll={onApplyToAll ? (value) => onApplyToAll('whiteBalance.temperature', value) : undefined}
                formatDisplay={(value) => String(value)}
                parseInput={(input) => {
                  const num = parseFloat(input.replace(/[^\d.-]/g, ''));
                  return isNaN(num) ? null : num;
                }}
                sx={{
                  '& .MuiSlider-track': {
                    background: 'linear-gradient(90deg, #4FC3F7 0%, #FFE082 100%)'
                  }
                }}
              />
            </Box>

            {/* Tint Control - Below temperature */}
            <Box>
              <SliderWithControls
                value={whiteBalance.tint}
                onChange={handleWhiteBalanceTintChange}
                min={-50}
                max={50}
                step={1}
                color="primary"
                size="small"
                disabled={whiteBalance.auto}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1rem' }}>
                    {t('controls.tint')}
                  </Box>
                }
                resetButton={
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
                }
                onApplyToAll={onApplyToAll ? (value) => onApplyToAll('whiteBalance.tint', value) : undefined}
                formatDisplay={(value) => String(value)}
                parseInput={(input) => {
                  const num = parseFloat(input.replace(/[^\d.-]/g, ''));
                  return isNaN(num) ? null : num;
                }}
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
      
      {/* Label Position - Compact 2x2 Grid */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Label fontSize="small" color="primary" />
          {t('controls.labelPosition')}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, width: '100%' }}>
          <Button
            variant={localLabelPosition === 'top-left' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => handleLabelPositionChange('top-left')}
            sx={{ fontSize: '0.7rem', py: 0.5, minWidth: 0 }}
          >
            ↖ {label}
          </Button>
          <Button
            variant={localLabelPosition === 'top-right' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => handleLabelPositionChange('top-right')}
            sx={{ fontSize: '0.7rem', py: 0.5, minWidth: 0 }}
          >
            ↗ {label}
          </Button>
          <Button
            variant={localLabelPosition === 'bottom-left' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => handleLabelPositionChange('bottom-left')}
            sx={{ fontSize: '0.7rem', py: 0.5, minWidth: 0 }}
          >
            ↙ {label}
          </Button>
          <Button
            variant={localLabelPosition === 'bottom-right' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => handleLabelPositionChange('bottom-right')}
            sx={{ fontSize: '0.7rem', py: 0.5, minWidth: 0 }}
          >
            ↘ {label}
          </Button>
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
        <SliderWithControls
          value={Math.max(1.0, photo.canvasState.scale)}
          onChange={handleScaleChange}
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
      
      {/* Label Position - Compact 2x2 Grid */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Label fontSize="small" color="primary" />
          {t('controls.labelPosition')}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, width: '100%' }}>
          <Button
            variant={localLabelPosition === 'top-left' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => handleLabelPositionChange('top-left')}
            sx={{ fontSize: '0.7rem', py: 0.5, minWidth: 0 }}
          >
            ↖ {label}
          </Button>
          <Button
            variant={localLabelPosition === 'top-right' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => handleLabelPositionChange('top-right')}
            sx={{ fontSize: '0.7rem', py: 0.5, minWidth: 0 }}
          >
            ↗ {label}
          </Button>
          <Button
            variant={localLabelPosition === 'bottom-left' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => handleLabelPositionChange('bottom-left')}
            sx={{ fontSize: '0.7rem', py: 0.5, minWidth: 0 }}
          >
            ↙ {label}
          </Button>
          <Button
            variant={localLabelPosition === 'bottom-right' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => handleLabelPositionChange('bottom-right')}
            sx={{ fontSize: '0.7rem', py: 0.5, minWidth: 0 }}
          >
            ↘ {label}
          </Button>
        </Box>
      </Box>
      
      {/* Circle Overlay */}
      <Box sx={{ mt: 3, mb: 2 }}>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.8rem' }}>
          <RadioButtonUnchecked fontSize="small" color="primary" />
          {t('controls.circleOverlay')}
        </Typography>
        
        {/* Add Circle Button - Only show when no circle exists */}
        {!circle && (
          <>
            <Button
              variant="outlined"
              color="primary"
              size="small"
              fullWidth
              onClick={handleAddCircleClick}
              startIcon={<RadioButtonUnchecked />}
              sx={{ mb: 1, fontSize: '0.7rem', py: 0.4 }}
            >
              {t('controls.circleMode.add')}
            </Button>
            
            {circleMode && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mb: 1, fontSize: '0.65rem' }}>
                {t('controls.circleMode.clickToPlace')}
              </Typography>
            )}
          </>
        )}

        {/* Circle Controls - Only show when circle exists */}
        {circle && (
          <>
            {/* Radius Control */}
            <Box sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem' }}>
                  {t('controls.circleMode.radius')}
                </Typography>
                <Typography variant="caption" color="primary" fontWeight={600} sx={{ fontSize: '0.65rem' }}>
                  {circle.radius}px
                </Typography>
              </Box>
              <SliderWithControls
                value={circle.radius}
                onChange={handleCircleRadiusChange}
                min={10}
                max={100}
                step={5}
                color="primary"
                size="small"
                sx={{ mb: 0.25 }}
              />
            </Box>

            {/* Color Selection */}
            <Box sx={{ mb: 1 }}>
              <Typography variant="caption" sx={{ mb: 0.25, fontWeight: 600, display: 'block', fontSize: '0.65rem' }}>
                {t('controls.circleMode.color')}
              </Typography>
              <ButtonGroup size="small" fullWidth>
                <Button
                  variant={circle.color === 'white' ? 'contained' : 'outlined'}
                  onClick={() => handleCircleColorChange('white')}
                  sx={{ 
                    bgcolor: circle.color === 'white' ? 'grey.800' : 'transparent',
                    color: circle.color === 'white' ? 'white' : 'text.primary',
                    borderColor: 'grey.400',
                    '&:hover': { bgcolor: 'grey.700', color: 'white' },
                    fontSize: '0.6rem', py: 0.3
                  }}
                >
                  {t('controls.circleMode.white')}
                </Button>
                <Button
                  variant={circle.color === 'red' ? 'contained' : 'outlined'}
                  color="error"
                  onClick={() => handleCircleColorChange('red')}
                  sx={{ fontSize: '0.6rem', py: 0.3 }}
                >
                  {t('controls.circleMode.red')}
                </Button>
                <Button
                  variant={circle.color === 'yellow' ? 'contained' : 'outlined'}
                  onClick={() => handleCircleColorChange('yellow')}
                  sx={{ 
                    bgcolor: circle.color === 'yellow' ? '#FFC107' : 'transparent',
                    color: circle.color === 'yellow' ? 'black' : 'text.primary',
                    borderColor: '#FFC107',
                    '&:hover': { bgcolor: '#FFB300', color: 'black' },
                    fontSize: '0.6rem', py: 0.3
                  }}
                >
                  {t('controls.circleMode.yellow')}
                </Button>
              </ButtonGroup>
            </Box>

            {/* Remove Circle */}
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={<Clear fontSize="small" />}
              onClick={handleRemoveCircle}
              fullWidth
              sx={{ fontSize: '0.65rem', py: 0.3 }}
            >
              {t('controls.circleMode.removeCircle')}
            </Button>
          </>
        )}
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
              <SliderWithControls
                value={Math.max(1.0, photo.canvasState.scale)}
                onChange={handleScaleChange}
                min={1.0}
                max={3}
                step={0.05}
                color="primary"
                size="small"
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ZoomIn fontSize="small" />
                    {t('controls.zoom')}
                  </Box>
                }
                resetButton={
                  <Tooltip title={t('controls.resetZoom')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleScaleChange(1.0)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
                onApplyToAll={onApplyToAll ? (value) => onApplyToAll('scale', value) : undefined}
                formatDisplay={(value) => `${Math.round(value * 100)}%`}
                parseInput={(input) => {
                  const num = parseFloat(input.replace(/[^\d.]/g, ''));
                  return isNaN(num) ? null : num / 100;
                }}
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
              <SliderWithControls
                value={photo.canvasState.brightness}
                onChange={handleBrightnessChange}
                min={-100}
                max={100}
                step={1}
                color="primary"
                size="small"
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Brightness4 fontSize="small" />
                    {t('controls.brightness')}
                  </Box>
                }
                resetButton={
                  <Tooltip title={t('controls.resetBrightness')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleBrightnessChange(0)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
                onApplyToAll={onApplyToAll ? (value) => onApplyToAll('brightness', value) : undefined}
                formatDisplay={(value) => value > 0 ? `+${value}` : String(value)}
                parseInput={(input) => {
                  const num = parseFloat(input.replace(/[^\d.-]/g, ''));
                  return isNaN(num) ? null : num;
                }}
              />
            </Box>

            {/* Contrast Control */}
            <Box sx={{ mb: 3 }}>
              <SliderWithControls
                value={photo.canvasState.contrast}
                onChange={handleContrastChange}
                min={0.5}
                max={2}
                step={0.01}
                color="primary"
                size="small"
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Contrast fontSize="small" />
                    {t('controls.contrast')}
                  </Box>
                }
                resetButton={
                  <Tooltip title={t('controls.resetContrast')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleContrastChange(1)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
                onApplyToAll={onApplyToAll ? (value) => onApplyToAll('contrast', value) : undefined}
                formatDisplay={(value) => `${Math.round(value * 100)}%`}
                parseInput={(input) => {
                  const num = parseFloat(input.replace(/[^\d.]/g, ''));
                  return isNaN(num) ? null : num / 100;
                }}
              />
            </Box>

            {/* Sharpness Control */}
            <Box>
              <SliderWithControls
                value={sharpness}
                onChange={handleSharpnessChange}
                min={0}
                max={100}
                step={5}
                color="primary"
                size="small"
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <BlurOn fontSize="small" />
                    {t('controls.sharpness')}
                  </Box>
                }
                resetButton={
                  <Tooltip title={t('controls.resetSharpness')}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleSharpnessChange(0)}
                      sx={{ padding: 0.5 }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
                onApplyToAll={onApplyToAll ? (value) => onApplyToAll('sharpness', value) : undefined}
                formatDisplay={(value) => String(value)}
                parseInput={(input) => {
                  const num = parseFloat(input.replace(/[^\d]/g, ''));
                  return isNaN(num) ? null : num;
                }}
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

            {/* Auto White Balance Button and Reset */}
            <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button
                variant={whiteBalance.auto ? "contained" : "outlined"}
                startIcon={<AutoAwesome />}
                onClick={handleAutoWhiteBalance}
                color="primary"
                sx={{ flex: 1 }}
              >
                {t('controls.autoWhiteBalance')}
              </Button>
              <Tooltip title="Reset white balance">
                <IconButton 
                  size="small" 
                  onClick={handleResetWhiteBalance}
                  sx={{ padding: 0.5 }}
                >
                  <Refresh fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Temperature Control */}
            <Box sx={{ mb: 3 }}>
              <SliderWithControls
                value={whiteBalance.temperature}
                onChange={handleWhiteBalanceTemperatureChange}
                min={-50}
                max={50}
                step={1}
                color="primary"
                size="small"
                disabled={whiteBalance.auto}
                label={t('controls.temperature')}
                resetButton={
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
                }
                onApplyToAll={onApplyToAll ? (value) => onApplyToAll('whiteBalance.temperature', value) : undefined}
                formatDisplay={(value) => String(value)}
                parseInput={(input) => {
                  const num = parseFloat(input.replace(/[^\d.-]/g, ''));
                  return isNaN(num) ? null : num;
                }}
                sx={{
                  '& .MuiSlider-track': {
                    background: 'linear-gradient(90deg, #4FC3F7 0%, #FFE082 100%)'
                  }
                }}
              />
            </Box>

            {/* Tint Control */}
            <Box>
              <SliderWithControls
                value={whiteBalance.tint}
                onChange={handleWhiteBalanceTintChange}
                min={-50}
                max={50}
                step={1}
                color="primary"
                size="small"
                disabled={whiteBalance.auto}
                label={t('controls.tint')}
                resetButton={
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
                }
                onApplyToAll={onApplyToAll ? (value) => onApplyToAll('whiteBalance.tint', value) : undefined}
                formatDisplay={(value) => String(value)}
                parseInput={(input) => {
                  const num = parseFloat(input.replace(/[^\d.-]/g, ''));
                  return isNaN(num) ? null : num;
                }}
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
