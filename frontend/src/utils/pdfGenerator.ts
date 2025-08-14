import jsPDF from 'jspdf';
import { applyWebGLEffects, isWebGLSupported, type WebGLContext, type ImageAdjustments } from './webglUtils';
import { getWebGLContextManager } from './webglContextManager';

interface ApiPhoto {
  id: string;
  url: string;
  filename: string;
  canvasState: {
    position: { x: number; y: number };
    scale: number;
    brightness: number;
    contrast: number;
    sharpness: number;
    whiteBalance: {
      temperature: number;
      tint: number;
      auto: boolean;
    };
    labelPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };
  label: string;
  sessionId: string;
}

interface PhotoSet {
  title: string;
  photos: ApiPhoto[];
}

/**
 * Generate PDF from photo sets using the same rendering logic as the frontend
 */
export const generatePDF = async (
  set1: PhotoSet,
  set2: PhotoSet,
  sessionId: string
): Promise<void> => {
  // A4 landscape dimensions in mm
  const pageWidth = 297;
  const pageHeight = 210;
  
  // Create PDF in landscape orientation
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  // 3x3 grid layout with margins
  const margin = 15;
  const spacing = 8;
  const gridWidth = pageWidth - (2 * margin);
  const gridHeight = pageHeight - (2 * margin);
  
  // Calculate cell dimensions (4:3 aspect ratio)
  const cellWidth = (gridWidth - (2 * spacing)) / 3;
  const cellHeight = cellWidth * 0.75; // 4:3 aspect ratio
  
  // Adjust grid height if needed to center vertically
  const totalGridHeight = (3 * cellHeight) + (2 * spacing);
  const verticalOffset = (gridHeight - totalGridHeight) / 2;

  const addPhotoSetToPage = async (photoSet: PhotoSet, isFirstPage: boolean = true) => {
    if (!isFirstPage) {
      pdf.addPage();
    }
    
    // Add title
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text(photoSet.title || 'Photo Set', pageWidth / 2, margin / 2, { align: 'center' });
    
    // Create 9 slots (3x3 grid)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const index = row * 3 + col;
        const photo = photoSet.photos[index];
        
        // Calculate position
        const x = margin + col * (cellWidth + spacing);
        const y = margin + verticalOffset + row * (cellHeight + spacing);
        
        if (photo) {
          try {
            // Load and process the image
            const processedCanvas = await createProcessedCanvas(photo, sessionId);
            
            if (processedCanvas) {
              // Convert canvas to image data and add to PDF
              const imgData = processedCanvas.toDataURL('image/jpeg', 0.9);
              pdf.addImage(imgData, 'JPEG', x, y, cellWidth, cellHeight);
            } else {
              // Draw placeholder if image processing failed
              drawPlaceholder(pdf, x, y, cellWidth, cellHeight, photo.label);
            }
          } catch (error) {
            console.warn(`Failed to process photo ${photo.id}:`, error);
            drawPlaceholder(pdf, x, y, cellWidth, cellHeight, photo.label);
          }
        } else {
          // Draw empty slot
          const label = String.fromCharCode(65 + index); // A, B, C...
          drawEmptySlot(pdf, x, y, cellWidth, cellHeight, label);
        }
      }
    }
  };

  // Add Set 1
  if (set1.photos.length > 0) {
    await addPhotoSetToPage(set1, true);
  }

  // Add Set 2 on new page
  if (set2.photos.length > 0) {
    await addPhotoSetToPage(set2, false);
  }

  // Download the PDF
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  pdf.save(`navigation-photos-${timestamp}.pdf`);
};

/**
 * Create a processed canvas for a photo with all effects applied
 */
const createProcessedCanvas = async (photo: ApiPhoto, sessionId: string): Promise<HTMLCanvasElement | null> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      try {
        // Create canvas with PDF cell dimensions (scaled up for better quality)
        const scaleFactor = 4; // Higher resolution for PDF
        const canvas = document.createElement('canvas');
        canvas.width = 300 * scaleFactor;  // Base width * scale
        canvas.height = 225 * scaleFactor; // Base height * scale (4:3)
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }

        // Apply the same rendering logic as PhotoEditorApi
        // This ensures visual consistency between preview and PDF
        renderPhotoForPDF(canvas, img, photo.canvasState, photo.label);
        resolve(canvas);
      } catch (error) {
        console.error('Error creating processed canvas:', error);
        resolve(null);
      }
    };

    img.onerror = () => {
      console.error(`Failed to load image: ${photo.id}`);
      resolve(null);
    };

    img.src = `http://localhost:8000/api/photos/${sessionId}/${photo.id}`;
  });
};

