/**
 * `imageProcessing` is down to two pure helpers. The surface assertion at the
 * bottom is the point of the file: it fails if a dead export is resurrected,
 * which is how the divergent third brightness/contrast implementation got to
 * live here unnoticed in the first place.
 */

import { describe, it, expect } from 'vitest';
import * as imageProcessing from '../utils/imageProcessing';
import { generateTurningPointLabels, isValidImageFile } from '../utils/imageProcessing';

/** Build a `File` with a chosen size without allocating that many bytes. */
const makeFile = (name: string, type: string, size = 1024): File => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

describe('generateTurningPointLabels', () => {
  it('labels a single photo as the start point', () => {
    expect(generateTurningPointLabels(1, 0)).toEqual({ set1: ['SP'], set2: [] });
  });

  it('splits SP / TPn / FP across both sets', () => {
    expect(generateTurningPointLabels(2, 3)).toEqual({
      set1: ['SP', 'TP1'],
      set2: ['TP2', 'TP3', 'FP'],
    });
  });

  it('returns empty arrays when there are no photos', () => {
    expect(generateTurningPointLabels(0, 0)).toEqual({ set1: [], set2: [] });
  });
});

describe('isValidImageFile', () => {
  it('accepts the supported MIME types', () => {
    expect(isValidImageFile(makeFile('a.jpg', 'image/jpeg'))).toBe(true);
    expect(isValidImageFile(makeFile('a.png', 'image/png'))).toBe(true);
  });

  it('falls back to the extension when the type is missing (case-insensitively)', () => {
    expect(isValidImageFile(makeFile('PHOTO.JPG', ''))).toBe(true);
  });

  it('rejects unsupported formats and oversized files', () => {
    expect(isValidImageFile(makeFile('a.gif', 'image/gif'))).toBe(false);
    expect(isValidImageFile(makeFile('a.jpg', 'image/jpeg', 21 * 1024 * 1024))).toBe(false);
  });
});

describe('module surface', () => {
  it('exports exactly the two live helpers', () => {
    expect(Object.keys(imageProcessing).sort()).toEqual([
      'generateTurningPointLabels',
      'isValidImageFile',
    ]);
  });
});
