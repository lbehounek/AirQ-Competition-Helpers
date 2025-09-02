import React from 'react';
import { Document, Page, Text, Image, View, pdf, StyleSheet } from '@react-pdf/renderer';
import type { ApiPhotoSet } from '../types/api';

/**
 * Clean PDF generation with @react-pdf/renderer
 */
export const generatePDF = async (
  set1: ApiPhotoSet,
  set2: ApiPhotoSet,
  sessionId: string,
  aspectRatio = 4/3,
  competitionName?: string,
  layoutMode: 'landscape' | 'portrait' = 'landscape'
): Promise<void> => {
  
  // Get canvas data URL for a photo
  const getPhotoDataUrl = (photoId: string, setKey: 'set1' | 'set2'): string | null => {
    try {
      const canvasElement = document.querySelector(`canvas[data-photo-id="${photoId}"][data-set-key="${setKey}"]`) as HTMLCanvasElement;
      if (canvasElement) {
        return canvasElement.toDataURL('image/jpeg', 0.9);
      }
      
      const fallbackCanvas = document.querySelector(`canvas[data-photo-id="${photoId}"]`) as HTMLCanvasElement;
      if (fallbackCanvas) {
        return fallbackCanvas.toDataURL('image/jpeg', 0.9);
      }
      
      return null;
    } catch (error) {
      console.warn(`Failed to get canvas data for photo ${photoId}:`, error);
      return null;
    }
  };

  // Clean layout calculations
  const calculateLayout = () => {
    if (layoutMode === 'portrait') {
      // A4 Portrait: 595 x 842 points
      const pageWidth = 595;
      const pageHeight = 842;
      const margin = 5;
      const textWidth = 15; // Width for rotated text along left edge
      const gap = 2.83; // 1mm in points
      
      // Available space for photos
      const availableWidth = pageWidth - (2 * margin) - textWidth;
      const availableHeight = pageHeight - (2 * margin);
      
      // Calculate photo size for 2x5 grid
      const photoWidth = Math.floor((availableWidth - gap) / 2);
      const photoHeight = Math.floor((availableHeight - (4 * gap)) / 5);
      
      // Ensure aspect ratio
      const correctedHeight = Math.min(photoHeight, photoWidth / aspectRatio);
      const correctedWidth = correctedHeight * aspectRatio;
      
      // Center the grid
      const totalWidth = (correctedWidth * 2) + gap;
      const totalHeight = (correctedHeight * 5) + (gap * 4);
      
      const startX = textWidth + margin + (availableWidth - totalWidth) / 2;
      const startY = margin + (availableHeight - totalHeight) / 2;
      
      return {
        photoWidth: correctedWidth,
        photoHeight: correctedHeight,
        startX,
        startY,
        gap,
        cols: 2,
        rows: 5,
        textX: 5, // Text position at left edge
        textY: pageHeight / 2 // Center vertically
      };
    } else {
      // A4 Landscape: 842 x 595 points  
      const pageWidth = 842;
      const pageHeight = 595;
      const margin = 10;
      const headerHeight = 25;
      const gap = 2.83; // 1mm in points
      
      // Available space for photos
      const availableWidth = pageWidth - (2 * margin);
      const availableHeight = pageHeight - (2 * margin) - headerHeight;
      
      // Calculate photo size for 3x3 grid
      const photoWidth = Math.floor((availableWidth - (2 * gap)) / 3);
      const photoHeight = Math.floor((availableHeight - (2 * gap)) / 3);
      
      // Ensure aspect ratio
      const correctedHeight = Math.min(photoHeight, photoWidth / aspectRatio);
      const correctedWidth = correctedHeight * aspectRatio;
      
      // Center the grid
      const totalWidth = (correctedWidth * 3) + (gap * 2);
      const startX = margin + (availableWidth - totalWidth) / 2;
      const startY = margin + headerHeight;
      
      return {
        photoWidth: correctedWidth,
        photoHeight: correctedHeight,
        startX,
        startY,
        gap,
        cols: 3,
        rows: 3,
        headerY: margin + 5
      };
    }
  };

  const layout = calculateLayout();

  // Styles
  const styles = StyleSheet.create({
    page: {
      backgroundColor: '#ffffff',
    },
    rotatedText: {
      position: 'absolute',
      left: layout.textX,
      top: layout.textY,
      fontSize: 12,
      fontFamily: 'Helvetica-Bold',
      color: '#000000',
      transform: 'rotate(-90deg)',
      transformOrigin: 'left center',
    },
    horizontalHeader: {
      position: 'absolute',
      top: layout.headerY,
      left: 10,
      right: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    headerText: {
      fontSize: 12,
      fontFamily: 'Helvetica-Bold',
      color: '#000000',
    }
  });

  // Create a single page
  const createPage = (photoSet: ApiPhotoSet, setTitle: string, pageKey: string) => {
    const elements = [];
    
    // Add header/title
    if (layoutMode === 'portrait') {
      // Rotated text on left edge
      const headerText = `${competitionName || ''} • ${setTitle}`;
      elements.push(
        React.createElement(Text, {
          key: `header-${pageKey}`,
          style: styles.rotatedText
        }, headerText)
      );
    } else {
      // Horizontal header
      elements.push(
        React.createElement(View, {
          key: `header-${pageKey}`,
          style: styles.horizontalHeader
        }, [
          React.createElement(Text, {
            key: 'comp-name',
            style: styles.headerText
          }, competitionName || ''),
          React.createElement(Text, {
            key: 'set-title', 
            style: styles.headerText
          }, setTitle)
        ])
      );
    }
    
    // Add photos
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        const index = row * layout.cols + col;
        const photo = photoSet.photos[index];
        
        if (photo) {
          const dataUrl = getPhotoDataUrl(photo.id, pageKey === 'set1' ? 'set1' : 'set2');
          if (dataUrl) {
            const x = layout.startX + col * (layout.photoWidth + layout.gap);
            const y = layout.startY + row * (layout.photoHeight + layout.gap);
            
            elements.push(
              React.createElement(Image, {
                key: `photo-${pageKey}-${index}`,
                src: dataUrl,
                style: {
                  position: 'absolute',
                  left: x,
                  top: y,
                  width: layout.photoWidth,
                  height: layout.photoHeight,
                }
              })
            );
          }
        }
      }
    }
    
    return React.createElement(Page, {
      key: pageKey,
      size: 'A4',
      orientation: layoutMode,
      style: styles.page
    }, elements);
  };

  // Create document
  const pages = [];
  
  if (set1.photos.length > 0) {
    pages.push(createPage(set1, set1.title, 'set1'));
  }
  
  if (set2.photos.length > 0) {
    pages.push(createPage(set2, set2.title, 'set2'));
  }
  
  console.log(`Clean PDF: Creating ${pages.length} pages`);
  
  const pdfDocument = React.createElement(Document, {}, pages);

  // Generate and download
  try {
    const blob = await pdf(pdfDocument).toBlob();
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `navigation-photos-${timestamp}.pdf`;
    link.click();
    
    URL.revokeObjectURL(url);
    console.log('Clean PDF generated successfully');
  } catch (error) {
    console.error('PDF generation failed:', error);
    throw error;
  }
};