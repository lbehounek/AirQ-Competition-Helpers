/**
 * Tiny string-only path helpers that work in the browser/renderer where
 * Node's `path` module isn't available without a polyfill. Used by every
 * app to extract `dirname(savedPath)` after a save dialog returns, so the
 * chosen folder can be promoted to the competition's working directory.
 *
 * Three callers (`map-corridors/App.tsx`, `photo-helper/pdfGenerator.ts`,
 * `photo-helper/electronPhotoImport.ts`) used to ship inline copies that
 * disagreed on edge cases (drive-letter roots, posix root files, no
 * separator). Single source of truth fixes that.
 */

/**
 * Extract the directory portion of a file path. Works on both Windows
 * (`C:\photos\img.jpg`) and POSIX (`/home/u/img.jpg`) inputs, plus mixed
 * slashes that Electron's `dialog.showSaveDialog` sometimes returns.
 *
 * Returns `null` when the input has no usable separator — callers fall
 * back to their own defaults instead of persisting a malformed path.
 *
 * Edge cases worth knowing about:
 * - Drive-letter root file `C:\file.txt` returns `C:\` (NOT `C:`, because
 *   `path.resolve("C:")` on Windows points to the *cwd of drive C*,
 *   while `C:\` is the actual drive root).
 * - POSIX root file `/file.kml` returns `/` (NOT `null` — the user
 *   actually picked the filesystem root, persist that).
 * - UNC `\\server\share\file.kml` returns `\\server\share` so the
 *   server-side `validateUserDir` can then reject it with a meaningful
 *   error rather than silently skipping persistence.
 * - Trailing separator on a directory path `C:\photos\` returns
 *   `C:\photos` (the input IS a directory, drop only the trailing sep).
 * - Already-a-root inputs (`C:\`, `C:/`, `/`) are returned as-is — they
 *   have no parent, but persisting the root itself is a valid choice.
 * - No separator `file.txt` returns `null`.
 */
export function dirnameOf(fullPath: string): string | null {
  if (typeof fullPath !== 'string' || !fullPath) return null;

  // Already-a-root inputs: nothing to extract, but the path itself is
  // valid as a directory. Caller decides whether to persist it (the
  // server-side `validateUserDir` rejects UNC; everything else is fine).
  if (fullPath === '/') return '/';
  if (/^[a-zA-Z]:[\\/]$/.test(fullPath)) return fullPath;

  // Trailing separator means the input IS a directory — return it minus
  // the trailing sep so callers don't get a path with a dangling slash.
  if (fullPath.length > 1 && (fullPath.endsWith('\\') || fullPath.endsWith('/'))) {
    return fullPath.slice(0, -1);
  }

  const lastBack = fullPath.lastIndexOf('\\');
  const lastFwd = fullPath.lastIndexOf('/');
  const sepIdx = Math.max(lastBack, lastFwd);
  if (sepIdx < 0) return null;

  // POSIX root file: `/foo` (sepIdx=0). The directory IS root.
  if (sepIdx === 0) return fullPath[0] || null;

  // Windows drive-letter root file: `C:\foo` (sepIdx=2). Return `C:\`
  // WITH the trailing separator so the value round-trips through
  // `path.resolve` correctly on Windows.
  if (sepIdx === 2 && /^[a-zA-Z]:[\\/]/.test(fullPath)) {
    return fullPath.slice(0, 3);
  }

  return fullPath.slice(0, sepIdx);
}
