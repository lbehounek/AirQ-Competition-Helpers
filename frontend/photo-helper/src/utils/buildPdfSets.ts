import { generateTurningPointLabels } from './imageProcessing';
import type { ApiPhoto, ApiPhotoSet } from '../types/api';

export type PdfSetsInput = {
  mode: 'turningpoint' | 'track';
  layoutMode: 'landscape' | 'portrait';
  isPrecision: boolean;
  set1: ApiPhotoSet;
  set2: ApiPhotoSet;
  /** Track-mode label generator (letters/digits with dot). */
  generateLabel: (index: number, offset?: number) => string;
};

export type LabeledPhoto = ApiPhoto & { label: string };
export type LabeledSet = ApiPhotoSet & { photos: LabeledPhoto[] };

export type PdfSetsOutput = {
  set1WithLabels: LabeledSet;
  set2WithLabels: LabeledSet;
};

/**
 * Build the labeled `{set1WithLabels, set2WithLabels}` pair that
 * `generatePDF` consumes.
 *
 * Precision mode drops set2 from the output (and from turningpoint
 * label generation) so a stale set2 — e.g. user switched discipline
 * mid-session — does not leak into the printed PDF. This is the core
 * competition-artefact correctness guarantee from feedback 2026-04-18.
 *
 * Pure function, no React / session hook dependencies — tests can
 * drive the full behavior matrix directly.
 */
export function buildPdfSets(input: PdfSetsInput): PdfSetsOutput {
  const { mode, layoutMode, isPrecision, set1, set2, generateLabel } = input;

  if (mode === 'turningpoint') {
    const set1Count = set1.photos.length;
    const set2Count = isPrecision ? 0 : set2.photos.length;
    const turningPointLabels = generateTurningPointLabels(set1Count, set2Count, layoutMode);

    const set1WithLabels: LabeledSet = {
      ...set1,
      photos: set1.photos.map((photo, index) => ({
        ...photo,
        label: turningPointLabels.set1[index] || 'X',
      })),
    };

    const set2WithLabels: LabeledSet = isPrecision
      ? { ...set2, photos: [] }
      : {
          ...set2,
          photos: set2.photos.map((photo, index) => ({
            ...photo,
            label: turningPointLabels.set2[index] || 'X',
          })),
        };

    return { set1WithLabels, set2WithLabels };
  }

  // Track mode — letter/digit labels continue across sets in rally,
  // and set2 is dropped for precision.
  const set1WithLabels: LabeledSet = {
    ...set1,
    photos: set1.photos.map((photo, index) => ({
      ...photo,
      label: generateLabel(index),
    })),
  };

  const set1Count = set1.photos.length;
  const set2WithLabels: LabeledSet = isPrecision
    ? { ...set2, photos: [] }
    : {
        ...set2,
        photos: set2.photos.map((photo, index) => ({
          ...photo,
          label: generateLabel(index, set1Count),
        })),
      };

  return { set1WithLabels, set2WithLabels };
}
