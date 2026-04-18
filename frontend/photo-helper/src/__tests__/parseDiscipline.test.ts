import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseDiscipline } from '../utils/parseDiscipline';

// parseDiscipline is load-bearing: `isPrecision` flips PDF set2 drop,
// 9-photo cap, layout auto-switch, and UI gating. A silent downgrade to
// rally (e.g. launcher drift emitting `?Discipline=Precision`) defeats
// every feedback-2026-04-18 fix. These tests pin the allowlist exactly.

describe('parseDiscipline', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  // Valid values — exact allowlist
  it('accepts ?discipline=precision', () => {
    expect(parseDiscipline('?discipline=precision')).toBe('precision');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('accepts ?discipline=rally', () => {
    expect(parseDiscipline('?discipline=rally')).toBe('rally');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // Absent / empty — silent fallback (not a misconfiguration, just web use)
  it('returns rally for empty search string', () => {
    expect(parseDiscipline('')).toBe('rally');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns rally when discipline param is absent', () => {
    expect(parseDiscipline('?foo=bar')).toBe('rally');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns rally when discipline is an empty string', () => {
    expect(parseDiscipline('?discipline=')).toBe('rally');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // Invalid values — fallback + console.error (visible during QA)
  it('returns rally for mixed-case precision (strict allowlist)', () => {
    expect(parseDiscipline('?discipline=Precision')).toBe('rally');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('returns rally for uppercase RALLY', () => {
    expect(parseDiscipline('?discipline=RALLY')).toBe('rally');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('returns rally for typo "presicion"', () => {
    expect(parseDiscipline('?discipline=presicion')).toBe('rally');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('returns rally for completely wrong value', () => {
    expect(parseDiscipline('?discipline=rallycross')).toBe('rally');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('logs the invalid value so launcher drift is visible in devtools', () => {
    parseDiscipline('?discipline=Precision');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Precision'),
    );
  });

  // Multi-param / coexistence with other launcher params
  it('extracts discipline when other params precede it', () => {
    expect(parseDiscipline('?competitionId=abc&discipline=precision')).toBe('precision');
  });

  it('extracts discipline when other params follow it', () => {
    expect(parseDiscipline('?discipline=rally&foo=bar')).toBe('rally');
  });

  // URL-encoded edge cases — strict equality means encoded whitespace still
  // counts as an invalid value and surfaces a console error.
  it('does NOT accept URL-encoded whitespace around valid value', () => {
    expect(parseDiscipline('?discipline=%20precision')).toBe('rally');
    expect(errorSpy).toHaveBeenCalledOnce();
  });
});
