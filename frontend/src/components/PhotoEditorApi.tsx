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

  // Canvas dimensions based on size
  const canvasSize = size === 'large'
    ? { width: 400, height: 300 }
    : { width: 300, height: 225 }; // 4:3 aspect ratio

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
    const fontSize = size === 'large' ? 20 : 16;
    const padding = 8;
    
    ctx.save();
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3;
    
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
    
    // Draw text with outline
    ctx.strokeText(labelText, x, y);
    ctx.fillText(labelText, x, y);
    
    ctx.restore();
  }, [size]);

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
      
      // Calculate scaled dimensions
      const scale = photo.canvasState.scale;
      const scaledWidth = croppedImage.width * scale;
      const scaledHeight = croppedImage.height * scale;
      
      // Position with constraints
      const maxX = Math.max(0, scaledWidth - canvas.width);
      const maxY = Math.max(0, scaledHeight - canvas.height);
      const x = Math.max(-maxX, Math.min(0, photo.canvasState.position.x));
      const y = Math.max(-maxY, Math.min(0, photo.canvasState.position.y));
      
      // Apply image adjustments
      ctx.save();
      ctx.filter = `brightness(${1 + photo.canvasState.brightness / 100}) contrast(${photo.canvasState.contrast})`;
      
      // Draw the image
      ctx.drawImage(croppedImage, x, y, scaledWidth, scaledHeight);
      
      ctx.restore();
      
      // Draw the label
      drawLabel(ctx, label, photo.canvasState.labelPosition || 'bottom-left');
      
    } catch (error) {
      console.error('Error rendering canvas:', error);
    }
  }, [loadedImage, photo?.canvasState, label, canvasSize, cropImageTo43, drawLabel]);

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

    const newPosition = {
      x: photo.canvasState.position.x + deltaX,
      y: photo.canvasState.position.y + deltaY
    };

    onUpdate({ ...photo.canvasState, position: newPosition });
    setDragStart({ x, y });
  };

  const handleMouseUp = () => {
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
