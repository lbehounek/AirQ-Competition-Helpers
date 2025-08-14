import React from 'react';
import type { PhotoSet } from '../types';
import { PhotoEditor } from './PhotoEditor';

interface PhotoGridProps {
  photoSet: PhotoSet;
  setKey: 'set1' | 'set2';
  onPhotoUpdate: (photoId: string, canvasState: any) => void;
  onPhotoRemove: (photoId: string) => void;
}

export const PhotoGrid: React.FC<PhotoGridProps> = ({
  photoSet,
  setKey,
  onPhotoUpdate,
  onPhotoRemove
}) => {
  // Create array of 9 slots (3x3 grid)
  const gridSlots = Array.from({ length: 9 }, (_, index) => {
    const photo = photoSet.photos[index] || null;
    const label = String.fromCharCode(65 + index); // A, B, C, etc.
    
    return {
      index,
      photo,
      label,
      id: `${setKey}-slot-${index}`
    };
  });

  return (
    <div className="w-full">
      {/* Set Title Display */}
      <div className="mb-4 text-center">
        <h3 className="text-xl font-bold text-gray-800">
          {photoSet.title || `${setKey.toUpperCase()}`}
        </h3>
        <p className="text-sm text-gray-600">
          {photoSet.photos.length}/9 photos • Grid layout preview
        </p>
      </div>

      {/* 3x3 Photo Grid */}
      <div className="grid grid-cols-3 gap-2 bg-white p-4 border-2 border-gray-200 rounded-lg shadow-sm">
        {gridSlots.map((slot) => (
          <div 
            key={slot.id}
            className="aspect-[4/3] bg-gray-50 border border-gray-300 rounded overflow-hidden relative group"
          >
            {slot.photo ? (
              <PhotoEditor
                photo={slot.photo}
                label={slot.label}
                onUpdate={(canvasState) => onPhotoUpdate(slot.photo!.id, canvasState)}
                onRemove={() => onPhotoRemove(slot.photo!.id)}
                size="grid" // Small size for grid view
              />
            ) : (
              <PhotoGridSlotEmpty 
                label={slot.label}
                position={slot.index + 1}
              />
            )}
          </div>
        ))}
      </div>

      {/* Grid Stats */}
      <div className="mt-4 text-center">
        <div className="inline-flex items-center gap-4 text-sm text-gray-600">
          <span className="flex items-center gap-1">
            <div className="w-3 h-3 bg-blue-500 rounded"></div>
            Photos: {photoSet.photos.length}
          </span>
          <span className="flex items-center gap-1">
            <div className="w-3 h-3 bg-gray-300 rounded"></div>
            Empty: {9 - photoSet.photos.length}
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Empty slot component for the grid
 */
interface PhotoGridSlotEmptyProps {
  label: string;
  position: number;
}

const PhotoGridSlotEmpty: React.FC<PhotoGridSlotEmptyProps> = ({ 
  label, 
  position 
}) => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 text-gray-400">
      {/* Position indicator */}
      <div className="text-2xl font-bold mb-1">
        {label}
      </div>
      
      {/* Position text */}
      <div className="text-xs text-center px-2">
        Position {position}
      </div>
      
      {/* Placeholder icon */}
      <div className="mt-2 opacity-50">
        <svg 
          className="w-6 h-6" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={1.5} 
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" 
          />
        </svg>
      </div>
    </div>
  );
};
