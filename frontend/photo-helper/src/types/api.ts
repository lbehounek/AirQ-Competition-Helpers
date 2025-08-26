/**
 * Shared API type definitions to prevent interface drift across components
 */

import type { Photo } from './index';

export interface ApiPhoto {
  id: string;
  sessionId: string; // Required for image cache and API consistency
  url: string;
  filename: string;
  canvasState: Photo['canvasState']; // Inherits from main Photo type
  label: string;
  uploadedAt?: string; // Optional for backward compatibility
}

export interface ApiPhotoSet {
  title: string;
  photos: ApiPhoto[];
}

export interface ApiPhotoSession {
  id: string;
  version: number;
  createdAt: string; // ISO date string from API
  updatedAt: string; // ISO date string from API
  mode: 'track' | 'turningpoint';
  competition_name: string;
  sets: {
    set1: ApiPhotoSet;
    set2: ApiPhotoSet;
  };
}
