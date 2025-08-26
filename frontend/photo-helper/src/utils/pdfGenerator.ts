import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

import type { ApiPhoto, ApiPhotoSet } from '../types/api';

// Wire pdfMake virtual file system
// The vfs_fonts file exports the VFS object directly
(pdfMake as any).vfs = pdfFonts;

/**
 * Generate PDF using pdfMake with proper Czech character support
 */
export const generatePDF = async (
  set1: ApiPhotoSet,
  set2: ApiPhotoSet,
  sessionId: string,
  aspectRatio = 4/3,
  competitionName?: string,
  layoutMode: 'landscape' | 'portrait' = 'landscape'
): Promise<void> => {
  
  // Helper function to get canvas data URL for a photo
  const getPhotoDataUrl = (photoId: string, setKey: 'set1' | 'set2'): string | null => {
    try {
      // Find the canvas element using the correct data attributes
      const canvasElement = document.querySelector(`canvas[data-photo-id="${photoId}"][data-set-key="${setKey}"]`) as HTMLCanvasElement;
      if (canvasElement) {
        return canvasElement.toDataURL('image/jpeg', 0.9);
      }
      
      // Fallback: try just photo-id
      const fallbackCanvas = document.querySelector(`canvas[data-photo-id="${photoId}"]`) as HTMLCanvasElement;
      if (fallbackCanvas) {
        return fallbackCanvas.toDataURL('image/jpeg', 0.9);
      }
      
      console.warn(`Canvas not found for photo ${photoId} in set ${setKey}`);
      return null;
    } catch (error) {
      console.warn(`Failed to get canvas data for photo ${photoId}:`, error);
      return null;
    }
  };

  // Create photo grid for a set - Use absolute positioning instead of table layout
  const createPhotoGrid = (photoSet: PhotoSet, setKey: 'set1' | 'set2') => {
    const content = [];
    
    let photoWidth: number;
    let photoHeight: number;
    let startX: number;
    let startY: number;
    let gapX: number;
    let gapY: number;
    let cols: number;
    let rows: number;
    
    if (layoutMode === 'portrait') {
      // Portrait mode: 2x5 grid - Maximized for A4 (595 x 842 points)
      // Page dimensions: 595 width x 842 height
      // Usable area with 15pt margins: 565 x 812 points
      
      // Maximize photo size for 2 columns
      const pageWidth = 595;
      const pageHeight = 842;
      const margin = 10;
      const headerSpace = 30;
      const minGapX = 10; // Minimum gap between columns
      const minGapY = 8; // Minimum gap between rows
      
      // Calculate maximum photo width
      const availableWidth = pageWidth - (2 * margin);
      photoWidth = Math.floor((availableWidth - minGapX) / 2);
      photoHeight = photoWidth / aspectRatio;
      
      // Check if height fits and adjust if necessary
      const neededHeight = (photoHeight * 5) + (minGapY * 4) + headerSpace;
      if (neededHeight > pageHeight - (2 * margin)) {
        // Height doesn't fit, recalculate based on height constraint
        const availableHeight = pageHeight - (2 * margin) - headerSpace;
        photoHeight = Math.floor((availableHeight - (minGapY * 4)) / 5);
        photoWidth = photoHeight * aspectRatio;
      }
      
      // Center the grid on the page
      const totalWidth = (photoWidth * 2) + minGapX;
      startX = (pageWidth - totalWidth) / 2;
      startY = headerSpace + margin;
      gapX = minGapX;
      gapY = minGapY;
      
      cols = 2;
      rows = 5;
    } else {
      // Landscape mode: 3x3 grid - Maximized for A4 (842 x 595 points)
      // Page dimensions: 842 width x 595 height
      // Usable area with 15pt margins: 812 x 565 points
      
      // Maximize photo size for 3 columns
      const pageWidth = 842;
      const pageHeight = 595;
      const margin = 10;
      const headerSpace = 30;
      const minGapX = 8; // Minimum gap between columns
      const minGapY = 8; // Minimum gap between rows
      
      // Calculate maximum photo width
      const availableWidth = pageWidth - (2 * margin);
      photoWidth = Math.floor((availableWidth - (minGapX * 2)) / 3);
      photoHeight = photoWidth / aspectRatio;
      
      // Check if height fits and adjust if necessary
      const neededHeight = (photoHeight * 3) + (minGapY * 2) + headerSpace;
      if (neededHeight > pageHeight - (2 * margin)) {
        // Height doesn't fit, recalculate based on height constraint
        const availableHeight = pageHeight - (2 * margin) - headerSpace;
        photoHeight = Math.floor((availableHeight - (minGapY * 2)) / 3);
        photoWidth = photoHeight * aspectRatio;
      }
      
      // Center the grid on the page
      const totalWidth = (photoWidth * 3) + (minGapX * 2);
      startX = (pageWidth - totalWidth) / 2;
      startY = headerSpace + margin;
      gapX = minGapX;
      gapY = minGapY;
      
      cols = 3;
      rows = 3;
    }
    
    // Create grid with absolute positioning
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;
        const photo = photoSet.photos[index];
        
        const x = startX + col * (photoWidth + gapX);
        const y = startY + row * (photoHeight + gapY);
        
        if (photo) {
          const dataUrl = getPhotoDataUrl(photo.id, setKey);
          if (dataUrl) {
            // FORCE MASSIVE PHOTO WITH ABSOLUTE POSITIONING
            content.push({
              image: dataUrl,
              width: photoWidth, // FORCE WIDTH IN POINTS
              height: photoHeight, // FORCE HEIGHT IN POINTS
              absolutePosition: { x: x, y: y }
            });
          } else {
            // Placeholder text
            content.push({
              text: photo.label || '',
              fontSize: 24,
              color: '#333333',
              absolutePosition: { x: x + photoWidth/2, y: y + photoHeight/2 },
              alignment: 'center'
            });
          }
        }
      }
    }
    
    return content;
  };

  // Create header with competition name and set title
  const createHeader = (setTitle: string) => {
    return {
      columns: [
        {
          text: competitionName || '',
          style: 'header',
          alignment: 'left',
          margin: [10, 0, 0, 0] // Add left padding
        },
        {
          text: setTitle,
          style: 'header',
          alignment: 'right',
          margin: [0, 0, 10, 0] // Add right padding
        }
      ],
      margin: [0, 5, 0, 10] // Compact header to maximize photo space
    };
  };

  // Document definition
  const docDefinition = {
    pageSize: 'A4',
    pageOrientation: layoutMode as ('landscape' | 'portrait'),
    pageMargins: [10, 10, 10, 10], // Very minimal margins to maximize photo area
    content: [] as any[],
    styles: {
      header: {
        fontSize: 12,
        bold: true,
        color: '#000000'
      }
    }
  };

  // Add Set 1 page
  if (set1.photos.length > 0) {
    docDefinition.content.push(createHeader(set1.title));
    docDefinition.content.push(...createPhotoGrid(set1, 'set1'));
  }

  // Add Set 2 page
  if (set2.photos.length > 0) {
    if (docDefinition.content.length > 0) {
      docDefinition.content.push({ text: '', pageBreak: 'before' });
    }
    docDefinition.content.push(createHeader(set2.title));
    docDefinition.content.push(...createPhotoGrid(set2, 'set2'));
  }

  // Generate and download PDF
  try {
    const pdfDocGenerator = pdfMake.createPdf(docDefinition);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    pdfDocGenerator.download(`navigation-photos-${timestamp}.pdf`);
  } catch (error) {
    console.error('PDF generation failed:', error);
    throw error;
  }
};
