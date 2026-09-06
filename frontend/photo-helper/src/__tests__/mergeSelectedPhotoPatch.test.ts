import { describe, it, expect } from 'vitest';
import { mergeSelectedPhotoPatch } from '../utils/mergeSelectedPhotoPatch';
import { makeCanvasState } from './support/testHelpers';
import type { ApiPhoto } from '../types/api';

// This is the updater AppApi hands to `setSelectedPhoto`. Because commits are
// debounced, one can arrive AFTER the modal closed or paged to another photo —
// so "returns prev untouched" is the behaviour that keeps a late commit from
// re-opening the editor or reverting the new selection. Pin it here rather
// than by mounting AppApi.

type Selection = {
  photo: ApiPhoto;
  setKey: 'set1' | 'set2' | 'candidates';
  label: string;
};

function makeSelection(id: string): Selection {
  return {
    photo: {
      id,
      sessionId: 'sess-1',
      url: 'blob:test/1',
      filename: `${id}.jpg`,
      canvasState: makeCanvasState({ brightness: 10, circle: { x: 1, y: 2, radius: 30, color: 'red', visible: true } }),
      label: '',
    },
    setKey: 'set1',
    label: 'A',
  };
}

describe('mergeSelectedPhotoPatch', () => {
  it('returns null when nothing is selected (a late commit must not re-open the modal)', () => {
    expect(mergeSelectedPhotoPatch(null, 'photo-1', { brightness: 5 })).toBeNull();
  });

  it('returns the SAME reference when the selection is a different photo', () => {
    const prev = makeSelection('photo-1');
    const result = mergeSelectedPhotoPatch(prev, 'photo-2', { brightness: 5 });
    expect(result).toBe(prev);
  });

  it('merges the patch into canvasState for the matching photo', () => {
    const prev = makeSelection('photo-1');
    const result = mergeSelectedPhotoPatch(prev, 'photo-1', { brightness: 5 })!;

    expect(result).not.toBe(prev);
    expect(result.photo.canvasState.brightness).toBe(5);
    // Untouched fields survive…
    expect(result.photo.canvasState.scale).toBe(prev.photo.canvasState.scale);
    expect(result.photo.canvasState.labelPosition).toBe(prev.photo.canvasState.labelPosition);
    // …and the original object is not mutated.
    expect(prev.photo.canvasState.brightness).toBe(10);
    // Non-canvasState fields of the selection ride along unchanged.
    expect(result.setKey).toBe('set1');
    expect(result.label).toBe('A');
  });

  it('replaces a nested sub-object wholesale rather than deep-merging it', () => {
    const prev = makeSelection('photo-1');
    const result = mergeSelectedPhotoPatch(prev, 'photo-1', {
      whiteBalance: { temperature: 20, tint: 0, auto: false },
    })!;
    expect(result.photo.canvasState.whiteBalance).toEqual({ temperature: 20, tint: 0, auto: false });
  });

  it('clears the circle when the patch carries { circle: null }', () => {
    const prev = makeSelection('photo-1');
    expect(prev.photo.canvasState.circle).not.toBeNull();
    const result = mergeSelectedPhotoPatch(prev, 'photo-1', { circle: null })!;
    expect(result.photo.canvasState.circle).toBeNull();
  });
});
