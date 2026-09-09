/**
 * Merge a canvas-state patch into the currently-selected photo, safely.
 *
 * This is the functional updater `AppApi` hands to `setSelectedPhoto`. It
 * returns:
 *  - `prev` unchanged (the SAME reference) when nothing is selected, or when
 *    the selection is a different photo than the patch targets;
 *  - a new selection object with `photo.canvasState` shallow-merged otherwise.
 *
 * WHY the id guard and the null-preservation live HERE rather than in the
 * render closure: commits are debounced, so a commit can land AFTER the editor
 * was closed, navigated to the next photo, or the photo was removed. Only an
 * updater that reads the CURRENT `prev` can tell — a closure captured at render
 * time cannot. Without this, a late commit re-opened the modal (AppApi renders
 * the editor body under `{selectedPhoto && …}`) or reverted the freshly
 * selected photo to the previous one's values.
 *
 * Edge cases: the merge is shallow, so a patch carrying a nested object
 * (`whiteBalance`, `circle`) replaces that sub-object wholesale — which is
 * exactly what the callers build; `{ circle: null }` therefore clears the
 * circle rather than merging into it.
 */
export function mergeSelectedPhotoPatch<
  S extends { photo: { id: string; canvasState: object } },
>(
  prev: S | null,
  photoId: string,
  patch: Partial<S['photo']['canvasState']>,
): S | null {
  if (prev === null || prev.photo.id !== photoId) return prev;
  return {
    ...prev,
    photo: {
      ...prev.photo,
      canvasState: { ...prev.photo.canvasState, ...patch },
    },
  };
}
