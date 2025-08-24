import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box, Tooltip } from '@mui/material';
import type { Photo } from '../types';
import { 
  autoCropTo43, 
  applyImageAdjustments 
} from '../utils/imageProcessing';
import { 
  initializePhotoCanvas,
  drawImageOnCanvas,
  drawLabel,
  getCanvasMousePosition,
  constrainPosition,
  CANVAS_SETTINGS
} from '../utils/canvasUtils';

interface PhotoEditorProps {
  photo: Photo;
  label: string;
  onUpdate: (canvasState: Photo['canvasState']) => void;
  onRemove: () => void;
  size?: 'grid' | 'large';
}

export const PhotoEditor: React.FC<PhotoEditorProps> = ({
  photo,
  label,
  onUpdate,
  onRemove,
  size = 'grid'
}) => {
  // Early return if photo data is invalid
  if (!photo || !photo.canvasState) {
    return (
      <div style={{ 
        width: size === 'large' ? 400 : 240, 
        height: size === 'large' ? 300 : 180,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f5f5',
        border: '1px solid #ddd',
        borderRadius: '8px',
        color: '#666'
      }}>
        No photo data
      </div>
    );
  }

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [croppedImage, setCroppedImage] = useState<HTMLCanvasElement | null>(null);
  
  // Canvas dimensions based on size
  const canvasSize = size === 'large' 
    ? { width: 400, height: 300 } 
    : { width: CANVAS_SETTINGS.width, height: CANVAS_SETTINGS.height };

  /**
   * Initialize and crop the original image
   */
  useEffect(() => {
    if (photo?.originalImage) {
      try {
        const cropped = autoCropTo43(photo.originalImage);
        setCroppedImage(cropped);
      } catch (error) {
        console.error('Error cropping image:', error);
        setCroppedImage(null);
      }
    }
  }, [photo?.originalImage]);

  /**
   * Render the canvas when cropped image or canvas state changes
   */
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !croppedImage || !photo?.canvasState) return;

    try {
      // Clear and draw the image with current position and scale
      drawImageOnCanvas(
        canvas,
        croppedImage,
        photo.canvasState.position,
        photo.canvasState.scale
      );

      // Apply image adjustments
      if (photo.canvasState.brightness !== 0 || photo.canvasState.contrast !== 1) {
        applyImageAdjustments(canvas, {
          brightness: photo.canvasState.brightness,
          contrast: photo.canvasState.contrast,
          scale: photo.canvasState.scale
        });
      }

          // Draw the label with position from canvas state
    drawLabel(canvas, label, photo.canvasState.labelPosition || 'bottom-left');
    } catch (error) {
      console.error('Error rendering canvas:', error);
    }
  }, [croppedImage, photo?.canvasState, label]);

  /**
   * Initialize canvas and render when component mounts
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    
    if (croppedImage) {
      renderCanvas();
    } else {
      initializePhotoCanvas(canvas);
    }
  }, [canvasSize.width, canvasSize.height, croppedImage, renderCanvas]);

  /**
   * Re-render when canvas state changes
   */
  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  /**
   * Handle mouse down - start dragging
   */
  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!croppedImage || !photo?.canvasState) return;
    
    const canvas = canvasRef.current!;
    const mousePos = getCanvasMousePosition(canvas, event.nativeEvent);
    
    setIsDragging(true);
    setDragStart(mousePos);
    event.preventDefault();
  };

  /**
   * Handle mouse move - update position while dragging
   */
  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !croppedImage || !photo?.canvasState) return;

    const canvas = canvasRef.current!;
    const mousePos = getCanvasMousePosition(canvas, event.nativeEvent);
    
    const deltaX = mousePos.x - dragStart.x;
    const deltaY = mousePos.y - dragStart.y;
    
    const newPosition = {
      x: photo.canvasState.position.x + deltaX,
      y: photo.canvasState.position.y + deltaY
    };

    // Constrain position to keep image within bounds
    const constrainedPosition = constrainPosition(
      newPosition,
      { width: croppedImage.width, height: croppedImage.height },
      canvasSize,
      photo.canvasState.scale
    );

    onUpdate({
      ...photo.canvasState,
      position: constrainedPosition
    });

    setDragStart(mousePos);
  };

  /**
   * Handle mouse up - stop dragging
   */
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  /**
   * Handle zoom/scale changes
   */
  const handleScaleChange = (newScale: number) => {
    if (!croppedImage || !photo?.canvasState) return;

    const clampedScale = Math.min(3, Math.max(0.1, newScale));
    
    // Adjust position to keep image centered when scaling
    const scaleDelta = clampedScale - photo.canvasState.scale;
    const centerOffsetX = (croppedImage.width * scaleDelta) / 2;
    const centerOffsetY = (croppedImage.height * scaleDelta) / 2;
    
    const newPosition = {
      x: photo.canvasState.position.x - centerOffsetX,
      y: photo.canvasState.position.y - centerOffsetY
    };

    const constrainedPosition = constrainPosition(
      newPosition,
      { width: croppedImage.width, height: croppedImage.height },
      canvasSize,
      clampedScale
    );

    onUpdate({
      ...photo.canvasState,
      position: constrainedPosition,
      scale: clampedScale
    });
  };

  /**
   * Handle brightness/contrast adjustments
   */
  const handleBrightnessChange = (brightness: number) => {
    onUpdate({
      ...photo.canvasState,
      brightness: Math.min(100, Math.max(-100, brightness))
    });
  };

  const handleContrastChange = (contrast: number) => {
    onUpdate({
      ...photo.canvasState,
      contrast: Math.min(2, Math.max(0.5, contrast))
    });
  };

  /**
   * Reset to default state
   */
  const handleReset = () => {
    if (!photo?.canvasState) return;
    onUpdate({
      ...photo.canvasState,
      position: { x: 0, y: 0 },
      scale: 1,
      brightness: 0,
      contrast: 1
    });
  };

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          width: size === 'grid' ? '100%' : 'auto',
          height: size === 'grid' ? '100%' : 'auto',
          maxWidth: '100%',
          maxHeight: '100%',
          cursor: isDragging ? 'grabbing' : 'grab',
          border: '1px solid',
          borderColor: size === 'grid' ? 'transparent' : '#e0e0e0',
          borderRadius: '4px',
          display: 'block'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Grid size hover tooltip */}
      {size === 'grid' && (
        <Tooltip title={`Photo ${label} - Drag to reposition`} placement="top">
          <Box sx={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            pointerEvents: 'none' 
          }} />
        </Tooltip>
      )}

      {/* Controls are now handled by the separate PhotoControls component */}

      {/* Photo label overlay for grid - clean Material UI styling */}
      {size === 'grid' && (
        <Box sx={{
          position: 'absolute',
          bottom: 4,
          left: 4,
          bgcolor: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          fontSize: '0.75rem',
          fontWeight: 600,
          px: 1,
          py: 0.25,
          borderRadius: 1,
          pointerEvents: 'none'
        }}>
          {label}
        </Box>
      )}
    </Box>
  );
};
