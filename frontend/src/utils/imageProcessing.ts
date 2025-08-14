import type { ImageAdjustments } from '../types';

/**
 * Auto-crop image to 4:3 aspect ratio
 * Centers the crop area and returns a new canvas
 */
export const autoCropTo43 = (image: HTMLImageElement): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  const targetRatio = 4 / 3;
  const imageRatio = image.width / image.height;
  
  let cropWidth: number, cropHeight: number, offsetX: number, offsetY: number;
  
  if (imageRatio > targetRatio) {
    // Image is wider than 4:3 - crop sides
    cropHeight = image.height;
    cropWidth = cropHeight * targetRatio;
    offsetX = (image.width - cropWidth) / 2;
    offsetY = 0;
  } else {
    // Image is taller than 4:3 - crop top/bottom
    cropWidth = image.width;
    cropHeight = cropWidth / targetRatio;
    offsetX = 0;
    offsetY = (image.height - cropHeight) / 2;
  }
  
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  
  ctx.drawImage(
    image, 
    offsetX, offsetY, cropWidth, cropHeight,  // Source rectangle
    0, 0, cropWidth, cropHeight               // Destination rectangle
  );
  
  return canvas;
};

/**
 * Load image file and return HTMLImageElement
 */
export const loadImageFromFile = (file: File): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File is not an image'));
      return;
    }
    
    // Check file size (20MB limit)
    if (file.size > 20 * 1024 * 1024) {
      reject(new Error('Image file too large (max 20MB)'));
      return;
    }
    
    // Check file format
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      reject(new Error('Unsupported format. Please use JPEG or PNG only.'));
      return;
    }
    
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image. File may be corrupted.'));
    };
    
    img.src = url;
  });
};

/**
 * Apply image adjustments (brightness, contrast) to canvas
 */
export const applyImageAdjustments = (
  canvas: HTMLCanvasElement, 
  adjustments: ImageAdjustments
): void => {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    // Apply brightness (-100 to +100)
    data[i] = Math.min(255, Math.max(0, data[i] + adjustments.brightness));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + adjustments.brightness));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + adjustments.brightness));
    
    // Apply contrast (0.5 to 2.0)
    data[i] = Math.min(255, Math.max(0, (data[i] - 128) * adjustments.contrast + 128));
    data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * adjustments.contrast + 128));
    data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * adjustments.contrast + 128));
  }
  
  ctx.putImageData(imageData, 0, 0);
};

/**
 * Generate sequential labels A, B, C, ... I
 */
export const generatePhotoLabels = (): string[] => {
  return Array.from({ length: 9 }, (_, i) => String.fromCharCode(65 + i)); // A-I
};

/**
 * Validate if file is a supported image format
 */
export const isValidImageFile = (file: File): boolean => {
  return ['image/jpeg', 'image/png'].includes(file.type) && file.size <= 20 * 1024 * 1024;
};
