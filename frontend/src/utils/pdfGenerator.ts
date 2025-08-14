import jsPDF from 'jspdf';
import { ASPECT_RATIO_OPTIONS } from '../contexts/AspectRatioContext';

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
}

interface PhotoSet {
  title: string;
  photos: ApiPhoto[];
}

/**
 * Generate PDF by capturing the already-rendered preview canvases
 * This ensures 100% accuracy with all effects, zoom, positioning, etc.
 */
export const generatePDF = async (
  set1: PhotoSet,
  set2: PhotoSet,
  sessionId: string,
  aspectRatio = 4/3
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

  // Dynamic 3x3 grid layout optimized for aspect ratio
  const topBottomMargin = 5; // 0.5cm for printer friendliness
  
  // Adaptive spacing based on aspect ratio to better utilize page
  const spacing = Math.max(3, 8 - (aspectRatio - 1) * 3); // Less spacing for wider formats
  
  // Calculate optimal dimensions to maximize photo size while fitting 3x3 grid
  const availableWidth = pageWidth - 20; // 10mm margins on sides
  const availableHeight = pageHeight - (2 * topBottomMargin);
  
  // Calculate cell dimensions considering both width and height constraints
  const cellWidthFromWidth = (availableWidth - (2 * spacing)) / 3;
  const cellWidthFromHeight = (availableHeight - (2 * spacing)) * aspectRatio / 3;
  
  // Use the smaller dimension to ensure everything fits
  const cellWidth = Math.min(cellWidthFromWidth, cellWidthFromHeight);
  const cellHeight = cellWidth / aspectRatio;
  
  // Calculate actual used space and center on page
  const totalGridWidth = (3 * cellWidth) + (2 * spacing);
  const totalGridHeight = (3 * cellHeight) + (2 * spacing);
  
  const sideMargin = (pageWidth - totalGridWidth) / 2;
  const verticalOffset = topBottomMargin + (availableHeight - totalGridHeight) / 2;

  const addPhotoSetToPage = (photoSet: PhotoSet, setKey: 'set1' | 'set2', isFirstPage: boolean = true) => {
    if (!isFirstPage) {
      pdf.addPage();
    }
    
    // No title text - set name is shown on first photo
    
    // Create 9 slots (3x3 grid)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const index = row * 3 + col;
        const photo = photoSet.photos[index];
        
        // Calculate position
        const x = sideMargin + col * (cellWidth + spacing);
        const y = verticalOffset + row * (cellHeight + spacing);
        
        if (photo) {
          try {
            // Find the corresponding canvas element in the DOM
            const canvasElement = findPhotoCanvas(photo.id, setKey);
            
            if (canvasElement) {
              // Capture the already-rendered canvas directly
              const imgData = canvasElement.toDataURL('image/jpeg', 0.9);
              pdf.addImage(imgData, 'JPEG', x, y, cellWidth, cellHeight);
            } else {
              // Fallback: Draw placeholder if canvas not found
              console.warn(`Canvas not found for photo ${photo.id}`);
              drawPlaceholder(pdf, x, y, cellWidth, cellHeight, photo.label);
            }
          } catch (error) {
            console.warn(`Failed to capture canvas for photo ${photo.id}:`, error);
            drawPlaceholder(pdf, x, y, cellWidth, cellHeight, photo.label);
          }
        }
        // Note: Empty slots are left completely blank - no frame, no placeholder
      }
    }
  };

  // Add Set 1
  if (set1.photos.length > 0) {
    addPhotoSetToPage(set1, 'set1', true);
  }

  // Add Set 2 on new page
  if (set2.photos.length > 0) {
    addPhotoSetToPage(set2, 'set2', false);
  }

  // Download the PDF
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  pdf.save(`navigation-photos-${timestamp}.pdf`);
};

/**
 * Find the canvas element in the DOM for a specific photo
 */
const findPhotoCanvas = (photoId: string, setKey: 'set1' | 'set2'): HTMLCanvasElement | null => {
  // Look for canvas with data attributes matching the photo
  const canvasSelector = `canvas[data-photo-id="${photoId}"][data-set-key="${setKey}"]`;
  const canvas = document.querySelector(canvasSelector) as HTMLCanvasElement;
  
  if (canvas) {
    return canvas;
  }
  
  // Fallback: Look for any canvas that might be related to this photo
  const allCanvases = document.querySelectorAll('canvas');
  for (const canvas of allCanvases) {
    // Check if canvas is in a container that might be related to this photo
    const container = canvas.closest(`[data-photo-id="${photoId}"]`) || 
                     canvas.closest(`[data-set="${setKey}"]`);
    if (container) {
      return canvas as HTMLCanvasElement;
    }
  }
  
  console.warn(`Could not find canvas for photo ${photoId} in set ${setKey}`);
  return null;
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