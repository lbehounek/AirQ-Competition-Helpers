import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { Photo } from '../types';
import { 
  autoCropTo43, 
  applyImageAdjustments 
} from '../utils/imageProcessing';
import { 
  initializePhotoCanvas,
  drawImageOnCanvas,
  drawLabel,
  getCanvasMousePosition,
  constrainPosition,
  CANVAS_SETTINGS
} from '../utils/canvasUtils';

interface PhotoEditorProps {
  photo: Photo;
  label: string;
  onUpdate: (canvasState: Photo['canvasState']) => void;
  onRemove: () => void;
  size?: 'grid' | 'large';
}

export const PhotoEditor: React.FC<PhotoEditorProps> = ({
  photo,
  label,
  onUpdate,
  onRemove,
  size = 'grid'
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [croppedImage, setCroppedImage] = useState<HTMLCanvasElement | null>(null);
  
  // Canvas dimensions based on size
  const canvasSize = size === 'large' 
    ? { width: 400, height: 300 } 
    : { width: CANVAS_SETTINGS.width, height: CANVAS_SETTINGS.height };

  /**
   * Initialize and crop the original image
   */
  useEffect(() => {
    if (photo.originalImage) {
      const cropped = autoCropTo43(photo.originalImage);
      setCroppedImage(cropped);
    }
  }, [photo.originalImage]);

  /**
   * Render the canvas when cropped image or canvas state changes
   */
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !croppedImage) return;

    // Clear and draw the image with current position and scale
    drawImageOnCanvas(
      canvas,
      croppedImage,
      photo.canvasState.position,
      photo.canvasState.scale
    );

    // Apply image adjustments
    if (photo.canvasState.brightness !== 0 || photo.canvasState.contrast !== 1) {
      applyImageAdjustments(canvas, {
        brightness: photo.canvasState.brightness,
        contrast: photo.canvasState.contrast,
        scale: photo.canvasState.scale
      });
    }

    // Draw the label
    drawLabel(canvas, label, 'bottom-left');
  }, [croppedImage, photo.canvasState, label]);

  /**
   * Initialize canvas and render when component mounts
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    
    if (croppedImage) {
      renderCanvas();
    } else {
      initializePhotoCanvas(canvas);
    }
  }, [canvasSize.width, canvasSize.height, croppedImage, renderCanvas]);

  /**
   * Re-render when canvas state changes
   */
  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  /**
   * Handle mouse down - start dragging
   */
  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!croppedImage) return;
    
    const canvas = canvasRef.current!;
    const mousePos = getCanvasMousePosition(canvas, event.nativeEvent);
    
    setIsDragging(true);
    setDragStart(mousePos);
    event.preventDefault();
  };

  /**
   * Handle mouse move - update position while dragging
   */
  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !croppedImage) return;

    const canvas = canvasRef.current!;
    const mousePos = getCanvasMousePosition(canvas, event.nativeEvent);
    
    const deltaX = mousePos.x - dragStart.x;
    const deltaY = mousePos.y - dragStart.y;
    
    const newPosition = {
      x: photo.canvasState.position.x + deltaX,
      y: photo.canvasState.position.y + deltaY
    };

    // Constrain position to keep image within bounds
    const constrainedPosition = constrainPosition(
      newPosition,
      { width: croppedImage.width, height: croppedImage.height },
      canvasSize,
      photo.canvasState.scale
    );

    onUpdate({
      ...photo.canvasState,
      position: constrainedPosition
    });

    setDragStart(mousePos);
  };

  /**
   * Handle mouse up - stop dragging
   */
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  /**
   * Handle zoom/scale changes
   */
  const handleScaleChange = (newScale: number) => {
    if (!croppedImage) return;

    const clampedScale = Math.min(3, Math.max(0.1, newScale));
    
    // Adjust position to keep image centered when scaling
    const scaleDelta = clampedScale - photo.canvasState.scale;
    const centerOffsetX = (croppedImage.width * scaleDelta) / 2;
    const centerOffsetY = (croppedImage.height * scaleDelta) / 2;
    
    const newPosition = {
      x: photo.canvasState.position.x - centerOffsetX,
      y: photo.canvasState.position.y - centerOffsetY
    };

    const constrainedPosition = constrainPosition(
      newPosition,
      { width: croppedImage.width, height: croppedImage.height },
      canvasSize,
      clampedScale
    );

    onUpdate({
      ...photo.canvasState,
      position: constrainedPosition,
      scale: clampedScale
    });
  };

  /**
   * Handle brightness/contrast adjustments
   */
  const handleBrightnessChange = (brightness: number) => {
    onUpdate({
      ...photo.canvasState,
      brightness: Math.min(100, Math.max(-100, brightness))
    });
  };

  const handleContrastChange = (contrast: number) => {
    onUpdate({
      ...photo.canvasState,
      contrast: Math.min(2, Math.max(0.5, contrast))
    });
  };

  /**
   * Reset to default state
   */
  const handleReset = () => {
    onUpdate({
      position: { x: 0, y: 0 },
      scale: 1,
      brightness: 0,
      contrast: 1
    });
  };

  return (
    <div className="relative group">
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className={`border border-gray-300 rounded ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        } ${size === 'grid' ? 'w-full h-full' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Control overlay - only show on hover for grid size */}
      <div className={`absolute inset-0 bg-black bg-opacity-50 transition-opacity ${
        size === 'grid' 
          ? 'opacity-0 group-hover:opacity-100' 
          : 'opacity-0'
      }`}>
        <div className="absolute top-2 right-2 flex gap-1">
          {/* Remove button */}
          <button
            onClick={onRemove}
            className="w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600 transition-colors"
            title="Remove photo"
          >
            ×
          </button>
        </div>
      </div>

      {/* Large size controls */}
      {size === 'large' && (
        <div className="mt-4 space-y-4">
          {/* Scale control */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Zoom: {Math.round(photo.canvasState.scale * 100)}%
            </label>
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.1}
              value={photo.canvasState.scale}
              onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Brightness control */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Brightness: {photo.canvasState.brightness > 0 ? '+' : ''}{photo.canvasState.brightness}
            </label>
            <input
              type="range"
              min={-100}
              max={100}
              step={1}
              value={photo.canvasState.brightness}
              onChange={(e) => handleBrightnessChange(parseInt(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Contrast control */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contrast: {Math.round(photo.canvasState.contrast * 100)}%
            </label>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={photo.canvasState.contrast}
              onChange={(e) => handleContrastChange(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600 transition-colors"
            >
              Reset
            </button>
            <button
              onClick={onRemove}
              className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Photo info overlay for grid */}
      {size === 'grid' && (
        <div className="absolute bottom-1 left-1 bg-black bg-opacity-75 text-white text-xs px-1 rounded">
          {label}
        </div>
      )}
    </div>
  );
};
