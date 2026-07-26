import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveDiscipline, setBootDiscipline } from '../utils/parseDiscipline';

// resolveDiscipline is load-bearing: `isPrecision` flips PDF set2 drop,
// 9-photo cap, layout auto-switch, and UI gating. A silent downgrade to
// rally (e.g. launcher drift emitting `?Discipline=Precision`) defeats
// every feedback-2026-04-18 fix. These tests pin the allowlist exactly.

describe('resolveDiscipline', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The boot-resolved value is module-level state, so it survives between
    // tests in the same worker. Clear it so these cases pin the URL rules
    // alone; the fallback chain is covered in its own describe below.
    setBootDiscipline(null);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  // Valid values — exact allowlist
  it('accepts ?discipline=precision', () => {
    expect(resolveDiscipline('?discipline=precision')).toBe('precision');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('accepts ?discipline=rally', () => {
    expect(resolveDiscipline('?discipline=rally')).toBe('rally');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // Absent / empty — silent fallback (not a misconfiguration, just web use)
  it('returns rally for empty search string', () => {
    expect(resolveDiscipline('')).toBe('rally');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns rally when discipline param is absent', () => {
    expect(resolveDiscipline('?foo=bar')).toBe('rally');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns rally when discipline is an empty string', () => {
    expect(resolveDiscipline('?discipline=')).toBe('rally');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // Invalid values — fallback + console.error (visible during QA)
  it('returns rally for mixed-case precision (strict allowlist)', () => {
    expect(resolveDiscipline('?discipline=Precision')).toBe('rally');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('returns rally for uppercase RALLY', () => {
    expect(resolveDiscipline('?discipline=RALLY')).toBe('rally');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('returns rally for typo "presicion"', () => {
    expect(resolveDiscipline('?discipline=presicion')).toBe('rally');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('returns rally for completely wrong value', () => {
    expect(resolveDiscipline('?discipline=rallycross')).toBe('rally');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('logs the invalid value so launcher drift is visible in devtools', () => {
    resolveDiscipline('?discipline=Precision');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Precision'),
    );
  });

  // Multi-param / coexistence with other launcher params
  it('extracts discipline when other params precede it', () => {
    expect(resolveDiscipline('?competitionId=abc&discipline=precision')).toBe('precision');
  });

  it('extracts discipline when other params follow it', () => {
    expect(resolveDiscipline('?discipline=rally&foo=bar')).toBe('rally');
  });

  // URL-encoded edge cases — strict equality means encoded whitespace still
  // counts as an invalid value and surfaces a console error.
  it('does NOT accept URL-encoded whitespace around valid value', () => {
    expect(resolveDiscipline('?discipline=%20precision')).toBe('rally');
    expect(errorSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// The fallback chain added 2026-07-26: URL -> boot-resolved persisted value ->
// rally. Without the middle link a precision competition opened without
// ?discipline= (stale bookmark, hand-typed URL) printed letters and a spurious
// second answer sheet.
// ---------------------------------------------------------------------------

describe('resolveDiscipline — boot fallback', () => {
  afterEach(() => setBootDiscipline(null));

  it('uses the boot-resolved discipline when the URL has none', () => {
    setBootDiscipline('precision');
    expect(resolveDiscipline('')).toBe('precision');
    expect(resolveDiscipline('?competitionId=abc')).toBe('precision');
  });

  it('lets a valid URL param win over the boot value', () => {
    // The param describes the window the user actually opened; the persisted
    // value is only a fallback for when nobody told us.
    setBootDiscipline('precision');
    expect(resolveDiscipline('?discipline=rally')).toBe('rally');
  });

  it('falls back to the boot value when the URL param is INVALID', () => {
    // An invalid param is not a request for rally — it is noise. Consulting
    // the persisted value beats silently downgrading.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setBootDiscipline('precision');
    expect(resolveDiscipline('?discipline=Precision')).toBe('precision');
    spy.mockRestore();
  });

  it('still defaults to rally when nothing is known', () => {
    setBootDiscipline(null);
    expect(resolveDiscipline('')).toBe('rally');
  });
});
