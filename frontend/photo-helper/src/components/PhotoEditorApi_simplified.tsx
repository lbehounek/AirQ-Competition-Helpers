import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box, Tooltip } from '@mui/material';
import type { Photo } from '../types';
import { drawLabel, getCanvasContext } from '../utils/canvasUtils';
import { useAspectRatio } from '../contexts/AspectRatioContext';
import { useCachedImage } from '../utils/imageCache';
import type { ApiPhoto } from '../types/api';

interface PhotoEditorApiProps {
  photo: ApiPhoto;
  label: string;
  onUpdate: (canvasState: Photo['canvasState']) => void;
  onRemove: () => void;
  size?: 'grid' | 'large';
  setKey?: 'set1' | 'set2';
  showOriginal?: boolean;
  circleMode?: boolean;
}

// Simplified rendering options
interface RenderOptions {
  position?: { x: number; y: number };
  labelPosition?: Photo['canvasState']['labelPosition'];
  showOriginal?: boolean;
}

const renderPhotoOnCanvas = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  canvasState: Photo['canvasState'],
  label: string,
  options: RenderOptions = {}
) => {
  const ctx = getCanvasContext(canvas);
  if (!ctx) {
    console.warn('Cannot render photo on invalid canvas');
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Use provided position or canvas state position
  const position = options.position || canvasState.position;
  
  // Calculate scale to fit image to canvas while maintaining aspect ratio
  const scaleToFit = Math.max(
    canvas.width / image.width,
    canvas.height / image.height
  );
  
  // Apply user's zoom scale on top of the fit scale
  const totalScale = scaleToFit * canvasState.scale;
  
  // Calculate final image dimensions
  const scaledWidth = image.width * totalScale;
  const scaledHeight = image.height * totalScale;
  
  // Calculate position with constraints (viewport-style panning)
  let x = position.x;
  let y = position.y;
  
  // Constrain to keep image within viewport bounds
  if (scaledWidth > canvas.width) {
    const maxOffset = scaledWidth - canvas.width;
    x = Math.max(-maxOffset, Math.min(0, x));
  } else {
    x = (canvas.width - scaledWidth) / 2;
  }
  
  if (scaledHeight > canvas.height) {
    const maxOffset = scaledHeight - canvas.height;
    y = Math.max(-maxOffset, Math.min(0, y));
  } else {
    y = (canvas.height - scaledHeight) / 2;
  }
  
  // Check if we need image processing
  const needsProcessing = !options.showOriginal && (
    canvasState.brightness !== 0 || 
    canvasState.contrast !== 1
  );
  
  if (!needsProcessing) {
    // Simple case: just draw the image directly
    ctx.drawImage(image, x, y, scaledWidth, scaledHeight);
  } else {
    // Complex case: need image processing - create temporary canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.ceil(scaledWidth);
    tempCanvas.height = Math.ceil(scaledHeight);
    const tempCtx = getCanvasContext(tempCanvas);
    if (!tempCtx) {
      // Fallback: just draw without effects
      ctx.drawImage(image, x, y, scaledWidth, scaledHeight);
      return;
    }
    
    // Draw image to temp canvas for processing
    tempCtx.drawImage(image, 0, 0, scaledWidth, scaledHeight);
    
    // Apply basic image processing (simplified)
    if (canvasState.brightness !== 0 || canvasState.contrast !== 1) {
      const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const data = imageData.data;
      
      const brightnessFactor = canvasState.brightness;
      const contrastFactor = canvasState.contrast;
      const midpoint = 128;
      
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue; // Skip transparent pixels
        
        // Apply brightness and contrast
        let r = data[i] + brightnessFactor;
        let g = data[i + 1] + brightnessFactor;
        let b = data[i + 2] + brightnessFactor;
        
        r = midpoint + (r - midpoint) * contrastFactor;
        g = midpoint + (g - midpoint) * contrastFactor;
        b = midpoint + (b - midpoint) * contrastFactor;
        
        data[i] = Math.max(0, Math.min(255, r));
        data[i + 1] = Math.max(0, Math.min(255, g));
        data[i + 2] = Math.max(0, Math.min(255, b));
      }
      
      tempCtx.putImageData(imageData, 0, 0);
    }
    
    // Draw processed image to main canvas
    ctx.drawImage(tempCanvas, x, y);
  }
  
  // Draw label
  const labelPos = options.labelPosition || canvasState.labelPosition;
  drawLabel(canvas, label, labelPos);
};

