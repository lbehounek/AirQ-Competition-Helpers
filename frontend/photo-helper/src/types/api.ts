/**
 * Shared API type definitions to prevent interface drift across components
 */

import type { Photo } from './index';

export type CandidateFlag = 'pick' | 'neutral' | 'reject';

export interface ApiPhoto {
  id: string;
  sessionId: string; // Required for image cache and API consistency
  url: string;
  filename: string;
  canvasState: Photo['canvasState']; // Inherits from main Photo type
  label: string;
  uploadedAt?: string; // Optional for backward compatibility
  /**
   * Triage flag — meaningful only while the photo lives in the candidates
   * pool. Cleared on promotion to a slot, defaulted to `'pick'` on demotion
   * from a slot back to the tray. See docs/CANDIDATE_PHOTOS.md.
   */
  flag?: CandidateFlag;
}

export interface ApiPhotoSet {
  title: string;
  photos: ApiPhoto[];
}

export interface CandidatePool {
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
  /**
   * Slotless workspace pool of photos the user is still triaging. Photos here
   * never appear in the PDF; the export logic in `buildPdfSets` reads `sets`
   * only. Global (not per-mode) — see docs/CANDIDATE_PHOTOS.md "Data model".
   */
  candidates?: CandidatePool;
  // Mode-specific photo storage for separate track/turning point collections
  setsTrack?: {
    set1: ApiPhotoSet;
    set2: ApiPhotoSet;
  };
  setsTurning?: {
    set1: ApiPhotoSet;
    set2: ApiPhotoSet;
  };
}
