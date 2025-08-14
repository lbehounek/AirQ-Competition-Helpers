import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box, Tooltip } from '@mui/material';
import type { Photo } from '../types';

interface ApiPhoto {
  id: string;
  url?: string; // Optional since we'll construct it ourselves
  sessionId?: string; // Add sessionId for URL construction
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

export const PhotoEditorApi: React.FC<PhotoEditorApiProps> = ({
  photo,
  label,
  onUpdate,
  onRemove,
  size = 'grid'
}) => {
  // Early return if photo data is invalid
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
  
  // Local state for smooth dragging and immediate label updates
  const [localPosition, setLocalPosition] = useState(photo.canvasState.position);
  const [localLabelPosition, setLocalLabelPosition] = useState(photo.canvasState.labelPosition);
  const pendingUpdateRef = useRef<NodeJS.Timeout | null>(null);

  // Canvas dimensions based on size - larger for modal view
  const canvasSize = size === 'large'
    ? { width: 600, height: 450 } // Much larger for modal
    : { width: 300, height: 225 }; // Keep grid size same

  /**
   * Load image from URL
   */
  useEffect(() => {
    if (!photo.id) return;

    // Use API client to get proper full URL
    const fullUrl = `http://localhost:8000/api/photos/${photo.sessionId || 'unknown'}/${photo.id}`;

    const img = new Image();
    img.crossOrigin = 'anonymous'; // Handle CORS if needed
    
    img.onload = () => {
      console.log('✅ Image loaded:', fullUrl);
      setLoadedImage(img);
      setImageError(false);
    };
    
    img.onerror = () => {
      console.error('❌ Failed to load image:', fullUrl);
      setImageError(true);
      setLoadedImage(null);
    };
    
    img.src = fullUrl;
    
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [photo.id, photo.sessionId]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
      }
    };
  }, []);

  /**
   * Auto-crop image to 4:3 aspect ratio
   */
  const cropImageTo43 = useCallback((image: HTMLImageElement): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    
    const targetAspect = 4 / 3;
    const imageAspect = image.width / image.height;
    
    let sourceWidth = image.width;
    let sourceHeight = image.height;
    let sourceX = 0;
    let sourceY = 0;
    
    if (imageAspect > targetAspect) {
      // Image is wider than 4:3, crop horizontally
      sourceWidth = image.height * targetAspect;
      sourceX = (image.width - sourceWidth) / 2;
    } else if (imageAspect < targetAspect) {
      // Image is taller than 4:3, crop vertically
      sourceHeight = image.width / targetAspect;
      sourceY = (image.height - sourceHeight) / 2;
    }
    
    // Set canvas to desired output size
    canvas.width = Math.min(sourceWidth, 800); // Max width for performance
    canvas.height = canvas.width / targetAspect;
    
    // Draw cropped image
    ctx.drawImage(
      image,
      sourceX, sourceY, sourceWidth, sourceHeight,
      0, 0, canvas.width, canvas.height
    );
    
    return canvas;
  }, []);

  /**
   * Draw label on canvas
   */
  const drawLabel = useCallback((
    ctx: CanvasRenderingContext2D,
    labelText: string,
    position: Photo['canvasState']['labelPosition'] = 'bottom-left'
  ) => {
    // 3x bigger font size
    const fontSize = size === 'large' ? 60 : 48;
    const padding = 12;
    
    ctx.save();
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    
    // Pure white fill with thin black border
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2; // Thin black border
    
    const metrics = ctx.measureText(labelText);
    const textWidth = metrics.width;
    const textHeight = fontSize;
    
    let x: number, y: number;
    
    switch (position) {
      case 'top-left':
        x = padding;
        y = padding + textHeight;
        break;
      case 'top-right':
        x = ctx.canvas.width - textWidth - padding;
        y = padding + textHeight;
        break;
      case 'bottom-right':
        x = ctx.canvas.width - textWidth - padding;
        y = ctx.canvas.height - padding;
        break;
      case 'bottom-left':
      default:
        x = padding;
        y = ctx.canvas.height - padding;
        break;
    }
    
    // Draw black outline first, then white text
    ctx.strokeText(labelText, x, y);
    ctx.fillText(labelText, x, y);
    
    ctx.restore();
  }, [size]);

  // Sync local states when photo changes from external updates
  useEffect(() => {
    if (!isDragging) {
      setLocalPosition(photo.canvasState.position);
    }
    setLocalLabelPosition(photo.canvasState.labelPosition);
  }, [photo.canvasState.position, photo.canvasState.labelPosition, isDragging]);

  // Update local position when scale changes (from zoom)
  useEffect(() => {
    if (!isDragging) {
      setLocalPosition(photo.canvasState.position);
    }
  }, [photo.canvasState.scale, isDragging]);

  // Force re-render when component props change (for grid sync after modal close)
  useEffect(() => {
    renderCanvas();
  }, [photo.canvasState]);

  /**
   * Calculate minimum scale to fill canvas without white borders
   */
  const getMinimumScale = useCallback((croppedImage: HTMLCanvasElement) => {
    if (!croppedImage) return 1;
    
    // Scale needed to fill width
    const scaleForWidth = canvasSize.width / croppedImage.width;
    // Scale needed to fill height  
    const scaleForHeight = canvasSize.height / croppedImage.height;
    
    // Use the larger scale to ensure no white borders
    return Math.max(scaleForWidth, scaleForHeight);
  }, [canvasSize]);

  /**
   * Render the canvas
   */
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loadedImage || !photo?.canvasState) return;

    try {
      // Set canvas size
      canvas.width = canvasSize.width;
      canvas.height = canvasSize.height;
      
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Auto-crop the loaded image
      const croppedImage = cropImageTo43(loadedImage);
      
      // Calculate minimum scale and ensure current scale is not below it
      const minScale = getMinimumScale(croppedImage);
      const actualScale = Math.max(photo.canvasState.scale, minScale);
      
      // Calculate scaled dimensions
      const scaledWidth = croppedImage.width * actualScale;
      const scaledHeight = croppedImage.height * actualScale;
      
      // Use local position for smooth dragging, fallback to photo state
      const currentPosition = isDragging ? localPosition : photo.canvasState.position;
      
      // Simple positioning - scale everything proportionally
      const scaleRatio = canvas.width / 300; // Scale factor relative to base size
      
      let x = currentPosition.x * scaleRatio;
      let y = currentPosition.y * scaleRatio;
      
      // Apply constraints
      if (scaledWidth > canvas.width) {
        const maxX = scaledWidth - canvas.width;
        x = Math.max(-maxX, Math.min(0, x));
      } else {
        x = (canvas.width - scaledWidth) / 2;
      }
      
      if (scaledHeight > canvas.height) {
        const maxY = scaledHeight - canvas.height;
        y = Math.max(-maxY, Math.min(0, y));
      } else {
        y = (canvas.height - scaledHeight) / 2;
      }
      
      // Apply image adjustments
      ctx.save();
      ctx.filter = `brightness(${1 + photo.canvasState.brightness / 100}) contrast(${photo.canvasState.contrast})`;
      
      // Draw the image
      ctx.drawImage(croppedImage, x, y, scaledWidth, scaledHeight);
      
      ctx.restore();
      
      // Draw the label using local state for immediate updates
      drawLabel(ctx, label, localLabelPosition || 'bottom-left');
      
    } catch (error) {
      console.error('Error rendering canvas:', error);
    }
  }, [loadedImage, photo?.canvasState, label, canvasSize, cropImageTo43, drawLabel, isDragging, localPosition, localLabelPosition, getMinimumScale]);

  /**
   * Re-render when dependencies change
   */
  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  /**
   * Mouse event handlers for dragging
   */
  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (size === 'grid') return; // No dragging in grid view - static preview only
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

    // Scale deltas back to base coordinates
    const scaleRatio = canvas.width / 300;
    
    let newPosition = {
      x: localPosition.x + (deltaX / scaleRatio),
      y: localPosition.y + (deltaY / scaleRatio)
    };

    // Apply constraints in base coordinate system
    const croppedImage = cropImageTo43(loadedImage);
    const minScale = getMinimumScale(croppedImage);
    const actualScale = Math.max(photo.canvasState.scale, minScale);
    const scaledWidth = croppedImage.width * actualScale;
    const scaledHeight = croppedImage.height * actualScale;

    // Constrain using base canvas size (300x225)
    if (scaledWidth > 300) {
      const maxX = scaledWidth - 300;
      newPosition.x = Math.max(-maxX, Math.min(0, newPosition.x));
    }
    
    if (scaledHeight > 225) {
      const maxY = scaledHeight - 225;
      newPosition.y = Math.max(-maxY, Math.min(0, newPosition.y));
    }

    // Update local state immediately for smooth dragging
    setLocalPosition(newPosition);
    setDragStart({ x, y });
    
    // Debounce API calls during drag
    if (pendingUpdateRef.current) {
      clearTimeout(pendingUpdateRef.current);
    }
    
    pendingUpdateRef.current = setTimeout(() => {
      onUpdate({ ...photo.canvasState, position: newPosition });
    }, 50); // Update backend every 50ms max during drag
  };

  const handleMouseUp = () => {
    if (isDragging) {
      // Immediately sync final position to backend
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
      }
      onUpdate({ ...photo.canvasState, position: localPosition });
    }
    setIsDragging(false);
  };

  // Show loading or error state
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
      {/* Canvas */}
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

      {/* Grid size hover tooltip */}
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

      {/* Remove duplicate label overlay - canvas label is sufficient */}
    </Box>
  );
};
