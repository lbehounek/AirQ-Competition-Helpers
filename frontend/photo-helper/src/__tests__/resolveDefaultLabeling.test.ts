import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveDefaultLabeling } from '../contexts/LabelingContext';

// Precision flying competition rules require photos to be labeled with
// numbers, not letters. The default labeling MUST follow the discipline
// emitted by the desktop launcher; a silent letter default for precision
// produces a non-compliant printed photo set.

describe('resolveDefaultLabeling', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // parseDiscipline logs invalid values; silence to keep test output clean.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('defaults to numbers for precision discipline', () => {
    expect(resolveDefaultLabeling('?discipline=precision').id).toBe('numbers');
  });

  it('defaults to letters for rally discipline', () => {
    expect(resolveDefaultLabeling('?discipline=rally').id).toBe('letters');
  });

  it('defaults to letters when discipline is absent (web / legacy)', () => {
    expect(resolveDefaultLabeling('').id).toBe('letters');
  });

  it('defaults to letters when an unknown discipline is supplied', () => {
    // Falls through parseDiscipline allowlist → rally → letters.
    expect(resolveDefaultLabeling('?discipline=Precision').id).toBe('letters');
  });

  it('extracts discipline among multiple URL params', () => {
    expect(
      resolveDefaultLabeling('?competitionId=abc&discipline=precision').id,
    ).toBe('numbers');
  });
});
