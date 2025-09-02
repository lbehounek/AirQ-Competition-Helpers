import React from 'react';
import { Document, Page, Text, Image, View, pdf, StyleSheet } from '@react-pdf/renderer';
import type { ApiPhotoSet } from '../types/api';

/**
 * Generate PDF using @react-pdf/renderer with proper text rotation support
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

  // Calculate layout dimensions
  const getLayoutDimensions = () => {
    if (layoutMode === 'portrait') {
      // Portrait mode: 2x5 grid - A4 (595 x 842 points)
      const pageWidth = 595;
      const pageHeight = 842;
      const margin = 5;
      const leftReserved = 20; // Space for rotated header
      const gapSize = 2.83; // 1mm in points (72/25.4 ≈ 2.83)
      const minGapX = Math.round(gapSize);
      const minGapY = Math.round(gapSize);
      
      // Calculate photo dimensions
      const availableWidth = pageWidth - (2 * margin) - leftReserved;
      let photoWidth = Math.floor((availableWidth - minGapX) / 2);
      let photoHeight = photoWidth / aspectRatio;
      
      // Check height constraint
      const availableHeight = pageHeight - (2 * margin);
      const neededHeight = (photoHeight * 5) + (minGapY * 4);
      if (neededHeight > availableHeight) {
        photoHeight = Math.floor((availableHeight - (minGapY * 4)) / 5);
        photoWidth = photoHeight * aspectRatio;
      }
      
      // Position calculations
      const totalWidth = (photoWidth * 2) + minGapX;
      const startX = leftReserved + (pageWidth - leftReserved - totalWidth) / 2;
      const startY = margin;
      
      return {
        pageWidth, pageHeight, photoWidth, photoHeight,
        startX, startY, gapX: minGapX, gapY: minGapY,
        cols: 2, rows: 5, leftReserved
      };
    } else {
      // Landscape mode: 3x3 grid - A4 (842 x 595 points)
      const pageWidth = 842;
      const pageHeight = 595;
      const margin = 5;
      const headerSpace = 20;
      const gapSize = 2.83; // 1mm in points
      const minGapX = Math.round(gapSize);
      const minGapY = Math.round(gapSize);
      
      // Calculate photo dimensions
      const availableWidth = pageWidth - (2 * margin);
      let photoWidth = Math.floor((availableWidth - (minGapX * 2)) / 3);
      let photoHeight = photoWidth / aspectRatio;
      
      // Check height constraint
      const neededHeight = (photoHeight * 3) + (minGapY * 2) + headerSpace;
      if (neededHeight > pageHeight - (2 * margin)) {
        const availableHeight = pageHeight - (2 * margin) - headerSpace;
        photoHeight = Math.floor((availableHeight - (minGapY * 2)) / 3);
        photoWidth = photoHeight * aspectRatio;
      }
      
      // Position calculations
      const totalWidth = (photoWidth * 3) + (minGapX * 2);
      const startX = (pageWidth - totalWidth) / 2;
      const startY = headerSpace + margin;
      
      return {
        pageWidth, pageHeight, photoWidth, photoHeight,
        startX, startY, gapX: minGapX, gapY: minGapY,
        cols: 3, rows: 3, leftReserved: 0
      };
    }
  };

  const layout = getLayoutDimensions();

  // Styles for the PDF
  const styles = StyleSheet.create({
    page: {
      paddingTop: 5,
      paddingBottom: 5,
      paddingLeft: 5,
      paddingRight: 5,
      backgroundColor: '#ffffff',
    },

    horizontalHeader: {
      fontSize: 12,
      fontWeight: 'bold',
      color: '#000000',
      marginBottom: 10,
      textAlign: 'center',
    },
    headerLeft: {
      textAlign: 'left',
    },
    headerRight: {
      textAlign: 'right',
    },
    photoContainer: {
      position: 'absolute',
    },
    photo: {
      objectFit: 'contain',
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 5,
    }
  });

  // Create photo grid elements
  const createPhotoGrid = (photoSet: ApiPhotoSet, setKey: 'set1' | 'set2') => {
    const photoElements = [];
    
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        const index = row * layout.cols + col;
        const photo = photoSet.photos[index];
        
        if (photo) {
          const dataUrl = getPhotoDataUrl(photo.id, setKey);
          if (dataUrl) {
            const x = layout.startX + col * (layout.photoWidth + layout.gapX);
            const y = layout.startY + row * (layout.photoHeight + layout.gapY);
            
            photoElements.push(
              React.createElement(View, {
                key: `${setKey}-${photo.id}`,
                style: [
                  styles.photoContainer,
                  {
                    left: x,
                    top: y,
                    width: layout.photoWidth,
                    height: layout.photoHeight,
                  }
                ]
              },
                React.createElement(Image, {
                  src: dataUrl,
                  style: [
                    styles.photo,
                    {
                      width: layout.photoWidth,
                      height: layout.photoHeight,
                    }
                  ]
                })
              )
            );
          }
        }
      }
    }
    
    return photoElements;
  };

  // Create page header
  const createPageHeader = (setTitle: string) => {
    const headerText = `${competitionName || ''} • ${setTitle}`;
    
    if (layoutMode === 'portrait') {
      // Rotated header on left edge for portrait mode - final attempt with transform
      return React.createElement(View, {
        style: {
          position: 'absolute',
          left: 8,
          top: 300,
          width: 200,
          height: 20,
        }
      },
        React.createElement(Text, {
          style: {
            fontSize: 12,
            fontWeight: 'bold',
            color: '#000000',
            transform: 'rotate(90deg)',
          }
        }, headerText)
      );
    } else {
      // Horizontal header for landscape mode
      return React.createElement(View, {
        style: styles.headerRow
      }, [
        React.createElement(Text, {
          key: 'left',
          style: [styles.horizontalHeader, styles.headerLeft]
        }, competitionName || ''),
        React.createElement(Text, {
          key: 'right', 
          style: [styles.horizontalHeader, styles.headerRight]
        }, setTitle)
      ]);
    }
  };

  // Create the PDF document structure
  const createPDFDocument = () => {
    const pages = [];

    // Set 1 Page
    if (set1.photos.length > 0) {
      pages.push(
        React.createElement(Page, {
          key: 'set1-page',
          size: 'A4',
          orientation: layoutMode,
          style: styles.page
        }, [
          createPageHeader(set1.title),
          ...createPhotoGrid(set1, 'set1')
        ])
      );
    }

    // Set 2 Page
    if (set2.photos.length > 0) {
      pages.push(
        React.createElement(Page, {
          key: 'set2-page',
          size: 'A4',
          orientation: layoutMode,
          style: styles.page
        }, [
          createPageHeader(set2.title),
          ...createPhotoGrid(set2, 'set2')
        ])
      );
    }

    return React.createElement(Document, {}, pages);
  };

  // Generate and download PDF
  try {
    const pdfDocument = createPDFDocument();
    const blob = await pdf(pdfDocument).toBlob();
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const url = URL.createObjectURL(blob);
    
    // Create download link
    const link = document.createElement('a');
    link.href = url;
    link.download = `navigation-photos-${timestamp}.pdf`;
    link.click();
    
    // Clean up
    URL.revokeObjectURL(url);
    
    console.log('PDF generated successfully');
  } catch (error) {
    console.error('PDF generation failed:', error);
    throw error;
  }
};