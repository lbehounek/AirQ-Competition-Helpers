import { describe, it, expect } from 'vitest';
import { dirnameOf } from '@airq/shared-storage';

// `dirnameOf` is the renderer-side stand-in for Node's `path.dirname`,
// used by every save-dialog callback (KML, PNG, PDF, photo import) to
// extract the directory the user just picked and persist it as the
// competition's working folder. Wrong output here = wrong default for
// the next dialog. Three different inline copies disagreed on edge cases
// before this consolidation; the cases below pin them.

describe('dirnameOf', () => {
  // --- Standard happy paths ---------------------------------------------------

  it('extracts directory from a Windows path with backslashes', () => {
    expect(dirnameOf('C:\\photos\\img.jpg')).toBe('C:\\photos');
  });

  it('extracts directory from a POSIX path with forward slashes', () => {
    expect(dirnameOf('/home/user/img.jpg')).toBe('/home/user');
  });

  it('extracts directory from a deeply nested path', () => {
    expect(dirnameOf('/a/b/c/d/e/f.kml')).toBe('/a/b/c/d/e');
  });

  it('extracts directory from a path with mixed separators', () => {
    // Electron save dialog on Windows occasionally returns mixed sep
    // when the user pastes a path. Last separator (either kind) wins.
    expect(dirnameOf('C:/photos\\img.jpg')).toBe('C:/photos');
  });

  // --- Drive-letter roots (Windows) ------------------------------------------

  it('returns drive root WITH trailing separator for `C:\\file.txt`', () => {
    // `path.resolve("C:")` on Windows returns the cwd of drive C, NOT the
    // root. Persisting `"C:"` as workingDir would mean every subsequent
    // dialog opens at whatever C:'s cwd happens to be.
    expect(dirnameOf('C:\\file.txt')).toBe('C:\\');
  });

  it('returns drive root with forward slash form `D:/file.txt`', () => {
    expect(dirnameOf('D:/file.txt')).toBe('D:/');
  });

  it('preserves drive-letter case', () => {
    expect(dirnameOf('z:\\foo.bin')).toBe('z:\\');
    expect(dirnameOf('Z:\\foo.bin')).toBe('Z:\\');
  });

  // --- POSIX root -------------------------------------------------------------

  it('returns `/` for a file at POSIX root', () => {
    // sepIdx === 0 is a real case — user explicitly picked filesystem
    // root. Returning null would silently skip workingDir persistence.
    expect(dirnameOf('/file.kml')).toBe('/');
  });

  // --- UNC / device paths -----------------------------------------------------

  it('extracts directory from a UNC path', () => {
    // We DO extract from UNC — it's main.js / `validateUserDir`'s job
    // to reject it (NTLMv2 hash leak protection), not dirnameOf's. This
    // gives the user a real error from the IPC instead of a mysterious
    // silently-skipped persistence.
    expect(dirnameOf('\\\\server\\share\\file.kml')).toBe('\\\\server\\share');
  });

  // --- Trailing separators ----------------------------------------------------

  it('drops a single trailing backslash', () => {
    expect(dirnameOf('C:\\photos\\')).toBe('C:\\photos');
  });

  it('drops a single trailing forward slash', () => {
    expect(dirnameOf('/home/user/')).toBe('/home/user');
  });

  it('does NOT drop the only separator (drive root with trailing sep)', () => {
    // `C:\` is already root — don't strip it down to `C:` (which would
    // change semantics on Windows).
    expect(dirnameOf('C:\\')).toBe('C:\\');
  });

  // --- No-separator / empty / invalid inputs ---------------------------------

  it('returns null for a bare filename', () => {
    expect(dirnameOf('file.txt')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(dirnameOf('')).toBeNull();
  });

  it('returns null for non-string input', () => {
    // Defensive — the IPC return is typed as `string | null` but
    // runtime data can drift.
    expect(dirnameOf(null as unknown as string)).toBeNull();
    expect(dirnameOf(undefined as unknown as string)).toBeNull();
    expect(dirnameOf(123 as unknown as string)).toBeNull();
  });
});
