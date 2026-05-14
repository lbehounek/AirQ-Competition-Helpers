/**
 * Pure dispatch for the four possible outcomes of dropping something onto a
 * `PhotoGridApi` slot:
 *
 *   1. tray photo → promote to this slot
 *   2. slot photo from another set → cross-set drop (rejected with a hint)
 *   3. integer in `text/plain` → in-grid reorder
 *   4. native OS file drop → smart-drop forward (occupied slot routes to tray)
 *
 * Extracted from `PhotoGridApi.handleDrop` so the dispatch can be unit-tested
 * without spinning up MUI/contexts/react-dropzone (PR #62 review I4). The
 * component shell stays in charge of `e.preventDefault()`, drag-state resets,
 * and invoking the returned callbacks; this helper just decides WHICH
 * callback should fire.
 *
 * The order of checks is load-bearing — keep it identical to the production
 * dispatch:
 *   structured payload first (tray / cross-set slot)
 *   → text/plain reorder (same-set in-grid drag)
 *   → native file fallthrough (only when neither payload nor reorder matched)
 *
 * Returning `{ kind: 'none' }` is a "do nothing" signal — the drop fell
 * through every branch.
 */

import type { DragPayload } from './dragPayload';

export type SlotDropAction =
  | { kind: 'promote'; photoId: string; dropIndex: number }
  | { kind: 'cross-set-rejected' }
  | { kind: 'reorder'; fromIndex: number; toIndex: number }
  | { kind: 'files'; files: File[] }
  | { kind: 'none' };

export interface SlotDropInput {
  payload: DragPayload | null;
  textPlain: string;
  files: ReadonlyArray<File>;
  dropIndex: number;
  setKey: 'set1' | 'set2';
  isValidImageFile: (file: File) => boolean;
}

export function dispatchSlotDrop(input: SlotDropInput): SlotDropAction {
  const { payload, textPlain, files, dropIndex, setKey, isValidImageFile } = input;

  if (payload) {
    if (payload.kind === 'tray') {
      return { kind: 'promote', photoId: payload.photoId, dropIndex };
    }
    if (payload.kind === 'slot' && payload.setKey !== setKey) {
      // Cross-set drops aren't supported in v1; two-step via tray works.
      return { kind: 'cross-set-rejected' };
    }
    // payload.kind === 'slot' && payload.setKey === setKey falls through to
    // the legacy text/plain reorder path (same-set drag emits both formats).
  }

  const dragIndex = Number.parseInt(textPlain, 10);
  if (Number.isFinite(dragIndex) && dragIndex !== dropIndex) {
    return { kind: 'reorder', fromIndex: dragIndex, toIndex: dropIndex };
  }

  // Native OS file drop onto an occupied slot — neither payload nor reorder
  // matched. Without this branch, `e.preventDefault()` in the component
  // already suppressed the dropzone wrapper and the files vanished silently
  // (PR #62 review I4). Routing to onFilesDropped lets smart-drop send the
  // batch to the candidate tray (occupied slot → remaining = 0).
  if (files.length > 0) {
    const valid = Array.from(files).filter(isValidImageFile);
    if (valid.length > 0) {
      return { kind: 'files', files: valid };
    }
  }

  return { kind: 'none' };
}
