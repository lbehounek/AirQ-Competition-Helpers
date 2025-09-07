import React from 'react';
import { Document, Page, Image, pdf, StyleSheet } from '@react-pdf/renderer';
import type { ApiPhotoSet } from '../types/api';

// Polyfill Buffer for @react-pdf/renderer
import { Buffer } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

// Brilliant workaround: Render text as image to bypass @react-pdf/renderer Unicode issues

interface TextImageResult {
  dataUrl: string;
  width: number;
  height: number;
}

const createTextImage = (text: string, isRotated: boolean = true): TextImageResult | null => {
  if (!text.trim()) return null;
  
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    // High-resolution rendering constants
    const PIXEL_RATIO = 3; // 3x resolution for crisp PDF text
    const FONT_SIZE = 14;
    const FONT_FAMILY = 'Arial, sans-serif'; // Excellent Unicode support
    const HORIZONTAL_PADDING = 40;
    const VERTICAL_PADDING = 12;
    const MIN_ROTATED_HEIGHT = 400; // Minimum height for rotated text
    
    // Configure font for text measurement
    ctx.font = `bold ${FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    
    // Measure text dimensions
    const metrics = ctx.measureText(text);
    const textWidth = Math.ceil(metrics.width);
    const textHeight = Math.ceil(FONT_SIZE * 1.4);
    
    // Calculate logical canvas dimensions
    const logicalWidth = isRotated 
      ? textHeight + VERTICAL_PADDING
      : textWidth + HORIZONTAL_PADDING;
    
    const logicalHeight = isRotated
      ? Math.max(textWidth + HORIZONTAL_PADDING, MIN_ROTATED_HEIGHT)
      : textHeight + VERTICAL_PADDING;
    
    // Set high-resolution canvas size
    canvas.width = logicalWidth * PIXEL_RATIO;
    canvas.height = logicalHeight * PIXEL_RATIO;
    ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
    
    // Configure high-quality text rendering
    ctx.font = `bold ${FONT_SIZE}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Draw text with rotation if needed
    if (isRotated) {
      ctx.translate(logicalWidth / 2, logicalHeight / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(text, 0, 0);
    } else {
      ctx.fillText(text, logicalWidth / 2, logicalHeight / 2);
    }
    
    return {
      dataUrl: canvas.toDataURL('image/png', 1.0),
      width: logicalWidth,
      height: logicalHeight
    };
  } catch (error) {
    console.error('Failed to create text image:', error);
    return null;
  }
};

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

  // Clean layout calculations (portrait accepts dynamic gutter width)
  const calculateLayout = (portraitGutterWidth: number = 15) => {
    if (layoutMode === 'portrait') {
      // A4 Portrait: 595 x 842 points
      const pageWidth = 595;
      const pageHeight = 842;
      const margin = 5;
      const textWidth = portraitGutterWidth; // Width for rotated text along left edge (measured)
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


  // Simplified styles - no more text styling needed!
  const styles = StyleSheet.create({
    page: {
      backgroundColor: '#ffffff',
    }
  });

  // Create a single page (compute a local layout per page)
  const createPage = (photoSet: ApiPhotoSet, setTitle: string, pageKey: string) => {
    const elements: any[] = [];
    let localLayout = calculateLayout(15);
    
    // Add header/title
    if (layoutMode === 'portrait') {
      // Create rotated text as image - perfect Czech character support!
      const headerText = `${competitionName || ''} • ${setTitle}`;
      const headerImage = createTextImage(headerText, true);
      if (headerImage) {
        // Recalculate layout with actual measured gutter width
        const measuredGutter = Math.max(15, Math.ceil(headerImage.width));
        localLayout = calculateLayout(measuredGutter);
        // Calculate positioning to center along left edge
        const pageHeight = 842; // A4 portrait height
        const topPosition = (pageHeight - headerImage.height) / 2; // Center vertically
        
        elements.push(
          React.createElement(Image, {
            key: `header-${pageKey}`,
            src: headerImage.dataUrl,
            style: {
              position: 'absolute',
              left: 2, // Close to left edge
              top: topPosition,
              width: headerImage.width, // Use actual canvas width
              height: headerImage.height, // Use actual canvas height
            }
          })
        );
      }
    } else {
      // Horizontal header as images
      const competitionImage = createTextImage(competitionName || '', false);
      const setTitleImage = createTextImage(setTitle, false);
      
      if (competitionImage) {
        elements.push(
          React.createElement(Image, {
            key: `comp-name-${pageKey}`,
            src: competitionImage.dataUrl,
            style: {
              position: 'absolute',
              left: 10,
              top: localLayout.headerY || 10,
              width: competitionImage.width,
              height: competitionImage.height,
            }
          })
        );
      }
      
      if (setTitleImage) {
        elements.push(
          React.createElement(Image, {
            key: `set-title-${pageKey}`,
            src: setTitleImage.dataUrl,
            style: {
              position: 'absolute',
              right: 10,
              top: localLayout.headerY || 10,
              width: setTitleImage.width,
              height: setTitleImage.height,
            }
          })
        );
      }
    }
    
    // Add photos
    for (let row = 0; row < localLayout.rows; row++) {
      for (let col = 0; col < localLayout.cols; col++) {
        const index = row * localLayout.cols + col;
        const photo = photoSet.photos[index];
        
        if (photo) {
          const dataUrl = getPhotoDataUrl(photo.id, pageKey === 'set1' ? 'set1' : 'set2');
          if (dataUrl) {
            const x = localLayout.startX + col * (localLayout.photoWidth + localLayout.gap);
            const y = localLayout.startY + row * (localLayout.photoHeight + localLayout.gap);
            
            elements.push(
              React.createElement(Image, {
                key: `photo-${pageKey}-${index}`,
                src: dataUrl,
                style: {
                  position: 'absolute',
                  left: x,
                  top: y,
                  width: localLayout.photoWidth,
                  height: localLayout.photoHeight,
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
    // Defer revocation to avoid aborting download (e.g., Safari)
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error('PDF generation failed:', error);
    throw error;
  }
};