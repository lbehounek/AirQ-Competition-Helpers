import jsPDF from 'jspdf';

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
 * Render photo on canvas for PDF (simplified version of PhotoEditorApi logic)
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
  
  // Apply scaling and positioning (simplified version)
  const scale = canvasState.scale || 1;
  const position = canvasState.position || { x: 0, y: 0 };
  
  // Calculate dimensions
  const scaledWidth = croppedImage.width * scale;
  const scaledHeight = croppedImage.height * scale;
  
  // Scale position for canvas
  const canvasScaleFactor = canvas.width / 300; // Scale from base size
  let x = position.x * canvasScaleFactor;
  let y = position.y * canvasScaleFactor;
  
  // Center if image is smaller than canvas
  if (scaledWidth * canvasScaleFactor < canvas.width) {
    x = (canvas.width - scaledWidth * canvasScaleFactor) / 2;
  }
  if (scaledHeight * canvasScaleFactor < canvas.height) {
    y = (canvas.height - scaledHeight * canvasScaleFactor) / 2;
  }
  
  // Draw image
  ctx.drawImage(
    croppedImage,
    x, y,
    scaledWidth * canvasScaleFactor,
    scaledHeight * canvasScaleFactor
  );
  
  // Draw label
  drawLabelOnCanvas(ctx, label, canvasState.labelPosition || 'bottom-left', canvas.width, canvas.height);
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
