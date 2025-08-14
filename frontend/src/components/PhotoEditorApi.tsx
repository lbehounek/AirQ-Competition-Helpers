import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box, Tooltip } from '@mui/material';
import type { Photo } from '../types';

interface ApiPhoto {
  id: string;
  url?: string;
  sessionId?: string;
  filename: string;
  canvasState: Photo['canvasState'];
  label: string;
}

interface PhotoEditorApiProps {
  photo: ApiPhoto;
  label: string;
  onUpdate: (canvasState: Photo['canvasState']) => void;
  onRemove: () => void;
  size?: 'grid' | 'large';
}

// UNIFIED RENDERING SYSTEM - Same logic for grid and modal
const BASE_WIDTH = 300;
const BASE_HEIGHT = 225;

const cropImageTo43 = (image: HTMLImageElement): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  const targetAspect = 4 / 3;
  const imageAspect = image.width / image.height;
  
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  let sourceX = 0;
  let sourceY = 0;
  
  if (imageAspect > targetAspect) {
    sourceWidth = image.height * targetAspect;
    sourceX = (image.width - sourceWidth) / 2;
  } else if (imageAspect < targetAspect) {
    sourceHeight = image.width / targetAspect;
    sourceY = (image.height - sourceHeight) / 2;
  }
  
  canvas.width = 400; // Fixed size for consistency
  canvas.height = 300;
  
  ctx.drawImage(
    image,
    sourceX, sourceY, sourceWidth, sourceHeight,
    0, 0, canvas.width, canvas.height
  );
  
  return canvas;
};

const renderPhotoOnCanvas = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  canvasState: Photo['canvasState'],
  label: string,
  localPosition?: { x: number; y: number },
  localLabelPosition?: Photo['canvasState']['labelPosition'],
  isDragging = false
) => {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Crop to 4:3
  const croppedImage = cropImageTo43(image);
  
  // Calculate minimum scale based on BASE dimensions (not current canvas)
  // This ensures consistent scaling across different canvas sizes
  const minScaleX = BASE_WIDTH / croppedImage.width;
  const minScaleY = BASE_HEIGHT / croppedImage.height;
  const minScale = Math.max(minScaleX, minScaleY);
  const actualScale = Math.max(canvasState.scale, minScale);
  
  // Calculate scaled dimensions IN BASE COORDINATES
  const scaledWidth = croppedImage.width * actualScale;
  const scaledHeight = croppedImage.height * actualScale;
  
  // Use position (dragging position takes priority)
  const basePosition = isDragging && localPosition ? localPosition : canvasState.position;
  
  // Convert from base coordinates (300x225) to current canvas size
  // This ensures the same VIEW is shown regardless of canvas size
  const scaleRatio = canvas.width / BASE_WIDTH;
  
  // Scale position for display
  let x = basePosition.x * scaleRatio;
  let y = basePosition.y * scaleRatio;
  
  // Scale dimensions for display
  const displayWidth = scaledWidth * scaleRatio;
  const displayHeight = scaledHeight * scaleRatio;
  
  // Apply constraints using display dimensions
  if (displayWidth > canvas.width) {
    const maxX = displayWidth - canvas.width;
    x = Math.max(-maxX, Math.min(0, x));
  } else {
    x = (canvas.width - displayWidth) / 2;
  }
  
  if (displayHeight > canvas.height) {
    const maxY = displayHeight - canvas.height;
    y = Math.max(-maxY, Math.min(0, y));
  } else {
    y = (canvas.height - displayHeight) / 2;
  }
  
  // Apply adjustments and draw with display dimensions
  ctx.save();
  ctx.filter = `brightness(${1 + canvasState.brightness / 100}) contrast(${canvasState.contrast})`;
  ctx.drawImage(croppedImage, x, y, displayWidth, displayHeight);
  ctx.restore();
  
  // Draw label
  const fontSize = canvas.width > 400 ? 60 : 48;
  const padding = 12;
  const position = localLabelPosition || canvasState.labelPosition;
  
  ctx.save();
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 2;
  
  const metrics = ctx.measureText(label);
  const textWidth = metrics.width;
  const textHeight = fontSize;
  
  let labelX: number, labelY: number;
  
  switch (position) {
    case 'top-left':
      labelX = padding;
      labelY = padding + textHeight;
      break;
    case 'top-right':
      labelX = canvas.width - textWidth - padding;
      labelY = padding + textHeight;
      break;
    case 'bottom-right':
      labelX = canvas.width - textWidth - padding;
      labelY = canvas.height - padding;
      break;
    case 'bottom-left':
    default:
      labelX = padding;
      labelY = canvas.height - padding;
      break;
  }
  
  ctx.strokeText(label, labelX, labelY);
  ctx.fillText(label, labelX, labelY);
  ctx.restore();
};

