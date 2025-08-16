import type { CanvasSettings, DragState } from '../types';

// Validate canvas element to prevent getContext errors
export const isValidCanvas = (canvas: any): canvas is HTMLCanvasElement => {
  return canvas && 
         typeof canvas === 'object' && 
         canvas.nodeType === Node.ELEMENT_NODE && 
         canvas.tagName === 'CANVAS' &&
         typeof canvas.getContext === 'function';
};

// Safe canvas context getter with validation
export const getCanvasContext = (canvas: any): CanvasRenderingContext2D | null => {
  if (!isValidCanvas(canvas)) {
    console.warn('Invalid canvas element provided:', canvas);
    return null;
  }
  
  try {
    return canvas.getContext('2d');
  } catch (error) {
    console.warn('Failed to get canvas context:', error);
    return null;
  }
};

/**
 * Standard canvas settings for the photo grid
 */
export const CANVAS_SETTINGS: CanvasSettings = {
  width: 240,   // Width per photo canvas
  height: 180,  // Height per photo canvas (4:3 ratio)
  aspectRatio: 4/3
};

/**
 * Draw image on canvas with position and scale
 */
export const drawImageOnCanvas = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement | HTMLCanvasElement,
  position: { x: number; y: number },
  scale: number = 1
): void => {
  const ctx = getCanvasContext(canvas);
  if (!ctx) {
    console.warn('Cannot draw on invalid canvas');
    return;
  }
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Calculate scaled dimensions
  const scaledWidth = image.width * scale;
  const scaledHeight = image.height * scale;
  
  // Draw image with position offset
  ctx.drawImage(
    image,
    position.x, 
    position.y,
    scaledWidth,
    scaledHeight
  );
};

/**
 * Draw label text on canvas (bottom-left corner by default)
 */
export const drawLabel = (
  canvas: HTMLCanvasElement,
  label: string,
  position: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' = 'bottom-left'
): void => {
  const ctx = getCanvasContext(canvas);
  if (!ctx) {
    console.warn('Cannot draw label on invalid canvas');
    return;
  }
  
  // Scale font size based on canvas size to maintain consistent visual appearance
  // Base font size for 300x225 canvas, scale proportionally
  const baseFontSize = 48;
  const baseCanvasWidth = 300;
  const scaleFactor = canvas.width / baseCanvasWidth;
  const fontSize = Math.round(baseFontSize * scaleFactor);
  
  // Label styling - 3x bigger than default with thin black border
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'black';
  ctx.lineWidth = Math.max(1, Math.round(scaleFactor)); // Scale border width too
  
  // Calculate position based on canvas size and label position
  let x: number, y: number;
  const padding = Math.round(16 * scaleFactor); // Scale padding proportionally
  
  switch (position) {
    case 'bottom-left':
      x = padding;
      y = canvas.height - padding;
      break;
    case 'bottom-right':
      x = canvas.width - ctx.measureText(label).width - padding;
      y = canvas.height - padding;
      break;
    case 'top-left':
      x = padding;
      y = fontSize + padding; // Scale with font size
      break;
    case 'top-right':
      x = canvas.width - ctx.measureText(label).width - padding;
      y = fontSize + padding; // Scale with font size
      break;
  }
  
  // Draw label with stroke for better visibility
  ctx.strokeText(label, x, y);
  ctx.fillText(label, x, y);
};

/**
 * Draw set name in bottom-right corner of canvas
 */
export const drawSetName = (canvas: HTMLCanvasElement, setName: string): void => {
  if (!isValidCanvas(canvas)) {
    console.warn('Cannot draw set name on invalid canvas');
    return;
  }

  const ctx = getCanvasContext(canvas);
  if (!ctx) return;

  // Calculate proportional scaling based on canvas size
  const baseCanvasWidth = 300; // Base width for scaling calculations
  const scaleFactor = canvas.width / baseCanvasWidth;
  
  // Set name styling (smaller and more subtle than photo label)
  const baseFontSize = 24; // Smaller than photo label (48)
  const fontSize = Math.round(baseFontSize * scaleFactor);
  const padding = Math.round(8 * scaleFactor); // Smaller padding
  
  ctx.font = `${fontSize}px Arial`; // Not bold, more subtle
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // Slightly transparent white
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'; // Slightly transparent black outline
  ctx.lineWidth = Math.max(1, Math.round(scaleFactor * 0.5));
  
  // Position in bottom-right corner (offset slightly from corner)
  const textMetrics = ctx.measureText(setName);
  const x = canvas.width - textMetrics.width - padding;
  const y = canvas.height - fontSize - padding; // Offset by font size to position correctly
  
  ctx.strokeText(setName, x, y);
  ctx.fillText(setName, x, y);
};

/**
 * Calculate mouse position relative to canvas
 */
export const getCanvasMousePosition = (
  canvas: HTMLCanvasElement,
  event: MouseEvent
): { x: number; y: number } => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
};

/**
 * Constrain position to keep image within canvas bounds
 */
export const constrainPosition = (
  position: { x: number; y: number },
  imageSize: { width: number; height: number },
  canvasSize: { width: number; height: number },
  scale: number = 1
): { x: number; y: number } => {
  const scaledWidth = imageSize.width * scale;
  const scaledHeight = imageSize.height * scale;
  
  const maxX = canvasSize.width - scaledWidth;
  const maxY = canvasSize.height - scaledHeight;
  
  return {
    x: Math.min(0, Math.max(maxX, position.x)),
    y: Math.min(0, Math.max(maxY, position.y))
  };
};

/**
 * Initialize canvas with standard settings
 */
export const initializePhotoCanvas = (canvasRef: HTMLCanvasElement): void => {
  canvasRef.width = CANVAS_SETTINGS.width;
  canvasRef.height = CANVAS_SETTINGS.height;
  
  const ctx = canvasRef.getContext('2d')!;
  
  // Set default canvas styles
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  // Draw placeholder background
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, canvasRef.width, canvasRef.height);
  
  // Draw border
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, canvasRef.width, canvasRef.height);
  
  // Draw placeholder text
  ctx.fillStyle = '#aaa';
  ctx.font = '14px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Drop photo here', canvasRef.width / 2, canvasRef.height / 2);
};

/**
 * Export canvas as high-quality data URL
 */
export const exportCanvasAsDataURL = (canvas: HTMLCanvasElement): string => {
  return canvas.toDataURL('image/jpeg', 0.95);
};