// Simplified constraint function
const constrainPosition = (
  position: { x: number; y: number },
  imageSize: { width: number; height: number },
  canvasSize: { width: number; height: number },
  scale: number = 1
): { x: number; y: number } => {
  const scaleToFit = Math.max(
    canvasSize.width / imageSize.width,
    canvasSize.height / imageSize.height
  );
  
  const totalScale = scaleToFit * scale;
  const scaledWidth = imageSize.width * totalScale;
  const scaledHeight = imageSize.height * totalScale;
  
  let x = position.x;
  let y = position.y;
  
  // Constrain X
  if (scaledWidth > canvasSize.width) {
    const maxOffset = scaledWidth - canvasSize.width;
    x = Math.max(-maxOffset, Math.min(0, x));
  } else {
    x = (canvasSize.width - scaledWidth) / 2;
  }
  
  // Constrain Y  
  if (scaledHeight > canvasSize.height) {
    const maxOffset = scaledHeight - canvasSize.height;
    y = Math.max(-maxOffset, Math.min(0, y));
  } else {
    y = (canvasSize.height - scaledHeight) / 2;
  }
  
  return { x, y };
};

export const PhotoEditorApi: React.FC<PhotoEditorApiProps> = ({
  photo,
  label,
  onUpdate,
  onRemove,
  size = 'grid',
  setKey,
  showOriginal = false,
  circleMode: externalCircleMode = false
}) => {
  const { currentRatio, getCanvasSize } = useAspectRatio();
  
  // Dynamic canvas sizes based on aspect ratio
  const gridCanvasSize = getCanvasSize(240);
  const largeCanvasSize = getCanvasSize(600);
  const canvasSize = size === 'large' ? largeCanvasSize : gridCanvasSize;
  
  if (!photo || !photo.canvasState) {
    return (
      <Box sx={{
        width: canvasSize.width,
        height: canvasSize.height,
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
  const [localPosition, setLocalPosition] = useState(photo.canvasState.position);
  
  // Use cached image loading
  const { image: loadedImage, error: imageError } = useCachedImage(
    photo.id,
    photo.sessionId
  );
  
  // Update local position when canvas state changes
  useEffect(() => {
    setLocalPosition(photo.canvasState.position);
  }, [photo.canvasState.position]);
  
  // Render canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loadedImage || !photo?.canvasState) return;

    renderPhotoOnCanvas(
      canvas,
      loadedImage,
      photo.canvasState,
      label,
      {
        position: localPosition,
        showOriginal
      }
    );
  }, [loadedImage, photo.canvasState, label, localPosition, showOriginal]);

  // Re-render when dependencies change
  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Mouse event handlers
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
      x: localPosition.x + deltaX,
      y: localPosition.y + deltaY
    };

    // Apply constraints
    const constrainedPosition = constrainPosition(
      newPosition,
      { width: loadedImage.width, height: loadedImage.height },
      canvasSize,
      photo.canvasState.scale
    );

    setLocalPosition(constrainedPosition);
    setDragStart({ x, y });
    
    // Debounced update
    setTimeout(() => {
      onUpdate({ ...photo.canvasState, position: constrainedPosition });
    }, 16);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  if (imageError) {
    return (
      <Box sx={{
        width: canvasSize.width,
        height: canvasSize.height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'error.light',
        color: 'error.contrastText',
        borderRadius: '8px'
      }}>
        Failed to load image
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'relative', display: 'inline-block' }}>
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        style={{
          display: 'block',
          border: '1px solid #ddd',
          borderRadius: '8px',
          cursor: isDragging ? 'grabbing' : 'grab'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </Box>
  );
};