/**
 * Render photo on canvas for PDF (same logic as PhotoEditorApi with all effects)
 */
const renderPhotoForPDF = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  canvasState: any,
  label: string
): void => {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Auto-crop to 4:3 aspect ratio
  const croppedImage = cropImageTo43(image);
  
  // Calculate minimum scale based on canvas dimensions
  const minScaleX = canvas.width / croppedImage.width;
  const minScaleY = canvas.height / croppedImage.height;
  const minScale = Math.max(minScaleX, minScaleY);
  const actualScale = Math.max(canvasState.scale || 1, minScale);
  
  // Calculate scaled dimensions
  const scaledWidth = croppedImage.width * actualScale;
  const scaledHeight = croppedImage.height * actualScale;
  
  // Use position from canvas state
  const position = canvasState.position || { x: 0, y: 0 };
  
  // Apply position constraints
  let x = position.x;
  let y = position.y;
  
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
  
  // Create temporary canvas for image processing
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = Math.ceil(scaledWidth);
  tempCanvas.height = Math.ceil(scaledHeight);
  const tempCtx = tempCanvas.getContext('2d');
  
  if (!tempCtx) {
    // Fallback: just draw without effects
    ctx.drawImage(croppedImage, x, y, scaledWidth, scaledHeight);
    drawLabelOnCanvas(ctx, label, canvasState.labelPosition || 'bottom-left', canvas.width, canvas.height);
    return;
  }
  
  // Draw image to temp canvas
  tempCtx.drawImage(croppedImage, 0, 0, scaledWidth, scaledHeight);
  
  // Apply image effects (same as PhotoEditorApi)
  const needsProcessing = canvasState.brightness !== 0 || 
                         canvasState.contrast !== 1 || 
                         (canvasState.sharpness && canvasState.sharpness > 0) || 
                         (canvasState.whiteBalance && (canvasState.whiteBalance.auto || 
                          canvasState.whiteBalance.temperature !== 0 || 
                          canvasState.whiteBalance.tint !== 0));

  if (needsProcessing) {
    // Try WebGL acceleration first
    const webglSupported = isWebGLSupported();
    let processedCanvas: HTMLCanvasElement | null = null;
    
    if (webglSupported) {
      try {
        const webglManager = getWebGLContextManager();
        const webglContext = webglManager.requestContext();
        
        if (webglContext) {
          const adjustments: ImageAdjustments = {
            brightness: canvasState.brightness || 0,
            contrast: canvasState.contrast || 1,
            sharpness: canvasState.sharpness || 0,
            temperature: canvasState.whiteBalance?.temperature || 0,
            tint: canvasState.whiteBalance?.tint || 0
          };
          
          processedCanvas = applyWebGLEffects(tempCanvas, adjustments, webglContext);
          webglManager.releaseContext(webglContext);
        }
      } catch (error) {
        console.warn('WebGL processing failed for PDF, falling back to CPU:', error);
      }
    }
    
    // CPU fallback if WebGL failed or not available
    if (!processedCanvas) {
      processedCanvas = applyCPUEffects(tempCanvas, canvasState);
    }
    
    if (processedCanvas) {
      ctx.drawImage(processedCanvas, x, y);
    } else {
      ctx.drawImage(tempCanvas, x, y);
    }
  } else {
    // No processing needed
    ctx.drawImage(tempCanvas, x, y);
  }
  
  // Draw label
  drawLabelOnCanvas(ctx, label, canvasState.labelPosition || 'bottom-left', canvas.width, canvas.height);
};

/**
 * Apply image effects using CPU processing (fallback)
 */
