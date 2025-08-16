import pdfMake from 'pdfmake/build/pdfmake';
// @ts-ignore
import pdfFonts from 'pdfmake/build/vfs_fonts';

// Set up pdfMake with fonts - pdfFonts is the vfs object directly
pdfMake.vfs = pdfFonts;

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
}

interface PhotoSet {
  title: string;
  photos: (ApiPhoto & { label: string })[];
}

/**
 * Generate PDF using pdfMake with proper Czech character support
 */
export const generatePDFWithPdfMake = async (
  set1: PhotoSet,
  set2: PhotoSet,
  sessionId: string,
  aspectRatio = 4/3,
  competitionName?: string
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

  // Create photo grid for a set - FUCK TABLES, USE ABSOLUTE POSITIONING
  const createPhotoGrid = (photoSet: PhotoSet, setKey: 'set1' | 'set2') => {
    const content = [];
    
    // MASSIVE PHOTOS - FUCK EVERYTHING ELSE
    const photoWidth = 250; // 250 points = ~88mm = 3.5 inches - HUGE!
    const photoHeight = photoWidth / aspectRatio; // Maintain aspect ratio
    
    const startX = 20; // Start position
    const startY = 50; // Start position (after header)
    const gapX = 10; // Gap between photos
    const gapY = 10; // Gap between rows
    
    // Create 3x3 grid with absolute positioning
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const index = row * 3 + col;
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
          alignment: 'left'
        },
        {
          text: setTitle,
          style: 'header',
          alignment: 'right'
        }
      ],
      margin: [0, 0, 0, 10]
    };
  };

  // Document definition
  const docDefinition = {
    pageSize: 'A4',
    pageOrientation: 'landscape' as const,
    pageMargins: [8, 8, 8, 8], // Minimal margins - 8mm all around
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
