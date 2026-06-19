// Synthetic "no photo" placeholder cell for a missing turning-point photo.
//
// A placeholder is a normal ApiPhoto kept IN the slot array at its index, so the
// SP/TP/FP numbering of the surrounding photos stays correct (labels are
// index-based — see buildPdfSets / generateTurningPointLabels). It carries no
// image bytes: url='' so it's never written to OPFS (saveSessionPhotos is
// blob-gated) and never loaded into the image cache. The editor renders it as a
// blank labeled frame; the PDF draws a blank labeled cell instead of aborting.
// See types/api.ts ApiPhoto.isPlaceholder.

import type { ApiPhoto } from '../types/api';
import { createDefaultCanvasState } from '../hooks/usePhotoSessionOPFS';

/** Marks a synthetic placeholder id. Mirrors the `pm-` map-origin convention. */
export const PLACEHOLDER_ID_PREFIX = 'placeholder-';

/** True when an id belongs to a no-photo placeholder. */
export function isPlaceholderId(id: string): boolean {
  return id.startsWith(PLACEHOLDER_ID_PREFIX);
}

/**
 * Build a "no photo" placeholder ApiPhoto. `filename` is a localized display
 * string ("Bez fotky" / "No photo") — screen-only, never used for matching.
 * `label` starts empty; it's overwritten by the by-index labeling in
 * buildPdfSets and the grid (so the placeholder shows its TP/SP/FP number).
 */
export function createPlaceholderPhoto(sessionId: string, filename: string): ApiPhoto {
  return {
    id: `${PLACEHOLDER_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    url: '',
    filename,
    canvasState: createDefaultCanvasState(),
    label: '',
    isPlaceholder: true,
  };
}
