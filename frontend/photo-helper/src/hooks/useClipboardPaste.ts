import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isClipboardPasteAvailable,
  readPhotosFromClipboard,
  type ClipboardPhotoFailure,
} from '../utils/clipboardPaste';
import { isValidImageFile } from '../utils/imageProcessing';
import { useI18n } from '../contexts/I18nContext';

/**
 * Global Ctrl/Cmd+V handler that funnels pasted photos into the caller's
 * `addFiles` callback (typically `addPhotosToCandidates`).
 *
 * Three input shapes are handled here so the caller doesn't have to:
 *
 *   1. Electron clipboard — `readPhotosFromClipboard` returns paths or an
 *      inline bitmap. Used when running inside the desktop app.
 *   2. `clipboardData.items` — fired by the browser's native paste event
 *      when the user pastes an in-memory bitmap (screenshot, "Copy image
 *      address"). This is a strict subset of (1) but is the only path
 *      available on the web; we always try it as a fallback so a future
 *      web build keeps working.
 *
 * Inactivation rules:
 *   • Paste is ignored while the focus is in an editable element
 *     (`<input>`, `<textarea>`, `contenteditable`). Otherwise typing
 *     filenames into the SetTitle field would steal images from the
 *     clipboard.
 *   • Paste is also ignored when `disabled` is true — used by AppApi to
 *     gate paste while a competition is loading or no competition is
 *     selected.
 */
export interface UseClipboardPasteOptions {
  /** Receives the reconstructed File[] for any successful paste. */
  addFiles: (files: File[]) => void | Promise<void>;
  /** Cap passed to the main process; lets it skip validation past N paths. */
  maxFiles?: number;
  /** When true, the paste handler does nothing (no error, no UI). */
  disabled?: boolean;
}

export interface UseClipboardPasteResult {
  /** True only inside the desktop app — used to render a discovery hint. */
  isAvailable: boolean;
  /** Last user-facing error (partial failure, server rejections). null to dismiss. */
  pasteError: string | null;
  clearPasteError: () => void;
}

export function useClipboardPaste(options: UseClipboardPasteOptions): UseClipboardPasteResult {
  const { t } = useI18n();
  const [pasteError, setPasteError] = useState<string | null>(null);
  const clearPasteError = useCallback(() => setPasteError(null), []);
  const isAvailable = isClipboardPasteAvailable();

  // `addFiles` and option flags are kept in a ref so the document listener
  // — installed once on mount — always reads the latest values without us
  // having to re-attach on every parent render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const opts = optionsRef.current;
      if (opts.disabled) return;
      if (isPasteIntoEditable(e.target)) return;

      // Decide up front whether THIS paste belongs to us. If the clipboard
      // has no items we'd handle, bail without preventDefault so the
      // default paste behaviour (text into a focused control, …) wins.
      const inlineItems = collectInlineImageItems(e.clipboardData);
      const electronAvailable = isClipboardPasteAvailable();
      if (!electronAvailable && inlineItems.length === 0) return;

      // We're going to consume this paste — stop default text-insertion
      // and any other handlers from racing us.
      e.preventDefault();

      // Phase 1 — resolve the clipboard. Failures here are infrastructure
      // (IPC dead, decode of a malformed inline bitmap, unexpected throw).
      // Keep this `try` narrow so addFiles failures below get a distinct
      // toast — conflating storage failures with clipboard-read failures
      // would have the user retrying paste fruitlessly for an OPFS quota.
      const inlineFiles = inlineItems
        .map(item => item.getAsFile())
        .filter((f): f is File => !!f && isValidImageFile(f));

      let viaElectron: File[] = [];
      let failures: ClipboardPhotoFailure[] = [];
      let rejected: Array<{ path: string; reason: string }> = [];
      let ipcError: unknown = undefined;
      if (electronAvailable) {
        try {
          const result = await readPhotosFromClipboard(opts.maxFiles);
          viaElectron = result.files.filter(isValidImageFile);
          failures = result.failures;
          rejected = result.rejected;
          ipcError = result.ipcError;
        } catch (err) {
          console.error('[clipboard paste] read failed:', err);
          ipcError = err;
        }
      }

      // IPC-level failure short-circuits — there's nothing meaningful to
      // pass to addFiles. Surface as infrastructure failure, not "0 of N".
      if (ipcError !== undefined) {
        setPasteError(t('upload.clipboardReadFailed'));
        return;
      }

      // De-dup: when the user pastes a screenshot, BOTH branches return
      // the same bitmap (Electron via `readImage()`, browser via
      // `clipboardData.items`). Prefer Electron's version (correct name
      // + deterministic mime) and only fall back to the browser one if
      // Electron returned nothing.
      const files = viaElectron.length > 0 ? viaElectron : inlineFiles;

      // Phase 2 — hand off to caller. `addFiles` failures (OPFS quota,
      // IndexedDB closed, session not ready) are routed to their own
      // string so the user understands the photos were READ correctly
      // and the failure is on the storage side.
      if (files.length > 0) {
        try {
          await opts.addFiles(files);
        } catch (err) {
          console.error('[clipboard paste] addFiles failed:', err);
          setPasteError(t('upload.addFilesFailed'));
          return;
        }
      }

      if (failures.length > 0 || rejected.length > 0) {
        setPasteError(formatPasteFailure(t, files.length, failures, rejected));
      } else if (files.length === 0) {
        // We committed to handling this paste (preventDefault'd) but had
        // nothing usable — tell the user instead of silently dropping it.
        setPasteError(t('upload.clipboardEmpty'));
      }
    };

    document.addEventListener('paste', onPaste);
    return () => { document.removeEventListener('paste', onPaste); };
  }, [t]);

  return { isAvailable, pasteError, clearPasteError };
}

function isPasteIntoEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

function collectInlineImageItems(data: DataTransfer | null): DataTransferItem[] {
  if (!data) return [];
  const out: DataTransferItem[] = [];
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      out.push(item);
    }
  }
  return out;
}

function formatPasteFailure(
  t: ReturnType<typeof useI18n>['t'],
  successCount: number,
  failures: ClipboardPhotoFailure[],
  rejected: Array<{ path: string; reason: string }>,
): string {
  const failedCount = failures.length + rejected.length;
  const total = successCount + failedCount;
  if (successCount === 0) {
    return t('upload.clipboardAllFailed', { count: failedCount });
  }
  return t('upload.clipboardPartial', {
    success: successCount,
    failed: failedCount,
    total,
  });
}
