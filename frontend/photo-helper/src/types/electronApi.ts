/**
 * Type surface for the parts of the Electron preload bridge that the
 * photo-helper uses but `@airq/shared-storage` does not declare.
 *
 * `shared-storage` owns `ElectronStorageAPI` and declares
 * `window.electronAPI?: ElectronStorageAPI` globally, but it only models the
 * *storage* slice of the bridge (`isElectron` + `storage.*`). The desktop
 * preload (`frontend/desktop/preload.js`) exposes considerably more: the
 * native photo-open dialog, per-file reads, clipboard reads and the
 * competition index.
 *
 * WHY an augmentation rather than a second `declare global` block: two files
 * previously re-declared `Window.electronAPI` with their own narrower object
 * types (utils/electronPhotoImport.ts and utils/clipboardPaste.ts). Because
 * TypeScript merges `interface Window` but requires identically-named
 * properties to have identical types, those declarations collided with
 * shared-storage's (TS2717) and — worse — whichever one "won" hid the other's
 * members, so every access was an error once the package was actually
 * typechecked. Merging into `ElectronStorageAPI` itself keeps exactly one
 * declaration of `window.electronAPI` and lets every channel coexist.
 *
 * Every member is optional: the photo-helper also runs as a plain web build
 * where `window.electronAPI` is absent entirely, and older desktop builds may
 * predate individual channels. Call sites must feature-detect (`typeof x ===
 * 'function'`) before use — see `isElectronPhotoImportAvailable()` and
 * `isClipboardPasteAvailable()`.
 */

export {};

declare module '@airq/shared-storage' {
  interface ElectronStorageAPI {
    /**
     * Native open dialog for photos. Returns the absolute paths the user
     * picked (capped at `maxFiles`); each returned path is allowlisted for a
     * follow-up `readPhotoFile`. Empty array on cancel.
     */
    openPhotos?: (defaultDir?: string, maxFiles?: number) => Promise<string[]>;

    /**
     * Read one allowlisted photo path back as base64. `null` when the main
     * process refused or the file vanished between dialog and read.
     */
    readPhotoFile?: (
      filePath: string,
    ) => Promise<{ name: string; mimeType: string; base64: string } | null>;

    /**
     * Resolve the OS clipboard. Discriminated on `kind` because the two
     * useful clipboard shapes need different renderer handling: `paths`
     * (copied from a file manager — needs per-path `readPhotoFile`) versus
     * `image` (an inline bitmap, already decodable).
     */
    readClipboardPhotos?: (maxFiles?: number) => Promise<
      | { kind: 'paths'; paths: string[]; rejected: Array<{ path: string; reason: string }> }
      | { kind: 'image'; name: string; mimeType: string; base64: string }
      | { kind: 'empty' }
    >;

    /**
     * Competition index channels. Only the working-directory pair is declared
     * here — that is all the photo-helper touches; the launcher's create /
     * rename / delete channels stay out of this app's type surface.
     */
    competitions?: {
      getWorkingDir?: (id: string) => Promise<string | null>;
      setWorkingDir?: (id: string, dir: string) => Promise<unknown>;
    };
  }
}
