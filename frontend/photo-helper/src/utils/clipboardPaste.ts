/**
 * Clipboard photo paste — Ctrl+V flow that mirrors the open-dialog import
 * pipeline (`electronPhotoImport.ts`). Two input shapes that the main
 * process resolves transparently for us:
 *
 *  1. File paths from Total Commander / Explorer / Finder. Main runs the
 *     same ext/symlink/size validation as `read-photo-file` AND seeds the
 *     `photoOpenAllowlist`, so we just call `readPhotoFile` per path.
 *  2. In-memory bitmap from a screenshot or "Copy image" — main returns
 *     base64 PNG inline, no follow-up IPC needed.
 *
 * Browser fallback (`navigator.clipboard.read` / clipboardData.items) is
 * intentionally NOT wired here: the photo-helper only ships inside the
 * desktop app, and the Async Clipboard API on the web can't read file
 * references copied from Total Commander at all (only inline bitmaps).
 * If the web build ever materialises, the existing `paste` listener in
 * `useClipboardPaste` will surface clipboardData.items for the bitmap-only
 * case — handled there, not duplicated here.
 */

import { base64ToUint8Array } from './electronPhotoImport';

declare global {
  interface Window {
    electronAPI?: {
      readPhotoFile?: (filePath: string) => Promise<{ name: string; mimeType: string; base64: string } | null>;
      readClipboardPhotos?: (maxFiles?: number) => Promise<
        | { kind: 'paths'; paths: string[]; rejected: Array<{ path: string; reason: string }> }
        | { kind: 'image'; name: string; mimeType: string; base64: string }
        | { kind: 'empty' }
      >;
    };
  }
}

export interface ClipboardPhotoFailure {
  path: string;
  error: unknown;
}

export interface ClipboardPhotoResult {
  files: File[];
  failures: ClipboardPhotoFailure[];
  /** Server-side rejections (wrong extension, symlink, too large, …). */
  rejected: Array<{ path: string; reason: string }>;
  /** True when the clipboard had no images and no usable file paths. */
  empty: boolean;
  /**
   * The IPC itself rejected before returning a structured result (channel
   * closed, untrusted sender, main crashed). Distinct from `failures` —
   * which is per-file content failure — so the hook can render an
   * infrastructure-level "couldn't read the clipboard" message instead
   * of the misleading "None of the 1 pasted items could be read".
   */
  ipcError?: unknown;
}

export function isClipboardPasteAvailable(): boolean {
  const api = window.electronAPI;
  return !!(api && typeof api.readClipboardPhotos === 'function');
}

const EMPTY: ClipboardPhotoResult = Object.freeze({
  files: [],
  failures: [],
  rejected: [],
  empty: true,
}) as ClipboardPhotoResult;

/**
 * Resolve the OS clipboard to a list of `File` objects.
 *
 * `maxFiles` caps the number of paths the main process will validate —
 * pass the available tray/slot capacity so a runaway paste of 200 files
 * can't OOM the renderer on base64 decode. Web-build callers (no Electron
 * API) get `EMPTY` and should fall through to the `clipboardData.items`
 * branch in their `paste` handler.
 */
export async function readPhotosFromClipboard(maxFiles?: number): Promise<ClipboardPhotoResult> {
  const api = window.electronAPI;
  if (!api?.readClipboardPhotos || !api?.readPhotoFile) return EMPTY;

  let payload;
  try {
    payload = await api.readClipboardPhotos(maxFiles);
  } catch (err) {
    // IPC threw before producing a structured result (untrusted sender,
    // channel closed, main crashed). Route via `ipcError` so the hook
    // surfaces an infrastructure message, not a misleading "0-of-1" toast.
    return { files: [], failures: [], rejected: [], empty: false, ipcError: err };
  }
  if (!payload || payload.kind === 'empty') return EMPTY;

  if (payload.kind === 'image') {
    try {
      const bytes = base64ToUint8Array(payload.base64);
      const file = new File([bytes], payload.name, { type: payload.mimeType });
      return { files: [file], failures: [], rejected: [], empty: false };
    } catch (err) {
      return { files: [], failures: [{ path: payload.name, error: err }], rejected: [], empty: false };
    }
  }

  // kind === 'paths' — parallelize reads, same pattern as `openPhotosViaElectron`.
  const settled = await Promise.all(
    payload.paths.map(async (p): Promise<{ ok: true; file: File } | { ok: false; path: string; error: unknown }> => {
      try {
        const data = await api.readPhotoFile!(p);
        if (!data || !data.base64) {
          return { ok: false, path: p, error: new Error('Empty response from readPhotoFile') };
        }
        const bytes = base64ToUint8Array(data.base64);
        return { ok: true, file: new File([bytes], data.name, { type: data.mimeType }) };
      } catch (err) {
        return { ok: false, path: p, error: err };
      }
    }),
  );

  const files: File[] = [];
  const failures: ClipboardPhotoFailure[] = [];
  for (const r of settled) {
    if (r.ok) files.push(r.file);
    else failures.push({ path: r.path, error: r.error });
  }
  return {
    files,
    failures,
    rejected: payload.rejected || [],
    empty: files.length === 0 && failures.length === 0 && (payload.rejected || []).length === 0,
  };
}
