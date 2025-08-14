import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box, Tooltip } from '@mui/material';
import type { Photo } from '../types';
import { 
  applyWebGLEffects, 
  isWebGLSupported,
  type WebGLContext,
  type ImageAdjustments 
} from '../utils/webglUtils';
import { useWebGLContext } from '../utils/webglContextManager';
import { drawLabel, getCanvasContext } from '../utils/canvasUtils';

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
  const ctx = getCanvasContext(canvas);
  if (!ctx) {
    console.warn('Cannot crop image: invalid canvas context');
    return canvas; // Return empty canvas as fallback
  }
  
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
  isDragging = false,
  webglContext?: WebGLContext | null,
  webglManager?: { requestContext: () => WebGLContext | null; releaseContext: (ctx: WebGLContext) => void; isAvailable: boolean }
) => {
  const ctx = getCanvasContext(canvas);
  if (!ctx) {
    console.warn('Cannot render photo on invalid canvas');
    return;
  }
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
  
  // Create a temporary canvas for image processing
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = Math.ceil(displayWidth);
  tempCanvas.height = Math.ceil(displayHeight);
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) {
    // Fallback: just draw without effects
    ctx.drawImage(croppedImage, x, y, displayWidth, displayHeight);
    return;
  }
  
  // Draw the image to temp canvas
  tempCtx.drawImage(croppedImage, 0, 0, displayWidth, displayHeight);
  
  // Try WebGL acceleration first, fallback to CPU processing
  const sharpness = canvasState.sharpness || 0;
  const whiteBalance = canvasState.whiteBalance || { temperature: 0, tint: 0, auto: false };
  
  const needsProcessing = canvasState.brightness !== 0 || 
                         canvasState.contrast !== 1 || 
                         sharpness > 0 || 
                         whiteBalance.auto || 
                         whiteBalance.temperature !== 0 || 
                         whiteBalance.tint !== 0;

  // Request WebGL context on-demand only when processing is needed
  let webglContextToUse = webglContext;
  let shouldReleaseContext = false;
  
  if (needsProcessing && !webglContextToUse && webglManager && webglManager.isAvailable) {
    webglContextToUse = webglManager.requestContext();
    shouldReleaseContext = true; // Mark for release after processing
  }

  if (needsProcessing && webglContextToUse) {
    // Use WebGL acceleration
    try {
      const adjustments: ImageAdjustments = {
        brightness: canvasState.brightness,
        contrast: canvasState.contrast,
        sharpness: sharpness,
        temperature: whiteBalance.temperature,
        tint: whiteBalance.tint
      };
      
      const processedCanvas = applyWebGLEffects(tempCanvas, adjustments, webglContextToUse);
      
      // Release context if it was requested on-demand
      if (shouldReleaseContext && webglManager) {
        webglManager.releaseContext(webglContextToUse);
      }
      
      if (processedCanvas) {
        // Success! Use the WebGL-processed result
        ctx.drawImage(processedCanvas, x, y);
        // Draw label on main canvas
        const labelPos = isDragging && localLabelPosition ? localLabelPosition : canvasState.labelPosition;
        drawLabel(ctx, label, labelPos, canvas.width, canvas.height);
        return;
      }
    } catch (error) {
      console.warn('WebGL processing failed, falling back to CPU:', error);
      // Release context if it was requested on-demand (in case of error)
      if (shouldReleaseContext && webglManager) {
        webglManager.releaseContext(webglContextToUse);
      }
    }
  }

  // CPU fallback processing
  if (!needsProcessing) {
    // No processing needed, just draw
    ctx.drawImage(tempCanvas, x, y);
  } else {
    // Apply CPU-based image processing
    try {
      let imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      let data = imageData.data;
    
    // Apply white balance first (if needed)
    if (canvasState.whiteBalance?.auto || 
        canvasState.whiteBalance?.temperature !== 0 || 
        canvasState.whiteBalance?.tint !== 0) {
      
      if (canvasState.whiteBalance?.auto) {
        // Auto white balance: Calculate average color and neutralize
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] === 0) continue; // Skip transparent
          rSum += data[i];
          gSum += data[i + 1];
          bSum += data[i + 2];
          count++;
        }
        
        if (count > 0) {
          const rAvg = rSum / count;
          const gAvg = gSum / count;
          const bAvg = bSum / count;
          const gray = (rAvg + gAvg + bAvg) / 3;
          
          const rScale = gray / rAvg;
          const gScale = gray / gAvg;
          const bScale = gray / bAvg;
          
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] === 0) continue;
            data[i] = Math.min(255, data[i] * rScale);
            data[i + 1] = Math.min(255, data[i + 1] * gScale);
            data[i + 2] = Math.min(255, data[i + 2] * bScale);
          }
        }
      } else {
        // Manual white balance adjustments
        const temp = canvasState.whiteBalance?.temperature || 0;
        const tint = canvasState.whiteBalance?.tint || 0;
        
        // Temperature: negative = blue, positive = yellow
        const rTemp = temp > 0 ? temp * 1.5 : 0;
        const bTemp = temp < 0 ? -temp * 1.5 : 0;
        
        // Tint: negative = green, positive = magenta
        const gTint = tint < 0 ? -tint : 0;
        const mTint = tint > 0 ? tint * 0.5 : 0;
        
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] === 0) continue;
          
          // Apply temperature
          data[i] = Math.max(0, Math.min(255, data[i] + rTemp - bTemp));     // Red
          data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + bTemp - rTemp)); // Blue
          
          // Apply tint
          data[i] = Math.max(0, Math.min(255, data[i] + mTint));     // Red (magenta)
          data[i + 1] = Math.max(0, Math.min(255, data[i + 1] - gTint + gTint)); // Green
          data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + mTint)); // Blue (magenta)
        }
      }
    }
    
    // Apply brightness and contrast
    if (canvasState.brightness !== 0 || canvasState.contrast !== 1) {
      const brightnessAdjust = canvasState.brightness * 2.55;
      const contrastFactor = canvasState.contrast;
      
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        
        // Apply contrast first, then brightness
        data[i] = (data[i] - 128) * contrastFactor + 128 + brightnessAdjust;
        data[i + 1] = (data[i + 1] - 128) * contrastFactor + 128 + brightnessAdjust;
        data[i + 2] = (data[i + 2] - 128) * contrastFactor + 128 + brightnessAdjust;
        
        // Clamp values
        data[i] = Math.max(0, Math.min(255, data[i]));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1]));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2]));
      }
    }
    
    // Apply sharpness using convolution kernel
    if (canvasState.sharpness && canvasState.sharpness > 0) {
      // Create a copy of the data for convolution
      const originalData = new Uint8ClampedArray(data);
      const width = tempCanvas.width;
      const height = tempCanvas.height;
      
      // Sharpness kernel (adjustable strength)
      const strength = canvasState.sharpness / 100; // 0 to 1
      const kernel = [
        0, -strength, 0,
        -strength, 1 + 4 * strength, -strength,
        0, -strength, 0
      ];
      
      // Apply convolution (skip edges for simplicity)
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = (y * width + x) * 4;
          
          if (originalData[idx + 3] === 0) continue; // Skip transparent
          
          for (let c = 0; c < 3; c++) { // RGB channels
            let sum = 0;
            
            // Apply kernel
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                const kidx = ((y + ky) * width + (x + kx)) * 4;
                const kval = kernel[(ky + 1) * 3 + (kx + 1)];
                sum += originalData[kidx + c] * kval;
              }
            }
            
            data[idx + c] = Math.max(0, Math.min(255, sum));
          }
        }
      }
    }
    
    tempCtx.putImageData(imageData, 0, 0);
  } catch (error) {
    console.error('Error applying image adjustments:', error);
    // If we can't apply effects (CORS etc), just use the original image
  }
  
    // Draw the processed image from temp canvas to main canvas
    ctx.drawImage(tempCanvas, x, y);
  }
  
  // Draw label on main canvas (for both WebGL and CPU paths)
  const labelPos = isDragging && localLabelPosition ? localLabelPosition : canvasState.labelPosition;
  drawLabel(ctx, label, labelPos, canvas.width, canvas.height);
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
  
  // WebGL context management
  const webglManager = useWebGLContext();
  const webglContextRef = useRef<WebGLContext | null>(null);
  const [webglSupported, setWebglSupported] = useState<boolean>(false);

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
      isDragging,
      webglContextRef.current,
      webglManager
    );
  }, [loadedImage, photo?.canvasState, photo?.canvasState?.brightness, photo?.canvasState?.contrast, photo?.canvasState?.scale, label, canvasSize, localPosition, localLabelPosition, isDragging, webglManager]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Initialize WebGL support detection
  useEffect(() => {
    setWebglSupported(isWebGLSupported());
  }, []);

  // WebGL context lifecycle management
  useEffect(() => {
    // Cleanup on unmount - return context to pool if we have one
    return () => {
      if (webglContextRef.current) {
        webglManager.releaseContext(webglContextRef.current);
        webglContextRef.current = null;
      }
    };
  }, [webglManager]);

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

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (size === 'grid') return; // Only allow zoom in modal view
    if (!loadedImage || !photo?.canvasState) return;

    event.preventDefault(); // Prevent page scrolling

    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Calculate zoom direction and amount
    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9; // Zoom in/out by 10%
    const currentScale = photo.canvasState.scale;
    const newScale = Math.max(1.0, Math.min(3.0, currentScale * zoomFactor)); // Clamp between 1.0 and 3.0

    if (Math.abs(newScale - currentScale) < 0.01) return; // No significant change

    // Calculate zoom center in base coordinates
    const scaleRatio = canvas.width / BASE_WIDTH;
    const baseCenterX = mouseX / scaleRatio;
    const baseCenterY = mouseY / scaleRatio;

    // Calculate position adjustment to zoom towards mouse cursor
    const scaleChange = newScale / currentScale;
    const currentPosition = photo.canvasState.position;
    
    const newPosition = {
      x: baseCenterX + (currentPosition.x - baseCenterX) * scaleChange,
      y: baseCenterY + (currentPosition.y - baseCenterY) * scaleChange
    };

    // Apply constraints in base coordinates
    const croppedImage = cropImageTo43(loadedImage);
    const minScaleX = BASE_WIDTH / croppedImage.width;
    const minScaleY = BASE_HEIGHT / croppedImage.height;
    const minScale = Math.max(minScaleX, minScaleY);
    const actualScale = Math.max(newScale, minScale);
    const scaledWidth = croppedImage.width * actualScale;
    const scaledHeight = croppedImage.height * actualScale;

    // Constrain position
    if (scaledWidth > BASE_WIDTH) {
      const maxX = scaledWidth - BASE_WIDTH;
      newPosition.x = Math.max(-maxX, Math.min(0, newPosition.x));
    }
    
    if (scaledHeight > BASE_HEIGHT) {
      const maxY = scaledHeight - BASE_HEIGHT;
      newPosition.y = Math.max(-maxY, Math.min(0, newPosition.y));
    }

    // Update canvas state
    onUpdate({
      ...photo.canvasState,
      scale: newScale,
      position: newPosition
    });
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
        onWheel={handleWheel}
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