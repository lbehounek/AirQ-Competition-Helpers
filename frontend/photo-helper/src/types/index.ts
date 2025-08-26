export interface Photo {
  id: string;
  file: File;
  originalImage?: HTMLImageElement;
  canvasState: {
    position: { x: number; y: number };
    scale: number;
    brightness: number;
    contrast: number;
    sharpness: number; // 0 to 100, where 0 is no sharpening
    whiteBalance: {
      temperature: number; // -100 to 100, where 0 is neutral
      tint: number; // -100 to 100, where 0 is neutral
      auto: boolean; // Whether to use auto white balance
    };
    labelPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    circle?: {
      x: number;        // Position in base coordinates (0-300)
      y: number;        // Position in base coordinates (0-225)
      radius: number;   // Radius in pixels (base coordinates)
      color: 'white' | 'red' | 'yellow';
      visible: boolean;
    } | null;
  };
  label: string; // A, B, C, etc.
}

export interface PhotoSet {
  title: string;
  photos: Photo[];
}

export interface PhotoSession {
  id: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  mode: 'track' | 'turningpoint';
  layoutMode?: 'landscape' | 'portrait'; // Optional for backward compatibility
  competition_name: string;
  sets: {
    set1: PhotoSet;
    set2: PhotoSet;
  };
}

export interface DragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface CanvasSettings {
  width: number;
  height: number;
  aspectRatio: number; // 4:3 = 1.333...
}

export interface ImageAdjustments {
  brightness: number; // -100 to +100
  contrast: number;   // 0.5 to 2.0 (1.0 = normal)
  scale: number;      // 0.5 to 3.0 (1.0 = normal)
}