export const PhotoEditorApi: React.FC<PhotoEditorApiProps> = ({
  photo,
  label,
  onUpdate,
  onRemove,
  size = 'grid'
}) => {
  if (!photo || !photo.canvasState) {
    return (
      <Box sx={{
        width: size === 'large' ? 400 : 240,
        height: size === 'large' ? 300 : 180,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'grey.50',
        border: '1px solid',
        borderColor: 'grey.300',
        borderRadius: '8px',
        color: 'grey.600'
      }}>
        No photo data
      </Box>
    );
  }

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [imageError, setImageError] = useState(false);
  
  // Local state for smooth dragging
  const [localPosition, setLocalPosition] = useState(photo.canvasState.position);
  const [localLabelPosition, setLocalLabelPosition] = useState(photo.canvasState.labelPosition);
  const pendingUpdateRef = useRef<NodeJS.Timeout | null>(null);

  // Canvas dimensions
  const canvasSize = size === 'large'
    ? { width: 600, height: 450 } // 2x scale for modal
    : { width: 300, height: 225 }; // Base size for grid

  // Load image
  useEffect(() => {
    if (!photo.id) return;

    const fullUrl = `http://localhost:8000/api/photos/${photo.sessionId || 'unknown'}/${photo.id}`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      setLoadedImage(img);
      setImageError(false);
    };
    
    img.onerror = () => {
      setImageError(true);
      setLoadedImage(null);
    };
    
    img.src = fullUrl;
    
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [photo.id, photo.sessionId]);

  // Sync local states when photo changes
  useEffect(() => {
    if (!isDragging) {
      setLocalPosition(photo.canvasState.position);
    }
    setLocalLabelPosition(photo.canvasState.labelPosition);
  }, [photo.canvasState.position, photo.canvasState.labelPosition, isDragging]);

  // Update local position when scale changes
  useEffect(() => {
    if (!isDragging) {
      setLocalPosition(photo.canvasState.position);
    }
  }, [photo.canvasState.scale, isDragging]);

  // Render canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loadedImage || !photo?.canvasState) return;

    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;

    renderPhotoOnCanvas(
      canvas,
      loadedImage,
      photo.canvasState,
      label,
      localPosition,
      localLabelPosition,
      isDragging
    );
  }, [loadedImage, photo?.canvasState, label, canvasSize, localPosition, localLabelPosition, isDragging]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Mouse handlers
  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (size === 'grid') return; // No dragging in grid view
    if (!loadedImage || !photo?.canvasState) return;

    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    setIsDragging(true);
    setDragStart({ x, y });
    event.preventDefault();
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !loadedImage || !photo?.canvasState) return;

    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const deltaX = x - dragStart.x;
    const deltaY = y - dragStart.y;

    // Convert deltas back to base coordinates for storage
    const scaleRatio = canvas.width / BASE_WIDTH;
    const newPosition = {
      x: localPosition.x + (deltaX / scaleRatio),
      y: localPosition.y + (deltaY / scaleRatio)
    };

    // Apply constraints in base coordinate system
    const croppedImage = cropImageTo43(loadedImage);
    const minScaleX = BASE_WIDTH / croppedImage.width;
    const minScaleY = BASE_HEIGHT / croppedImage.height;
    const minScale = Math.max(minScaleX, minScaleY);
    const actualScale = Math.max(photo.canvasState.scale, minScale);
    const scaledWidth = croppedImage.width * actualScale;
    const scaledHeight = croppedImage.height * actualScale;

    // Constrain in base coordinates (300x225)
    if (scaledWidth > BASE_WIDTH) {
      const maxX = scaledWidth - BASE_WIDTH;
      newPosition.x = Math.max(-maxX, Math.min(0, newPosition.x));
    }
    
    if (scaledHeight > BASE_HEIGHT) {
      const maxY = scaledHeight - BASE_HEIGHT;
      newPosition.y = Math.max(-maxY, Math.min(0, newPosition.y));
    }

    setLocalPosition(newPosition);
    setDragStart({ x, y });
    
    // Debounce API calls
    if (pendingUpdateRef.current) {
      clearTimeout(pendingUpdateRef.current);
    }
    
    pendingUpdateRef.current = setTimeout(() => {
      onUpdate({ ...photo.canvasState, position: newPosition });
    }, 50);
  };

  const handleMouseUp = () => {
    if (isDragging) {
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
      }
      onUpdate({ ...photo.canvasState, position: localPosition });
    }
    setIsDragging(false);
  };

  // Loading/error states
  if (imageError) {
    return (
      <Box sx={{
        width: size === 'large' ? 400 : '100%',
        height: size === 'large' ? 300 : '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'error.light',
        color: 'error.contrastText',
        borderRadius: 1
      }}>
        Failed to load image
      </Box>
    );
  }

  if (!loadedImage) {
    return (
      <Box sx={{
        width: size === 'large' ? 400 : '100%',
        height: size === 'large' ? 300 : '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'grey.100',
        color: 'grey.600',
        borderRadius: 1
      }}>
        Loading...
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: size === 'grid' ? '100%' : 'auto',
          height: size === 'grid' ? '100%' : 'auto',
          maxWidth: '100%',
          maxHeight: '100%',
          cursor: size === 'grid' ? 'pointer' : (isDragging ? 'grabbing' : 'grab'),
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

      {size === 'grid' && (
        <Tooltip title={`Photo ${label} - Click to edit`} placement="top">
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
    </Box>
  );
};