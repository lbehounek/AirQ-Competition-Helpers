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
import { useAspectRatio } from '../contexts/AspectRatioContext';
import { useCachedImage } from '../utils/imageCache';

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
  setKey?: 'set1' | 'set2'; // For PDF generation canvas identification
  showOriginal?: boolean; // Whether to show original (no effects) or edited version
  circleMode?: boolean; // Whether circle mode is enabled
}

// UNIFIED RENDERING SYSTEM - Same logic for grid and modal
const BASE_WIDTH = 300;

const cropImageToAspectRatio = (image: HTMLImageElement, targetAspect: number, canvasSize: { width: number; height: number }): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  const ctx = getCanvasContext(canvas);
  if (!ctx) {
    console.warn('Cannot crop image: invalid canvas context');
    return canvas; // Return empty canvas as fallback
  }
  
  const imageAspect = image.width / image.height;
  
  // Calculate what part of the source image to crop to achieve target aspect ratio
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  let sourceX = 0;
  let sourceY = 0;
  
  if (imageAspect > targetAspect) {
    // Image is wider than target - crop width (keep full height)
    sourceWidth = Math.round(image.height * targetAspect);
    sourceX = Math.round((image.width - sourceWidth) / 2);
  } else if (imageAspect < targetAspect) {
    // Image is taller than target - crop height (keep full width)  
    sourceHeight = Math.round(image.width / targetAspect);
    sourceY = Math.round((image.height - sourceHeight) / 2);
  }
  
  // Set canvas to the exact dimensions expected by calling code
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;
  
  // Draw the cropped portion of the source image to fill the canvas
  // The cropped source portion already has the correct aspect ratio
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
  webglManager?: { requestContext: () => WebGLContext | null; releaseContext: (ctx: WebGLContext) => void; isAvailable: boolean },
  aspectRatio = 4/3,
  baseHeight = 225,
  showOriginal = false
) => {
  const ctx = getCanvasContext(canvas);
  if (!ctx) {
    console.warn('Cannot render photo on invalid canvas');
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Crop to current aspect ratio
  const croppedImage = cropImageToAspectRatio(image, aspectRatio, { width: BASE_WIDTH, height: baseHeight });
  
  // Calculate minimum scale based on BASE dimensions (not current canvas)
  // This ensures consistent scaling across different canvas sizes
  const minScaleX = BASE_WIDTH / croppedImage.width;
  const minScaleY = baseHeight / croppedImage.height;
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
  const tempCtx = getCanvasContext(tempCanvas);
  if (!tempCtx) {
    // Fallback: just draw without effects
    ctx.drawImage(croppedImage, x, y, displayWidth, displayHeight);
    return;
  }
  
  // Draw the image to temp canvas
  tempCtx.drawImage(croppedImage, 0, 0, displayWidth, displayHeight);
  
  // Skip processing if showing original
  const sharpness = canvasState.sharpness || 0;
  const whiteBalance = canvasState.whiteBalance || { temperature: 0, tint: 0, auto: false };
  
  const needsProcessing = !showOriginal && (
    canvasState.brightness !== 0 || 
    canvasState.contrast !== 1 || 
    sharpness > 0 || 
    whiteBalance.auto || 
    whiteBalance.temperature !== 0 || 
    whiteBalance.tint !== 0
  );

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
        drawLabel(canvas, label, labelPos);
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
  drawLabel(canvas, label, labelPos);
};

// Draw circle overlay on canvas
const drawCircle = (canvas: HTMLCanvasElement, circle: { x: number; y: number; radius: number; color: string }, scaleRatio: number) => {
  const ctx = getCanvasContext(canvas);
  if (!ctx || !circle) return;
  
  // Convert from base coordinates to canvas coordinates
  const canvasX = circle.x * scaleRatio;
  const canvasY = circle.y * scaleRatio;
  const canvasRadius = circle.radius * scaleRatio;
  
  ctx.save();
  
  // Set circle style based on color
  ctx.strokeStyle = circle.color;
  // Scale line width based on canvas size for consistent visual proportion
  // Base: 1px for 300px canvas, 2px for 600px canvas
  ctx.lineWidth = Math.max(1, Math.round(canvas.width / 300));
  ctx.fillStyle = 'transparent';
  
  // Add outline for better visibility
  if (circle.color === 'white') {
    // White circle with black outline
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
  } else {
    // Colored circles with white outline
    ctx.shadowColor = 'white';
    ctx.shadowBlur = 1;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
  
  // Draw the circle
  ctx.beginPath();
  ctx.arc(canvasX, canvasY, canvasRadius, 0, 2 * Math.PI);
  ctx.stroke();
  
  ctx.restore();
};

// Draw semi-transparent circle preview
const drawCirclePreview = (canvas: HTMLCanvasElement, circle: { x: number; y: number; radius: number; color: string; opacity?: number }, scaleRatio: number) => {
  const ctx = getCanvasContext(canvas);
  if (!ctx || !circle) return;
  
  // Convert from base coordinates to canvas coordinates
  const canvasX = circle.x * scaleRatio;
  const canvasY = circle.y * scaleRatio;
  const canvasRadius = circle.radius * scaleRatio;
  
  ctx.save();
  
  // Set circle style - solid red with full opacity
  ctx.globalAlpha = circle.opacity || 1.0;
  ctx.strokeStyle = circle.color;
  // Scale line width based on canvas size for consistent visual proportion
  ctx.lineWidth = Math.max(1, Math.round(canvas.width / 300));
  ctx.fillStyle = 'transparent';
  
  // Add white shadow for better visibility (same as actual circle)
  ctx.shadowColor = 'white';
  ctx.shadowBlur = 1;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  
  // Draw the circle (solid, no dashing)
  ctx.beginPath();
  ctx.arc(canvasX, canvasY, canvasRadius, 0, 2 * Math.PI);
  ctx.stroke();
  
  ctx.restore();
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
  const largeCanvasSize = getCanvasSize(600); // Match the canvas size used below
  
  if (!photo || !photo.canvasState) {
    return (
      <Box sx={{
        width: size === 'large' ? largeCanvasSize.width : gridCanvasSize.width,
        height: size === 'large' ? largeCanvasSize.height : gridCanvasSize.height,
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
  const [circleMode, setCircleMode] = useState(externalCircleMode);
  const [isDraggingCircle, setIsDraggingCircle] = useState(false);
  const [circlePreview, setCirclePreview] = useState<{ x: number; y: number } | null>(null);
  const [circleStartPos, setCircleStartPos] = useState<{ x: number; y: number } | null>(null);  // Track initial circle position for click vs drag
  const [localCirclePosition, setLocalCirclePosition] = useState<{ x: number; y: number } | null>(null);  // Local circle position for smooth dragging
  
  // Use cached image loading
  const { image: loadedImage, error: imageError } = useCachedImage(
    photo.id,
    photo.sessionId || 'unknown'
  );
  
  // Local state for smooth dragging
  const [localPosition, setLocalPosition] = useState(photo.canvasState.position);
  const [localLabelPosition, setLocalLabelPosition] = useState(photo.canvasState.labelPosition);
  const pendingUpdateRef = useRef<number | null>(null);
  const lastMoveTimeRef = useRef<number>(0);
  
  // WebGL context management
  const webglManager = useWebGLContext();
  const [webglSupported, setWebglSupported] = useState<boolean>(false);

  // Dynamic canvas dimensions based on aspect ratio
  const canvasSize = size === 'large'
    ? getCanvasSize(600) // 2x scale for modal
    : getCanvasSize(300); // Base size for grid

  // Image is now loaded via useCachedImage hook above

  // Sync local states when photo changes
  useEffect(() => {
    if (!isDragging) {
      setLocalPosition(photo.canvasState.position);
    }
    setLocalLabelPosition(photo.canvasState.labelPosition);
  }, [photo.canvasState.position, photo.canvasState.labelPosition, isDragging]);

  // Sync with external circle mode
  useEffect(() => {
    setCircleMode(externalCircleMode);
    // Clear preview when mode changes
    if (!externalCircleMode) {
      setCirclePreview(null);
    }
  }, [externalCircleMode]);

  // Update local position when scale changes
  useEffect(() => {
    if (!isDragging) {
      setLocalPosition(photo.canvasState.position);
    }
  }, [photo.canvasState.scale, isDragging]);

  // Handle auto white balance calculation
  useEffect(() => {
    if (!photo.canvasState.whiteBalance?.auto || !loadedImage || !canvasRef.current) return;

    // Create a temporary canvas to analyze the image
    const tempCanvas = document.createElement('canvas');
    const baseHeight = BASE_WIDTH / currentRatio.ratio;
    const croppedImage = cropImageToAspectRatio(loadedImage, currentRatio.ratio, { width: BASE_WIDTH, height: baseHeight });
    tempCanvas.width = croppedImage.width;
    tempCanvas.height = croppedImage.height;
    const tempCtx = getCanvasContext(tempCanvas);
    
    if (!tempCtx) return;
    
    tempCtx.drawImage(croppedImage, 0, 0);
    
    try {
      const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const data = imageData.data;
      
      // Calculate average color values
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      
      // Sample every 10th pixel for performance
      for (let i = 0; i < data.length; i += 40) { // Skip 10 pixels (4 bytes per pixel)
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
        
        // Calculate color temperature correction
        // Red/Blue imbalance indicates temperature
        const rbRatio = rAvg / bAvg;
        let temperature = 0;
        if (rbRatio > 1) {
          // Image is too warm (red), need cooling (negative temperature)
          temperature = -Math.min(100, (rbRatio - 1) * 50);
        } else if (rbRatio < 1) {
          // Image is too cool (blue), need warming (positive temperature)
          temperature = Math.min(100, (1 - rbRatio) * 50);
        }
        
        // Calculate tint correction
        // Green imbalance indicates tint
        const greenBalance = gAvg / gray;
        let tint = 0;
        if (greenBalance > 1) {
          // Too much green, need magenta (positive tint)
          tint = Math.min(100, (greenBalance - 1) * 50);
        } else if (greenBalance < 1) {
          // Too little green, need more green (negative tint)
          tint = -Math.min(100, (1 - greenBalance) * 50);
        }
        
        // Update with calculated values and turn off auto
        onUpdate({
          ...photo.canvasState,
          whiteBalance: {
            temperature: Math.round(temperature),
            tint: Math.round(tint),
            auto: false // Turn off auto so user can further adjust
          }
        });
      }
    } catch (error) {
      console.error('Error calculating auto white balance:', error);
      // Reset auto flag on error
      onUpdate({
        ...photo.canvasState,
        whiteBalance: {
          ...photo.canvasState.whiteBalance,
          auto: false
        }
      });
    }
  }, [photo.canvasState.whiteBalance?.auto, loadedImage, onUpdate]);

  // Render canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loadedImage || !photo?.canvasState) return;

    // Create a temporary canvas for atomic rendering to prevent distortion flash
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvasSize.width;
    tempCanvas.height = canvasSize.height;

    // Render to temporary canvas first
    renderPhotoOnCanvas(
      tempCanvas,
      loadedImage,
      photo.canvasState,
      label,
      localPosition,
      localLabelPosition,
      isDragging,
      null, // WebGL context will be requested on-demand in renderCanvas
      webglManager,
      currentRatio.ratio,
      BASE_WIDTH / currentRatio.ratio,  // Always use BASE dimensions for consistent cropping
      showOriginal // Pass the showOriginal parameter
    );

    // Draw circle overlay if it exists
    if (photo.canvasState.circle && photo.canvasState.circle.visible) {
      const scaleRatio = canvasSize.width / BASE_WIDTH;
      // Use local position during dragging for smooth feedback
      const circleToRender = isDraggingCircle && localCirclePosition 
        ? { ...photo.canvasState.circle, x: localCirclePosition.x, y: localCirclePosition.y }
        : photo.canvasState.circle;
      drawCircle(tempCanvas, circleToRender, scaleRatio);
    }
    
    // Draw circle preview if in circle mode without existing circle
    if (circleMode && !photo.canvasState.circle && circlePreview) {
      const scaleRatio = canvasSize.width / BASE_WIDTH;
      const previewCircle = {
        x: circlePreview.x,
        y: circlePreview.y,
        radius: 55, // Default radius
        color: 'red' // Full opacity - exactly like the final circle
      };
      drawCirclePreview(tempCanvas, previewCircle, scaleRatio);
    }

    // Atomically update the visible canvas - no distortion flash
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const ctx = getCanvasContext(canvas);
    if (ctx) {
      ctx.drawImage(tempCanvas, 0, 0);
    }
  }, [loadedImage, photo?.canvasState, photo?.canvasState?.brightness, photo?.canvasState?.contrast, photo?.canvasState?.scale, photo?.canvasState?.circle, label, canvasSize, localPosition, localLabelPosition, isDragging, isDraggingCircle, localCirclePosition, webglManager, currentRatio, showOriginal, circleMode, circlePreview]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Initialize WebGL support detection
  useEffect(() => {
    const supported = isWebGLSupported();
    setWebglSupported(supported);
  }, []);

  // Document-level drag handling for better UX
  useEffect(() => {
    if ((!isDragging && !isDraggingCircle) || !canvasRef.current || !loadedImage) return;

    // Mouse move handler - no throttling for smoother movement
    const handleDocumentMouseMove = (e: MouseEvent) => {

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      
      // Option A: Clamp to canvas bounds for smooth edges
      const x = Math.max(0, Math.min(rect.width, rawX));
      const y = Math.max(0, Math.min(rect.height, rawY));

      const deltaX = x - dragStart.x;
      const deltaY = y - dragStart.y;

      // Handle circle dragging
      if (isDraggingCircle && photo.canvasState.circle) {
        const scaleRatio = canvas.width / BASE_WIDTH;
        const baseX = x / scaleRatio;
        const baseY = y / scaleRatio;
        
        // Constrain circle to canvas bounds
        const constrainedX = Math.max(photo.canvasState.circle.radius, Math.min(BASE_WIDTH - photo.canvasState.circle.radius, baseX));
        const constrainedY = Math.max(photo.canvasState.circle.radius, Math.min(BASE_WIDTH / currentRatio.ratio - photo.canvasState.circle.radius, baseY));
        
        // Update local position immediately for smooth visual feedback
        setLocalCirclePosition({ x: constrainedX, y: constrainedY });
        
        // Debounce the actual state update to reduce re-renders
        if (pendingUpdateRef.current) {
          clearTimeout(pendingUpdateRef.current);
        }
        pendingUpdateRef.current = setTimeout(() => {
          onUpdate({
            ...photo.canvasState,
            circle: {
              ...photo.canvasState.circle,
              x: constrainedX,
              y: constrainedY
            }
          });
        }, 16); // Update every ~16ms (60fps)
        
        // Clear the start position since we're actually dragging now
        setCircleStartPos(null);
        setDragStart({ x, y });
        return;
      }

      // Convert deltas back to base coordinates for storage
      const scaleRatio = canvas.width / BASE_WIDTH;
      const baseDeltaX = deltaX / scaleRatio;
      const baseDeltaY = deltaY / scaleRatio;
      
      // Calculate new position for each axis independently
      const newPosition = {
        x: localPosition.x + baseDeltaX,
        y: localPosition.y + baseDeltaY
      };

      // Apply constraints in base coordinate system
      const baseHeight = BASE_WIDTH / currentRatio.ratio;
      const croppedImage = cropImageToAspectRatio(loadedImage, currentRatio.ratio, { width: BASE_WIDTH, height: baseHeight });
      const minScaleX = BASE_WIDTH / croppedImage.width;
      const minScaleY = baseHeight / croppedImage.height;
      const minScale = Math.max(minScaleX, minScaleY);
      const actualScale = Math.max(photo.canvasState.scale, minScale);
      const scaledWidth = croppedImage.width * actualScale;
      const scaledHeight = croppedImage.height * actualScale;

      // Track which axes actually moved after constraints
      let actualDeltaX = 0;
      let actualDeltaY = 0;
      
      // Constrain X axis independently
      if (scaledWidth > BASE_WIDTH) {
        const maxX = scaledWidth - BASE_WIDTH;
        const constrainedX = Math.max(-maxX, Math.min(0, newPosition.x));
        actualDeltaX = constrainedX - localPosition.x;
        newPosition.x = constrainedX;
      } else {
        newPosition.x = (BASE_WIDTH - scaledWidth) / 2;
        actualDeltaX = 0;
      }
      
      // Constrain Y axis independently
      if (scaledHeight > baseHeight) {
        const maxY = scaledHeight - baseHeight;
        const constrainedY = Math.max(-maxY, Math.min(0, newPosition.y));
        actualDeltaY = constrainedY - localPosition.y;
        newPosition.y = constrainedY;
      } else {
        newPosition.y = (baseHeight - scaledHeight) / 2;
        actualDeltaY = 0;
      }

      setLocalPosition(newPosition);
      
      // Only update dragStart for axes that actually moved
      const newDragStart = {
        x: actualDeltaX !== 0 ? x : dragStart.x,
        y: actualDeltaY !== 0 ? y : dragStart.y
      };
      setDragStart(newDragStart);
      
      // Debounce API calls
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
      }
      
      pendingUpdateRef.current = setTimeout(() => {
        onUpdate({ ...photo.canvasState, position: newPosition });
      }, 30);
    };

    const handleDocumentMouseUp = () => {
      // Handle circle placement
      if (isDraggingCircle) {
        if (circleStartPos && photo.canvasState.circle) {
          // If circleStartPos is still set, it means we didn't drag - instant placement
          const constrainedX = Math.max(photo.canvasState.circle.radius, Math.min(BASE_WIDTH - photo.canvasState.circle.radius, circleStartPos.x));
          const constrainedY = Math.max(photo.canvasState.circle.radius, Math.min(BASE_WIDTH / currentRatio.ratio - photo.canvasState.circle.radius, circleStartPos.y));
          
          onUpdate({
            ...photo.canvasState,
            circle: {
              ...photo.canvasState.circle,
              x: constrainedX,
              y: constrainedY
            }
          });
        } else if (localCirclePosition && photo.canvasState.circle) {
          // We were dragging - apply final position
          if (pendingUpdateRef.current) {
            clearTimeout(pendingUpdateRef.current);
          }
          onUpdate({
            ...photo.canvasState,
            circle: {
              ...photo.canvasState.circle,
              x: localCirclePosition.x,
              y: localCirclePosition.y
            }
          });
        }
      }
      
      // Handle normal photo drag
      if (isDragging && pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
        onUpdate({ ...photo.canvasState, position: localPosition });
      }
      
      setIsDragging(false);
      setIsDraggingCircle(false);
      setCircleStartPos(null);
      setLocalCirclePosition(null);
      
      // Restore text selection and cursor
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      document.body.style.cursor = '';
    };

    // Prevent text selection and scrolling during drag
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    document.body.style.cursor = isDraggingCircle ? 'move' : 'grabbing';
    
    // Use pointer events for mouse and touch support (no added complexity)
    document.addEventListener('pointermove', handleDocumentMouseMove as any);
    document.addEventListener('pointerup', handleDocumentMouseUp);
    document.addEventListener('pointercancel', handleDocumentMouseUp);
    
    // Prevent scrolling during drag
    const preventScroll = (e: Event) => {
      if (isDragging) e.preventDefault();
    };
    document.addEventListener('wheel', preventScroll, { passive: false });
    document.addEventListener('touchmove', preventScroll, { passive: false });

    // Cleanup
    return () => {
      document.removeEventListener('pointermove', handleDocumentMouseMove as any);
      document.removeEventListener('pointerup', handleDocumentMouseUp);
      document.removeEventListener('pointercancel', handleDocumentMouseUp);
      document.removeEventListener('wheel', preventScroll);
      document.removeEventListener('touchmove', preventScroll);
      
      // Restore body styles
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      document.body.style.cursor = '';
    };
  }, [isDragging, isDraggingCircle, dragStart, localPosition, loadedImage, photo.canvasState, currentRatio, onUpdate, circleStartPos, localCirclePosition]);

  // Helper function to check if click is on circle
  const isClickOnCircle = (clickX: number, clickY: number): boolean => {
    if (!photo.canvasState.circle) return false;
    
    const scaleRatio = canvasSize.width / BASE_WIDTH;
    const circleX = photo.canvasState.circle.x * scaleRatio;
    const circleY = photo.canvasState.circle.y * scaleRatio;
    const circleRadius = photo.canvasState.circle.radius * scaleRatio;
    
    const distance = Math.sqrt(
      Math.pow(clickX - circleX, 2) + Math.pow(clickY - circleY, 2)
    );
    
    return distance <= circleRadius;
  };

  // Helper function to convert canvas coordinates to base coordinates
  const canvasToBaseCoords = (canvasX: number, canvasY: number) => {
    const scaleRatio = canvasSize.width / BASE_WIDTH;
    return {
      x: canvasX / scaleRatio,
      y: canvasY / scaleRatio
    };
  };

  // Mouse handlers
  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (size === 'grid') return; // No dragging in grid view
    if (!loadedImage || !photo?.canvasState) return;
    
    // Ignore if already dragging (prevents double-start race condition)
    if (isDragging) return;
    
    // Clear any pending updates
    if (pendingUpdateRef.current) {
      clearTimeout(pendingUpdateRef.current);
    }

    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Check if in circle mode
    if (circleMode) {
      const baseCoords = canvasToBaseCoords(x, y);
      
      // If no circle exists yet, place it immediately
      if (!photo.canvasState.circle) {
        const newCircle = {
          x: baseCoords.x,
          y: baseCoords.y,
          radius: 55, // Use default radius of 55
          color: 'red' as const,
          visible: true
        };
        onUpdate({
          ...photo.canvasState,
          circle: newCircle
        });
        // Clear preview after placing
        setCirclePreview(null);
      } else {
        // Circle exists - prepare for click or drag
        setIsDraggingCircle(true);
        setDragStart({ x, y });
        setCircleStartPos(baseCoords); // Remember where we clicked for potential instant placement
        setLocalCirclePosition({ x: photo.canvasState.circle.x, y: photo.canvasState.circle.y }); // Initialize local position
      }
      
      event.preventDefault();
      return;
    }

    // Normal photo dragging
    setIsDragging(true);
    setDragStart({ x, y });
    // Sync local position to current state to avoid stale position
    setLocalPosition(photo.canvasState.position);
    event.preventDefault();
    
    // Prevent browser's default drag-and-drop for images
    event.nativeEvent.stopPropagation();
  };

  // Note: handleMouseMove and handleMouseUp are now handled by document-level events in useEffect above
  // This provides better UX as dragging continues even when mouse leaves the canvas

  // Handle mouse move for circle preview
  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (size === 'grid') return; // No preview in grid view
    if (!circleMode || photo.canvasState.circle) return; // Only show preview when in circle mode without existing circle
    
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const baseCoords = canvasToBaseCoords(x, y);
    setCirclePreview(baseCoords);
  };
  
  // Clear preview when mouse leaves canvas
  const handleCanvasMouseLeave = () => {
    if (circleMode && !photo.canvasState.circle) {
      setCirclePreview(null);
    }
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

    // Calculate position adjustment to keep the point under the mouse cursor fixed
    // When zooming, we want the image point under the cursor to stay in the same place
    const scaleDiff = newScale - currentScale;
    const currentPosition = photo.canvasState.position;
    
    // The point under the mouse in image space (relative to image origin)
    const imagePointX = baseCenterX - currentPosition.x;
    const imagePointY = baseCenterY - currentPosition.y;
    
    // After zoom, this point moves by the scale difference
    // We need to adjust position to compensate
    const newPosition = {
      x: currentPosition.x - imagePointX * scaleDiff,
      y: currentPosition.y - imagePointY * scaleDiff
    };

    // Apply constraints in base coordinates
    // Use base dimensions for cropping to match render logic
    const baseHeight = BASE_WIDTH / currentRatio.ratio;
    const croppedImage = cropImageToAspectRatio(loadedImage, currentRatio.ratio, { width: BASE_WIDTH, height: baseHeight });
    const minScaleX = BASE_WIDTH / croppedImage.width;
    const minScaleY = baseHeight / croppedImage.height;
    const minScale = Math.max(minScaleX, minScaleY);
    const actualScale = Math.max(newScale, minScale);
    const scaledWidth = croppedImage.width * actualScale;
    const scaledHeight = croppedImage.height * actualScale;

    // Constrain position - both axes use base dimensions
    if (scaledWidth > BASE_WIDTH) {
      const maxX = scaledWidth - BASE_WIDTH;
      newPosition.x = Math.max(-maxX, Math.min(0, newPosition.x));
    } else {
      // Center horizontally if image doesn't overflow
      newPosition.x = (BASE_WIDTH - scaledWidth) / 2;
    }
    
    if (scaledHeight > baseHeight) {
      const maxY = scaledHeight - baseHeight;
      newPosition.y = Math.max(-maxY, Math.min(0, newPosition.y));
    } else {
      // Center vertically if image doesn't overflow
      newPosition.y = (baseHeight - scaledHeight) / 2;
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
    <Box sx={{ 
      position: 'relative', 
      width: size === 'large' ? largeCanvasSize.width : '100%',
      height: size === 'large' ? largeCanvasSize.height : '100%'
    }}>
      <canvas
        ref={canvasRef}
        data-photo-id={photo.id}
        data-set-key={setKey}
        data-label={label}
        style={{
          width: size === 'grid' ? '100%' : 'auto',
          height: size === 'grid' ? '100%' : 'auto',
          maxWidth: '100%',
          maxHeight: '100%',
          cursor: size === 'grid' ? 'pointer' : 
                  circleMode ? 'crosshair' : 
                  (isDragging || isDraggingCircle) ? 'grabbing' : 'grab',
          border: '1px solid',
          borderColor: size === 'grid' ? 'transparent' : '#e0e0e0',
          borderRadius: size === 'grid' ? 0 : '4px', // Rectangular for grid (PDF preview), rounded for modal
          display: 'block'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
        onWheel={handleWheel}
        onDragStart={(e) => e.preventDefault()} // Prevent browser's default image drag
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