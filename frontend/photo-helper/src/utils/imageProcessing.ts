/**
 * Photo-domain pure helpers.
 *
 * WHY this file is short: it used to also carry `autoCropTo43`,
 * `loadImageFromFile`, `applyImageAdjustments` and `generatePhotoLabels`, none
 * of which had a single importer anywhere in `src` (tests included).
 * `applyImageAdjustments` was actively harmful to keep — a THIRD divergent
 * brightness/contrast implementation (brightness before contrast, no 2.55
 * scale) next to the WebGL shader and the CPU fallback in PhotoEditorApi, i.e.
 * exactly the wrong reference for whoever aligns those two. Recover any of
 * them from git history if a real caller ever appears.
 */

/**
 * Generate turning point labels: SP, TP1, TP2, ..., FP
 * Labels are generated dynamically based on actual photo counts:
 * - First photo: SP (Start Point)
 * - Middle photos: TP1, TP2, etc.
 * - Last photo: FP (Final Point)
 *
 * The label is PURELY POSITIONAL, and that is deliberate — do not "improve" it
 * by checking the photo against its waypoint's coordinates.
 *
 * In rally flying the turning-point photographs are a true/false task: the
 * organiser supplies 11-17 of them, some showing the real turning point and
 * some showing a feature that is NOT within 1.0 NM of it, and identifying
 * which is which is the crew's job (FAI GAC Rally Flying Rules 2025, A 3.4
 * Observation Test — A 3.4.3(a) sets 11-17 TP photographs, A 3.4.4 defines an
 * incorrect one as a feature not within 1.0 NM of the turn point).
 * The slot label is therefore the *claim* the crew has to verify, never a
 * measurement. A false photograph is deliberately taken somewhere else, so its
 * EXIF position is expected to be far from the turning point it is filed
 * under, and is often near a different waypoint entirely — in the MZB 2026 set
 * `tp1.JPG` sits 16.5 NM from TP 1 and 0.57 NM from TP 5.
 *
 * So: never GPS-validate these, never warn that one "looks wrong", never
 * reorder them by proximity. Any of those hands the crew the answer and
 * destroys the task. Only en-route photographs are SCORED by distance — the
 * corridor/leg matching in map-corridors exists for them.
 *
 * map-corridors enforces this: `corridors/measurableMarkers.ts` filters
 * `pick-turning` markers out before corridor matching, distance and "from TP",
 * so the answer sheet shows blank cells for them.
 *
 * See docs/RALLY_TP_PHOTOS.md.
 */
export const generateTurningPointLabels = (
  set1Count: number,
  set2Count: number,
  _layoutMode: 'landscape' | 'portrait' = 'landscape'
): { set1: string[], set2: string[] } => {
  const totalPhotos = set1Count + set2Count;

  // No photos - return empty arrays
  if (totalPhotos === 0) {
    return { set1: [], set2: [] };
  }

  // Generate labels based on actual photo count
  const allLabels: string[] = [];
  for (let i = 0; i < totalPhotos; i++) {
    if (i === 0) {
      allLabels.push('SP'); // First photo is Start Point
    } else if (i === totalPhotos - 1) {
      allLabels.push('FP'); // Last photo is Final Point
    } else {
      allLabels.push(`TP${i}`); // Middle photos are Turning Points
    }
  }

  // Distribute labels to match photo positions in each set
  return {
    set1: allLabels.slice(0, set1Count),
    set2: allLabels.slice(set1Count)
  };
};

/**
 * Validate if file is a supported image format
 */
export const isValidImageFile = (file: File): boolean => {
  // Accept various JPEG MIME types and PNG
  const validTypes = [
    'image/jpeg',
    'image/jpg', 
    'image/pjpeg', // Progressive JPEG
    'image/png'
  ];
  
  // `.test()` rather than `.match()`: match returns an array-or-null, which
  // made the whole expression `boolean | null` and not assignable to the
  // declared `boolean` return.
  const hasValidType = validTypes.includes(file.type) ||
    /\.(jpe?g|png)$/.test(file.name.toLowerCase()); // Fallback to file extension
  
  const hasValidSize = file.size <= 20 * 1024 * 1024; // 20MB limit
  
  return hasValidType && hasValidSize;
};