const applyCPUEffects = (canvas: HTMLCanvasElement, canvasState: any): HTMLCanvasElement => {
  const ctx = canvas.getContext('2d')!;
  
  try {
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
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
        
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] === 0) continue;
          
          // Apply temperature (blue/yellow)
          if (temp !== 0) {
            data[i] += temp * 0.8; // Red
            data[i + 2] -= temp * 0.8; // Blue
          }
          
          // Apply tint (green/magenta)
          if (tint !== 0) {
            data[i] += tint * 0.5; // Red
            data[i + 1] -= tint * 0.25; // Green
            data[i + 2] += tint * 0.5; // Blue
          }
        }
      }
    }
    
    // Apply brightness and contrast
    const brightness = canvasState.brightness || 0;
    const contrast = canvasState.contrast || 1;
    
    if (brightness !== 0 || contrast !== 1) {
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue; // Skip transparent pixels
        
        // Apply contrast first (around 128 midpoint), then brightness
        data[i] = Math.max(0, Math.min(255, ((data[i] - 128) * contrast + 128) + brightness));
        data[i + 1] = Math.max(0, Math.min(255, ((data[i + 1] - 128) * contrast + 128) + brightness));
        data[i + 2] = Math.max(0, Math.min(255, ((data[i + 2] - 128) * contrast + 128) + brightness));
      }
    }
    
    // Apply sharpness using convolution kernel
    if (canvasState.sharpness && canvasState.sharpness > 0) {
      const originalData = new Uint8ClampedArray(data);
      const width = canvas.width;
      const height = canvas.height;
      
      const strength = canvasState.sharpness / 100; // 0 to 1
      const kernel = [
        0, -strength, 0,
        -strength, 1 + 4 * strength, -strength,
        0, -strength, 0
      ];
      
      // Apply convolution (skip edges for simplicity)
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          for (let c = 0; c < 3; c++) { // RGB channels only
            let newValue = 0;
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                const pixelIndex = ((y + ky) * width + (x + kx)) * 4 + c;
                const kernelIndex = (ky + 1) * 3 + (kx + 1);
                newValue += originalData[pixelIndex] * kernel[kernelIndex];
              }
            }
            const currentIndex = (y * width + x) * 4 + c;
            data[currentIndex] = Math.max(0, Math.min(255, newValue));
          }
        }
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
  } catch (error) {
    console.error('Error applying CPU effects:', error);
  }
  
  return canvas;
};

/**
 * Crop image to 4:3 aspect ratio (same as PhotoEditorApi)
 */
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
    // Image is too wide
    sourceWidth = image.height * targetAspect;
    sourceX = (image.width - sourceWidth) / 2;
  } else if (imageAspect < targetAspect) {
    // Image is too tall
    sourceHeight = image.width / targetAspect;
    sourceY = (image.height - sourceHeight) / 2;
  }
  
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  
  ctx.drawImage(
    image,
    sourceX, sourceY, sourceWidth, sourceHeight,
    0, 0, sourceWidth, sourceHeight
  );
  
  return canvas;
};

/**
 * Draw label on canvas for PDF
 */
const drawLabelOnCanvas = (
  ctx: CanvasRenderingContext2D,
  label: string,
  position: string,
  canvasWidth: number,
  canvasHeight: number
): void => {
  const baseFontSize = 48;
  const baseCanvasWidth = 300;
  const scaleFactor = canvasWidth / baseCanvasWidth;
  const fontSize = Math.round(baseFontSize * scaleFactor);
  
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'black';
  ctx.lineWidth = Math.max(1, Math.round(scaleFactor));
  
  const padding = Math.round(16 * scaleFactor);
  let x: number, y: number;
  
  switch (position) {
    case 'bottom-left':
      x = padding;
      y = canvasHeight - padding;
      break;
    case 'bottom-right':
      x = canvasWidth - ctx.measureText(label).width - padding;
      y = canvasHeight - padding;
      break;
    case 'top-left':
      x = padding;
      y = fontSize + padding;
      break;
    case 'top-right':
      x = canvasWidth - ctx.measureText(label).width - padding;
      y = fontSize + padding;
      break;
    default:
      x = padding;
      y = canvasHeight - padding;
  }
  
  ctx.strokeText(label, x, y);
  ctx.fillText(label, x, y);
};

/**
 * Draw placeholder for failed images
 */
const drawPlaceholder = (
  pdf: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string
): void => {
  // Draw border
  pdf.setDrawColor(200, 200, 200);
  pdf.rect(x, y, width, height);
  
  // Draw label
  pdf.setFontSize(24);
  pdf.setTextColor(100, 100, 100);
  pdf.text(label, x + width/2, y + height/2, { align: 'center' });
};

/**
 * Draw empty slot
 */
const drawEmptySlot = (
  pdf: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string
): void => {
  // Draw dashed border
  pdf.setDrawColor(150, 150, 150);
  pdf.setLineDashPattern([2, 2], 0);
  pdf.rect(x, y, width, height);
  pdf.setLineDashPattern([], 0); // Reset line dash
  
  // Draw label
  pdf.setFontSize(20);
  pdf.setTextColor(150, 150, 150);
  pdf.text(label, x + width/2, y + height/2, { align: 'center' });
};
