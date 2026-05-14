/**
 * Shared API type definitions to prevent interface drift across components
 */

import type { Photo } from './index';

export type CandidateFlag = 'pick' | 'neutral' | 'reject';

/**
 * Result of a photo-add operation (`addPhotosToSet`, `addPhotosToTurningPoint`).
 * Discriminated union so callers can react specifically to smart-drop routing
 * vs. error paths without sniffing `result === undefined` (PR #62 review IMP-6).
 *
 * The hook still calls `setError` on the `err` arm for the global Alert
 * banner; the returned result is for callers that want to react more
 * specifically (toast on tray-routing, dialog on over-capacity, etc.).
 */
export type AddPhotosResult =
  | { kind: 'ok'; routedTo: 'slot' | 'tray'; count: number }
  | { kind: 'err'; reason: 'no-competition' | 'over-capacity' | 'unknown'; message: string };

// `capturedAt` is the EXIF source; `subjectAt` is the user-placed marker coord that flows to the answer sheet. See docs/photo-map-culling/implementation-plan.md Phase 0.
export interface ApiPhotoGps {
  capturedAt?: { lng: number; lat: number; altitude?: number };
  subjectAt?: { lng: number; lat: number };
  timestamp?: string;
}

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
  gps?: ApiPhotoGps;
  /**
   * ISO 8601 stamp of when `label` was last set, in EITHER app
   * (set by photo-helper directly OR by useMapPicksSync mirroring a
   * map-corridors edit). Drives the cross-app "newer wins" tie-break
   * in `useEditorPicksSync` (map side) and `useMapPicksSync` (editor
   * side). Absent on legacy data.
   */
  labelUpdatedAt?: string;
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
